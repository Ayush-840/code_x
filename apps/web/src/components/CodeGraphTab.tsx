"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { AnimatePresence, motion } from "motion/react";
import { GitBranch, Loader2, MessageCircle, ScanSearch } from "lucide-react";

/**
 * CodeGraph tab (PRD-G03): interactive dependency graph for the analyzed
 * repo, with LLM node explanations and graph-grounded chat with clickable
 * citations. Ported from apps/codegraph-web (Toolbar/SidePanel/ChatPanel +
 * react-force-graph-2d) and restyled to the AI Lab OS token system — this
 * file supersedes that separate app (TRD §3.3).
 *
 * Data access is injected as async fetchers (the FileGraphTab/TRD-F01
 * pattern): the tab itself never knows about auth, so both the authed repo
 * page and the anonymous analysis page can mount it.
 */

// react-force-graph-2d touches window during import — client-only, no SSR.
// Its shipped types are loose (no ref on the dynamic wrapper), so the surface
// actually used is typed here once and the module is cast at the boundary.
interface ForceGraph2DProps {
  graphData: { nodes: FGNode[]; links: FGLink[] };
  width: number;
  height: number;
  backgroundColor: string;
  nodeCanvasObject: (node: FGNode, ctx: CanvasRenderingContext2D, scale: number) => void;
  nodeCanvasObjectMode: () => string;
  linkCanvasObject: (link: FGLink, ctx: CanvasRenderingContext2D) => void;
  linkCanvasObjectMode: () => string;
  onNodeClick: (node: unknown) => void;
  enableNodeDrag: boolean;
  d3AlphaDecay: number;
  d3VelocityDecay: number;
}

interface ForceGraph2DRef {
  refresh?: () => void;
  graphData?: () => { nodes: FGNode[]; links: FGLink[] };
}

const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), {
  ssr: false,
}) as unknown as React.ComponentType<ForceGraph2DProps & { ref?: React.MutableRefObject<ForceGraph2DRef | null> }>;

export interface CodeGraphNode {
  id: string;
  type: string;
  file: string;
  name: string;
  line_start: number;
  line_end: number;
  docstring?: string | null;
  signature?: string | null;
}

export interface CodeGraphEdge {
  from_id: string;
  to_id: string;
  type: string;
}

export interface CodeGraphData {
  nodes: CodeGraphNode[];
  edges: CodeGraphEdge[];
}

export interface CodeGraphTabProps {
  fetchGraph: () => Promise<CodeGraphData>;
  explainNode: (nodeId: string) => Promise<{ explanation: string }>;
  ask: (question: string) => Promise<{ answer: string; cited_nodes: string[] }>;
}

const TYPE_COLORS: Record<string, string> = {
  module: "#3b82f6", // lab.blue
  class: "#a78bfa",
  function: "#4ade80",
};

const TYPE_LABELS: Record<string, string> = {
  module: "Module",
  class: "Class",
  function: "Function",
};

type FGNode = CodeGraphNode & {
  color: string;
  r: number;
  x?: number;
  y?: number;
  fx?: number;
  fy?: number;
  __cited?: boolean;
  __selected?: boolean;
};

interface FGLink {
  source: string | FGNode;
  target: string | FGNode;
  type: string;
  __active?: boolean;
}

/** Minimal markdown-ish renderer: code fences, bullets, `inline code`, **bold**. */
function ExplanationBody({ text }: { text: string }) {
  if (!text) return null;
  const blocks = text.split(/```/);
  return (
    <div className="space-y-2 text-xs leading-relaxed text-lab-textMuted">
      {blocks.map((block, i) => {
        if (i % 2 === 1) {
          const code = block.replace(/^(python|py|ts|tsx|js)?\n/, "");
          return (
            <pre
              key={i}
              className="bg-lab-bg border border-lab-border rounded-md p-3 overflow-x-auto text-[11px] font-mono text-lab-blue"
            >
              {code}
            </pre>
          );
        }
        return (
          <div key={i} className="space-y-1">
            {block
              .split("\n")
              .filter((line) => line.trim().length > 0)
              .map((line, j) => (
                <p key={j} className={line.trimStart().startsWith("-") ? "pl-3" : ""}>
                  {inlineFormat(line)}
                </p>
              ))}
          </div>
        );
      })}
    </div>
  );
}

function inlineFormat(line: string) {
  const parts = line.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={i} className="text-white">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code key={i} className="bg-lab-card rounded px-1 py-0.5 text-[10px] font-mono text-lab-blue">
          {part.slice(1, -1)}
        </code>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

function shortLabel(nodeId: string): string {
  const [file, symbol = ""] = nodeId.split("::");
  const fileName = file.split("/").pop() ?? file;
  return symbol ? `${fileName} · ${symbol}` : fileName;
}

export function CodeGraphTab({ fetchGraph, explainNode, ask }: CodeGraphTabProps) {
  const [graphData, setGraphData] = useState<CodeGraphData | null>(null);
  const [graphError, setGraphError] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<CodeGraphNode | null>(null);
  const [explanation, setExplanation] = useState("");
  const [explainLoading, setExplainLoading] = useState(false);
  const [activePanel, setActivePanel] = useState<"inspector" | "chat">("inspector");

  const [chatQuestion, setChatQuestion] = useState("");
  const [chatAnswer, setChatAnswer] = useState("");
  const [chatCitedNodes, setChatCitedNodes] = useState<string[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);

  const [highlightedIds, setHighlightedIds] = useState<Set<string>>(new Set());

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const graphRef = useRef<ForceGraph2DRef | null>(null);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);

  // Load the graph once. Same silent-refresh contract as FileGraphTab: a
  // fetcher identity change re-runs this, but rendered content is never
  // torn down — errors surface inline (TRD-F01 flicker lessons).
  //
  // GRAPH_GENERATING (202): the API lazily scheduled a rebuild for analyses
  // created before the codegraph pipeline step existed — poll instead of
  // showing the error, so old analyses self-heal on open. The generating
  // state is tracked separately from hard errors so the UI can reflect it
  // (spinner + attempt count) instead of a red error banner or a bare
  // "Loading graph…" that never resolves.
  const graphLoadedRef = useRef(false);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [generating, setGenerating] = useState(false);
  const [pollAttempts, setPollAttempts] = useState(0);
  useEffect(() => {
    if (graphLoadedRef.current) return;
    graphLoadedRef.current = true;
    let cancelled = false;

    // Front-loaded schedule: the rebuild is usually a clone + parse of a
    // shallow clone (~10-30s), so early attempts are cheap and frequent,
    // then back off — total patience ~5 min before an honest error.
    const POLL_SCHEDULE_MS = [2000, 4000, 4000, 6000, 6000, 8000];
    const pollMs = (n: number) => POLL_SCHEDULE_MS[Math.min(n, POLL_SCHEDULE_MS.length - 1)];
    const MAX_POLLS = 60;

    const attempt = (n: number) => {
      fetchGraph()
        .then((d) => {
          if (!cancelled) {
            setGraphData(d);
            setGenerating(false);
          }
        })
        .catch((e) => {
          if (cancelled) return;
          const generatingResponse =
            e instanceof Error &&
            "status" in e &&
            (e as { status?: number }).status === 202;
          if (generatingResponse && n < MAX_POLLS) {
            setGenerating(true);
            setGraphError(null);
            setPollAttempts(n + 1);
            pollTimerRef.current = setTimeout(() => attempt(n + 1), pollMs(n));
          } else {
            setGenerating(false);
            setGraphError(
              generatingResponse
                ? "The code graph is taking unusually long to generate. Reload this tab in a minute."
                : e instanceof Error
                  ? e.message
                  : "Failed to load code graph"
            );
          }
        });
    };
    attempt(0);

    return () => {
      cancelled = true;
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
  }, [fetchGraph]);

  // Measure the wrapper for the canvas — never read window at render time.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => setDims({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const handleNodeClick = useCallback(
    async (raw: unknown) => {
      const node = raw as FGNode;
      const target = graphData?.nodes.find((n) => n.id === node.id) ?? null;
      setSelectedNode(target);
      setActivePanel("inspector");
      setExplanation("");
      if (!target) return;
      setExplainLoading(true);
      try {
        const res = await explainNode(target.id);
        setExplanation(res.explanation);
      } catch {
        setExplanation("Failed to load explanation for this node.");
      } finally {
        setExplainLoading(false);
      }
    },
    [graphData, explainNode]
  );

  const handleChat = useCallback(async () => {
    const q = chatQuestion.trim();
    if (!q) return;
    setChatLoading(true);
    setChatError(null);
    try {
      const res = await ask(q);
      setChatAnswer(res.answer);
      setChatCitedNodes(res.cited_nodes ?? []);
      setHighlightedIds(new Set(res.cited_nodes ?? []));
    } catch (e) {
      setChatError(e instanceof Error ? e.message : "Failed to get an answer");
    } finally {
      setChatLoading(false);
    }
  }, [chatQuestion, ask]);

  const handleCiteClick = useCallback((id: string) => {
    setHighlightedIds((prev) => {
      if (prev.size === 1 && prev.has(id)) return new Set<string>();
      return new Set([id]);
    });
  }, []);

  const clearHighlights = useCallback(() => setHighlightedIds(new Set()), []);

  // Build the force-graph payload from from_id/to_id edges, pre-seeded with
  // the cheap radial layout so the simulation converges instantly.
  const fgGraph = useMemo(() => {
    if (!graphData) return null;
    const byId = new Map(graphData.nodes.map((n) => [n.id, n]));
    const valid = graphData.edges.filter((e) => byId.has(e.from_id) && byId.has(e.to_id));
    const pos = layout(graphData, valid);
    const nodes: FGNode[] = graphData.nodes.map((n) => ({
      ...n,
      color: TYPE_COLORS[n.type] ?? "#9ca3af",
      r: n.type === "module" ? 5 : n.type === "class" ? 4 : 3,
      x: pos.get(n.id)?.x,
      y: pos.get(n.id)?.y,
      // Pin files to the radial layout; symbols stay free so links can
      // relax them into something readable.
      ...(n.type === "module" ? { fx: pos.get(n.id)?.x, fy: pos.get(n.id)?.y } : {}),
    }));
    const links: FGLink[] = valid.map((e) => ({
      source: e.from_id,
      target: e.to_id,
      type: e.type,
    }));
    return { nodes, links };
  }, [graphData]);

  // Mirror highlights onto node/link objects, then force a repaint —
  // force-graph stops its engine after cooldown, so in-place mutation needs
  // an explicit .refresh() or the highlight only appears after panning.
  useEffect(() => {
    const g = graphRef.current;
    if (!g || !fgGraph) return;
    for (const n of g.graphData?.().nodes ?? []) {
      n.__cited = highlightedIds.has(n.id);
      n.__selected = selectedNode?.id === n.id;
    }
    for (const l of g.graphData?.().links ?? []) {
      const s = typeof l.source === "object" ? (l.source as FGNode).id : l.source;
      const t = typeof l.target === "object" ? (l.target as FGNode).id : l.target;
      l.__active = !!s && !!t && (highlightedIds.has(s) || highlightedIds.has(t));
    }
    g.refresh?.();
  }, [highlightedIds, selectedNode, fgGraph]);

  const paintNode = useCallback((node: FGNode, ctx: CanvasRenderingContext2D, scale: number) => {
    const r = node.r ?? 3;
    ctx.beginPath();
    ctx.arc(node.x ?? 0, node.y ?? 0, r, 0, 2 * Math.PI, false);
    ctx.fillStyle = node.__cited || node.__selected ? "#eab308" : node.color;
    ctx.fill();
    if (node.__cited || node.__selected) {
      ctx.strokeStyle = "#eab308";
      ctx.lineWidth = 1.5 / scale;
      ctx.stroke();
    }
    // Screen-constant label: counteract the global zoom scale.
    const fontSize = 4 / scale;
    ctx.font = `${fontSize}px JetBrains Mono, monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillStyle = node.__cited || node.__selected ? "#fde68a" : "rgba(148,163,184,0.85)";
    ctx.fillText(node.name, node.x ?? 0, (node.y ?? 0) + r + 2 / scale);
  }, []);

  const paintLink = useCallback((link: FGLink, ctx: CanvasRenderingContext2D) => {
    const s = link.source as FGNode;
    const t = link.target as FGNode;
    if (!s?.x || !t?.x) return;
    ctx.beginPath();
    ctx.moveTo(s.x, s.y ?? 0);
    ctx.lineTo(t.x, t.y ?? 0);
    ctx.strokeStyle = link.__active ? "rgba(74,222,128,0.9)" : "rgba(75,85,99,0.35)";
    ctx.lineWidth = link.__active ? 1.2 : 0.7;
    ctx.setLineDash(link.type === "calls" ? [3, 3] : []);
    ctx.stroke();
    ctx.setLineDash([]);
  }, []);

  return (
    <div className="panel p-4 sm:p-6 min-h-[600px] flex flex-col">
      {/* Toolbar (ported from codegraph-web, lab-token restyled) */}
      <div className="flex items-center gap-3 pb-3 border-b border-lab-border flex-wrap">
        <span className="flex items-center gap-2 section-label !mb-0">
          <GitBranch className="w-4 h-4 text-lab-blue" />
          Code Graph
        </span>
        {graphData && (
          <span className="text-[11px] font-mono text-lab-textMuted">
            {graphData.nodes.length} nodes · {graphData.edges.length} edges
          </span>
        )}
        <span className="ml-auto flex gap-1">
          {(["inspector", "chat"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setActivePanel(t)}
              className={`px-3 py-1.5 text-[11px] font-mono uppercase tracking-wider rounded-lg transition-colors border ${
                activePanel === t
                  ? "bg-lab-blueDim text-lab-blue border-lab-blue/40"
                  : "text-lab-textMuted hover:text-white border-lab-border hover:bg-lab-card"
              }`}
            >
              {t === "inspector" ? (
                <span className="flex items-center gap-1.5">
                  <ScanSearch className="w-3.5 h-3.5" /> Inspector
                </span>
              ) : (
                <span className="flex items-center gap-1.5">
                  <MessageCircle className="w-3.5 h-3.5" /> Ask
                </span>
              )}
            </button>
          ))}
        </span>
      </div>

      {graphError && (
        <div className="mt-3 px-3 py-2 rounded-lg border border-red-400/40 bg-red-400/10 text-xs font-mono text-red-400">
          {graphError}
        </div>
      )}

      <div className="flex-1 flex flex-col lg:flex-row gap-4 mt-3 min-h-0">
        {/* Graph canvas */}
        <div className="relative flex-1 min-h-[420px] rounded-lg border border-lab-border bg-lab-bg overflow-hidden" ref={wrapRef}>
          {dims && fgGraph && (
            <ForceGraph2D
              ref={graphRef}
              graphData={fgGraph}
              width={dims.w}
              height={dims.h}
              backgroundColor="rgba(0,0,0,0)"
              nodeCanvasObject={paintNode}
              nodeCanvasObjectMode={() => "replace"}
              linkCanvasObject={paintLink}
              linkCanvasObjectMode={() => "replace"}
              onNodeClick={handleNodeClick}
              enableNodeDrag={false}
              d3AlphaDecay={0.03}
              d3VelocityDecay={0.4}
            />
          )}

          {fgGraph && highlightedIds.size > 0 && (
            <button
              onClick={clearHighlights}
              className="absolute top-3 right-3 px-2.5 py-1 text-[11px] font-mono rounded-lg bg-lab-blueDim text-lab-blue border border-lab-blue/30 hover:bg-lab-blue/20 transition-colors"
            >
              Clear highlight
            </button>
          )}

          {!fgGraph && !graphError && generating && (
            <div className="flex flex-col items-center justify-center h-full gap-2 text-lab-textMuted text-sm px-6 text-center">
              <Loader2 className="w-5 h-5 animate-spin text-lab-blue" />
              <span>Code graph is being generated — first build takes a moment…</span>
              {pollAttempts > 0 && (
                <span className="text-[11px] font-mono text-lab-textMuted/70">
                  checking again in a few seconds ({pollAttempts})
                </span>
              )}
            </div>
          )}

          {!fgGraph && !graphError && !generating && (
            <div className="flex items-center justify-center h-full text-lab-textMuted text-sm">
              <Loader2 className="w-5 h-5 animate-spin mr-2 text-lab-blue" />
              Loading graph…
            </div>
          )}

          {graphData && graphData.nodes.length > 0 && (
            <div className="absolute bottom-3 left-3 flex gap-3 text-[10px] font-mono text-lab-textMuted bg-lab-bg/80 rounded-lg px-2.5 py-1.5 border border-lab-border">
              {(Object.keys(TYPE_COLORS) as string[]).map((t) => (
                <span key={t} className="inline-flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: TYPE_COLORS[t] }} />
                  {TYPE_LABELS[t] ?? t}
                </span>
              ))}
              <span className="inline-flex items-center gap-1.5">
                <span className="w-3 h-0.5" style={{ backgroundColor: "#eab308" }} />
                cited
              </span>
            </div>
          )}
        </div>

        {/* Side panel: inspector / chat */}
        <aside className="lg:w-96 shrink-0 flex flex-col border border-lab-border rounded-lg bg-lab-card min-h-[300px] max-h-[560px]">
          <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={activePanel}
            initial={{ opacity: 0, x: 6 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -6 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            className="flex-1 overflow-y-auto p-4 min-h-0"
          >
            {activePanel === "inspector" ? (
              <>
                {!selectedNode ? (
                  <p className="text-sm text-lab-textMuted">
                    Click a node in the graph — its AI explanation, signature and
                    connections show up here.
                  </p>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-mono text-sm font-semibold text-white break-all">
                        {selectedNode.name}
                      </h3>
                      <span
                        className={`shrink-0 text-[10px] font-medium px-2 py-0.5 rounded-full border ${
                          selectedNode.type === "module"
                            ? "border-lab-blue/50 text-lab-blue"
                            : selectedNode.type === "class"
                              ? "border-purple-400/50 text-purple-300"
                              : "border-green-400/50 text-green-300"
                        }`}
                      >
                        {TYPE_LABELS[selectedNode.type] ?? selectedNode.type}
                      </span>
                    </div>
                    <p className="text-[11px] font-mono text-lab-textMuted">
                      {selectedNode.file}
                      {selectedNode.line_start ? `:${selectedNode.line_start}` : ""}
                      {selectedNode.line_end && selectedNode.line_end !== selectedNode.line_start
                        ? `–${selectedNode.line_end}`
                        : ""}
                    </p>
                    {explainLoading ? (
                      <div className="flex items-center gap-2 text-xs text-lab-textMuted">
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-lab-blue" />
                        Explaining…
                      </div>
                    ) : explanation ? (
                      <ExplanationBody text={explanation} />
                    ) : null}
                  </div>
                )}
              </>
            ) : (
              <div className="flex flex-col h-full min-h-0">
                <div className="flex-1 min-h-0 space-y-3">
                  {!chatAnswer && !chatLoading && !chatError && (
                    <p className="text-sm text-lab-textMuted">
                      Ask a question about this repo — answers cite the graph nodes
                      that informed them; click a citation to highlight it in the graph.
                    </p>
                  )}
                  {chatLoading && (
                    <div className="flex items-center gap-2 text-xs text-lab-textMuted">
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-lab-blue" />
                      Searching the graph…
                    </div>
                  )}
                  {chatError && <p className="text-xs text-red-400">{chatError}</p>}
                  {!chatLoading && chatAnswer && (
                    <p className="text-xs leading-relaxed text-lab-textMuted whitespace-pre-wrap">
                      {chatAnswer}
                    </p>
                  )}
                  {!chatLoading && chatCitedNodes.length > 0 && (
                    <div className="space-y-1.5">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-lab-textMuted">
                        Cited nodes
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {chatCitedNodes.map((id) => (
                          <button
                            key={id}
                            onClick={() => handleCiteClick(id)}
                            title={id}
                            className="text-[10px] font-mono px-2 py-1 rounded border border-lab-border bg-lab-bg text-green-300 hover:border-green-400/60 transition-colors"
                          >
                            {shortLabel(id)}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                <div className="pt-3 mt-3 border-t border-lab-border">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={chatQuestion}
                      onChange={(e) => setChatQuestion(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.nativeEvent.isComposing) void handleChat();
                      }}
                      placeholder="e.g. where is parsing handled?"
                      className="flex-1 px-2.5 py-1.5 text-xs font-mono rounded-lg bg-lab-bg border border-lab-border text-white placeholder:text-lab-textMuted focus:outline-none focus:border-lab-blue/50"
                      disabled={chatLoading}
                    />
                    <button
                      onClick={() => void handleChat()}
                      disabled={chatLoading || !chatQuestion.trim()}
                      className="btn btn-primary btn-sm shrink-0"
                    >
                      Ask
                    </button>
                  </div>
                </div>
              </div>
            )}
          </motion.div>
          </AnimatePresence>
        </aside>
      </div>
    </div>
  );
}

/** Cheap radial layout: files angle-sorted by directory so related code lands
 * together; symbols fan out around their file. The force simulation then
 * relaxes it (files pinned via fx/fy, symbols drift inside). */
function layout(
  data: CodeGraphData,
  edges: { from_id: string; to_id: string }[]
): Map<string, { x: number; y: number }> {
  const pos = new Map<string, { x: number; y: number }>();
  const files = data.nodes.filter((n) => n.type === "module");
  const R = 60 + files.length * 2;

  const byDir = new Map<string, string[]>();
  for (const f of files) {
    const dir = f.file.split("/").slice(0, -1).join("/");
    if (!byDir.has(dir)) byDir.set(dir, []);
    byDir.get(dir)!.push(f.id);
  }
  const dirs = Array.from(byDir.keys()).sort();
  dirs.forEach((dir, di) => {
    const ids = byDir.get(dir)!;
    ids.forEach((id, i) => {
      const angle = (di / Math.max(dirs.length, 1)) * 2 * Math.PI + (i / ids.length) * 0.35;
      pos.set(id, { x: Math.cos(angle) * R, y: Math.sin(angle) * R });
    });
  });

  const fileOf = (id: string) => id.split("::")[0];
  const symbols = data.nodes.filter((n) => n.type !== "module");
  const perFile = new Map<string, string[]>();
  for (const s of symbols) {
    const f = fileOf(s.id);
    if (!perFile.has(f)) perFile.set(f, []);
    perFile.get(f)!.push(s.id);
  }
  perFile.forEach((ids, file) => {
    const fp = pos.get(file) ?? { x: 0, y: 0 };
    ids.forEach((id, i) => {
      const angle = (i / Math.max(ids.length, 1)) * 2 * Math.PI;
      pos.set(id, {
        x: fp.x + Math.cos(angle) * 14,
        y: fp.y + Math.sin(angle) * 14,
      });
    });
  });
  for (const s of symbols) {
    if (!pos.has(s.id)) {
      pos.set(s.id, { x: (Math.random() - 0.5) * R, y: (Math.random() - 0.5) * R });
    }
  }

  // Nudge connected cross-file symbols toward each other so the simulation
  // converges faster.
  const byId = new Map(data.nodes.map((n) => [n.id, n]));
  for (const e of edges) {
    const a = byId.get(e.from_id);
    const b = byId.get(e.to_id);
    if (a && b && a.type !== "module" && b.type !== "module") {
      const pa = pos.get(a.id);
      const pb = pos.get(b.id);
      if (pa && pb) {
        pa.x += (pb.x - pa.x) * 0.05;
        pa.y += (pb.y - pa.y) * 0.05;
        pb.x -= (pb.x - pa.x) * 0.05;
        pb.y -= (pb.y - pa.y) * 0.05;
      }
    }
  }

  return pos;
}

