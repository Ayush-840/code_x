"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";

/* ── Data shapes ─────────────────────────────────────────── */

export interface FileTreeNode {
  name: string;
  path: string;
  kind: "dir" | "file";
  children: FileTreeNode[];
}

interface GraphNode extends SimulationNodeDatum {
  id: string; // path
  name: string;
  kind: "dir" | "file";
  depth: number;
  parent: string | null;
  childCount: number; // dirs: total descendant files; files: 0
}

type GraphLink = SimulationLinkDatum<GraphNode>;

interface FileExplanation {
  summary?: string;
  sections?: { heading: string; text: string }[];
  questions?: { question: string; answer: string }[];
  citations?: { filePath: string; startLine: number; endLine: number }[];
  isDemo?: boolean;
}

/* ── Tree → graph (visible subset only) ──────────────────── */

export function countFiles(node: FileTreeNode): number {
  if (node.kind === "file") return 1;
  return node.children.reduce((acc, c) => acc + countFiles(c), 0);
}

// A directory auto-expands when its content is small enough that showing it
// outright keeps the first paint bounded on huge repos (PRD-G05): the root and
// every top-level directory always render, but a dir only reveals ITS children
// by default if it holds ≤12 entries and ≤200 files. Everything else stays
// collapsed until clicked.
const AUTO_EXPAND_MAX_CHILDREN = 12;
const AUTO_EXPAND_MAX_FILES = 200;

export function buildGraph(
  root: FileTreeNode,
  expanded: Set<string>
): { nodes: GraphNode[]; links: GraphLink[] } {
  const nodes: GraphNode[] = [];
  const links: GraphLink[] = [];

  const walk = (node: FileTreeNode, depth: number, parent: string | null) => {
    nodes.push({
      id: node.path || "/",
      name: node.name,
      kind: node.kind,
      depth,
      parent,
      childCount: node.kind === "dir" ? countFiles(node) : 0,
      // Radius scales with content volume; dirs slightly larger than files.
      r: node.kind === "dir" ? Math.min(10 + Math.log2(1 + countFiles(node)) * 2.5, 22) : 5,
    } as GraphNode & { r: number });
    if (parent) links.push({ source: parent, target: node.path || "/" });

    if (node.kind === "dir") {
      const small =
        node.children.length <= AUTO_EXPAND_MAX_CHILDREN &&
        countFiles(node) <= AUTO_EXPAND_MAX_FILES;
      const defaultOpen = depth === 0 || small;
      if (defaultOpen || expanded.has(node.path || "/")) {
        for (const child of node.children) walk(child, depth + 1, node.path || "/");
      }
    }
  };
  walk(root, 0, null);
  return { nodes, links };
}

/* ── File-type color ─────────────────────────────────────── */

function fileColor(name: string): string {
  const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
  const palette: Record<string, string> = {
    ts: "#3b82f6", tsx: "#60a5fa", js: "#f59e0b", jsx: "#fbbf24",
    py: "#22c55e", rb: "#ef4444", go: "#22d3ee", rs: "#f97316",
    css: "#a78bfa", scss: "#c084fc", html: "#fb7185", json: "#94a3b8",
    md: "#64748b", yml: "#64748b", yaml: "#64748b", toml: "#64748b",
    sql: "#34d399", sh: "#4ade80", prisma: "#818cf8",
  };
  return palette[ext] ?? "#64748b";
}

/* ── Component ───────────────────────────────────────────── */

export interface FileGraphProps {
  tree: FileTreeNode;
  explainFile: (path: string) => Promise<FileExplanation>;
  /** "dir" expands inline; "file" triggers the explain pane. */
  renderExplanation?: (explanation: FileExplanation, path: string) => React.ReactNode;
}

export function FileGraph({ tree, explainFile, renderExplanation }: FileGraphProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const simRef = useRef<Simulation<GraphNode, GraphLink> | null>(null);
  const nodesRef = useRef<GraphNode[]>([]);
  const linksRef = useRef<GraphLink[]>([]);

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [explanation, setExplanation] = useState<FileExplanation | null>(null);
  const [explainLoading, setExplainLoading] = useState(false);
  const [explainError, setExplainError] = useState<string | null>(null);
  // Bumped on every simulation tick so React re-renders node positions.
  const [, setTick] = useState(0);

  // Size tracking for the responsive svg viewBox
  const [size, setSize] = useState({ w: 900, h: 560 });
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const { width } = entries[0].contentRect;
      if (width > 0) setSize((s) => ({ ...s, w: width }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { nodes, links } = useMemo(() => buildGraph(tree, expanded), [tree, expanded]);

  // Keep a ref in sync so the d3 tick handler reads fresh arrays without
  // re-creating the simulation on every expand/collapse.
  useEffect(() => {
    const prevById = new Map(nodesRef.current.map((n) => [n.id, n]));
    // Preserve positions of surviving nodes so expansion feels continuous.
    for (const n of nodes) {
      const prev = prevById.get(n.id);
      if (prev) {
        n.x = prev.x;
        n.y = prev.y;
      }
    }
    nodesRef.current = nodes;
    linksRef.current = links;

    if (!simRef.current) {
      simRef.current = forceSimulation<GraphNode, GraphLink>(nodesRef.current)
        .force("charge", forceManyBody<GraphNode>().strength(-180))
        .force(
          "link",
          forceLink<GraphNode, GraphLink>(linksRef.current)
            .id((d) => d.id)
            .distance((d) => {
              const s = d.source as GraphNode;
              const t = d.target as GraphNode;
              return (s.kind === "dir" ? 70 : 46) + Math.min(t.childCount, 40);
            })
        )
        .force("center", forceCenter(size.w / 2, size.h / 2))
        .force(
          "collide",
          forceCollide<GraphNode>((d) => ((d as GraphNode & { r: number }).r ?? 8) + 6)
        )
        .alphaDecay(0.05);
    } else {
      simRef.current.nodes(nodesRef.current);
      (simRef.current.force("link") as ReturnType<typeof forceLink<GraphNode, GraphLink>>)
        .links(linksRef.current);
      simRef.current.alpha(0.5).restart();
    }
  }, [nodes, links, size.w, size.h]);

  // Center force tracks container size
  useEffect(() => {
    simRef.current?.force("center", forceCenter(size.w / 2, size.h / 2));
    simRef.current?.alpha(0.3).restart();
  }, [size.w, size.h]);

  useEffect(() => {
    return () => {
      simRef.current?.stop();
    };
  }, []);

  // Simulation tick → re-render. Visible node count stays bounded (directories
  // collapse), so per-tick React renders are fine and keep everything declarative.
  useEffect(() => {
    if (!simRef.current) return;
    const tick = () => setTick((t) => (t + 1) % 1000000);
    simRef.current.on("tick", tick);
    return () => {
      simRef.current?.on("tick", null);
    };
  }, [nodes, links]);

  const toggleDir = useCallback((path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const handleNodeClick = useCallback(
    async (node: GraphNode) => {
      if (node.kind === "dir") {
        toggleDir(node.id);
        return;
      }
      setSelected(node.id);
      if (explanation && selected === node.id) return; // already showing
      setExplainLoading(true);
      setExplainError(null);
      try {
        const exp = await explainFile(node.id);
        setExplanation(exp);
      } catch (e) {
        setExplanation(null);
        setExplainError(e instanceof Error ? e.message : "Failed to explain file");
      } finally {
        setExplainLoading(false);
      }
    },
    [explanation, explainFile, selected, toggleDir]
  );

  const totalFiles = countFiles(tree);
  const visibleCount = nodes.length;

  return (
    <div ref={wrapRef} style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      <div style={{ display: "flex", gap: 16, alignItems: "baseline", marginBottom: 8 }}>
        <span style={{ fontSize: 13, color: "var(--text-muted)" }}>
          {totalFiles.toLocaleString()} files · {visibleCount.toLocaleString()} nodes visible
          {totalFiles > visibleCount && " (directories collapsed — click to expand)"}
        </span>
      </div>

      <div style={{ display: "flex", gap: 16, alignItems: "stretch", minHeight: 560 }}>
        <div
          style={{
            flex: "1 1 62%",
            border: "1px solid var(--border)",
            borderRadius: "var(--r-md)",
            background: "var(--surface)",
            overflow: "hidden",
            position: "relative",
          }}
        >
          <svg ref={svgRef} width="100%" height={560} viewBox={`0 0 ${size.w} 560`} role="img" aria-label="File graph">
            {links.map((l, i) => {
              const s = l.source as GraphNode;
              const t = l.target as GraphNode;
              return (
                <line
                  key={`l${i}`}
                  className="edge-line"
                  stroke={selected && (s.id === selected || t.id === selected) ? "var(--brand-400)" : "var(--border)"}
                  strokeWidth={1}
                  x1={(s.x ?? 0) || 0}
                  y1={(s.y ?? 0) || 0}
                  x2={(t.x ?? 0) || 0}
                  y2={(t.y ?? 0) || 0}
                />
              );
            })}
            {nodes.map((n) => {
              const r = (n as GraphNode & { r: number }).r ?? 6;
              const fill = n.kind === "dir" ? "var(--brand-500)" : fileColor(n.name);
              const isSel = selected === n.id;
              return (
                <g key={n.id} onClick={() => void handleNodeClick(n)} style={{ cursor: "pointer" }}>
                  <circle
                    className="node-dot"
                    r={r}
                    fill={fill}
                    stroke={isSel ? "var(--text-primary)" : "rgba(0,0,0,.35)"}
                    strokeWidth={isSel ? 2.5 : 1}
                    opacity={n.kind === "dir" ? 0.95 : 0.85}
                  />
                  <text
                    className="node-label"
                    fontSize={n.kind === "dir" ? 12 : 10.5}
                    fontWeight={n.kind === "dir" ? 700 : 400}
                    fill={n.kind === "dir" ? "var(--text-primary)" : "var(--text-secondary)"}
                    fontFamily="var(--font-mono)"
                    style={{ pointerEvents: "none", userSelect: "none" }}
                  >
                    {n.kind === "dir" ? `${n.name}/ (${n.childCount})` : n.name}
                  </text>
                </g>
              );
            })}
          </svg>
          <div
            style={{
              position: "absolute",
              left: 12,
              bottom: 10,
              fontSize: 11,
              color: "var(--text-muted)",
            }}
          >
            ● directory ● file — click a directory to expand, a file to explain
          </div>
        </div>

        {/* Detail pane */}
        <div
          style={{
            flex: "1 1 38%",
            minWidth: 280,
            border: "1px solid var(--border)",
            borderRadius: "var(--r-md)",
            background: "var(--surface-2)",
            padding: 16,
            overflowY: "auto",
            maxHeight: 560,
          }}
        >
          {!selected && (
            <div style={{ color: "var(--text-muted)", fontSize: 14, lineHeight: 1.6 }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>📂</div>
              Click any file node to get a grounded explanation of that file —
              what it does, how it connects, and likely interview questions.
            </div>
          )}
          {selected && explainLoading && (
            <div style={{ color: "var(--text-muted)", fontSize: 14 }}>
              <div className="spinner" style={{ margin: "0 auto 12px" }} />
              Explaining <code style={{ fontFamily: "var(--font-mono)" }}>{selected}</code>…
            </div>
          )}
          {selected && explainError && (
            <div style={{ color: "var(--red)", fontSize: 14 }}>
              {explainError}
              <button
                className="btn btn-ghost btn-sm"
                style={{ display: "block", marginTop: 10 }}
                onClick={() => {
                  const node = nodes.find((n) => n.id === selected);
                  if (node) void handleNodeClick(node);
                }}
              >
                Retry
              </button>
            </div>
          )}
          {selected && explanation && !explainLoading && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <code
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 12,
                  color: "var(--brand-400)",
                  wordBreak: "break-all",
                }}
              >
                {selected}
              </code>
              {explanation.isDemo && (
                <span className="badge badge-gray" style={{ alignSelf: "flex-start" }}>
                  demo mode
                </span>
              )}
              <p style={{ fontSize: 14, lineHeight: 1.65, color: "var(--text-primary)" }}>
                {explanation.summary}
              </p>
              {explanation.sections?.map((sec, i) => (
                <div key={i}>
                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4, color: "var(--text-secondary)" }}>
                    {sec.heading}
                  </div>
                  <p style={{ fontSize: 13, lineHeight: 1.6, color: "var(--text-secondary)" }}>
                    {sec.text}
                  </p>
                </div>
              ))}
              {explanation.questions && explanation.questions.length > 0 && (
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8, color: "var(--text-secondary)" }}>
                    🎤 Likely interview questions
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {explanation.questions.map((q, i) => (
                      <details key={i} style={detailsStyle}>
                        <summary style={{ cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
                          {q.question}
                        </summary>
                        <p style={{ fontSize: 13, lineHeight: 1.6, color: "var(--text-secondary)", marginTop: 8 }}>
                          {q.answer}
                        </p>
                      </details>
                    ))}
                  </div>
                </div>
              )}
              {explanation.citations && explanation.citations.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {explanation.citations.slice(0, 6).map((c, i) => (
                    <code
                      key={i}
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 11,
                        background: "var(--surface-3)",
                        borderRadius: 4,
                        padding: "2px 8px",
                        color: "var(--text-muted)",
                      }}
                    >
                      {c.filePath}:{c.startLine}–{c.endLine}
                    </code>
                  ))}
                </div>
              )}
              {renderExplanation?.(explanation, selected)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const detailsStyle = {
  border: "1px solid var(--border)",
  borderRadius: "var(--r-sm)",
  padding: "8px 12px",
  background: "var(--surface)",
} as const;
