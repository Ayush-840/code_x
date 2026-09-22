'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import dynamic from 'next/dynamic';
import axios from 'axios';
import { SidePanel } from '@/components/SidePanel';
import { Toolbar } from '@/components/Toolbar';
import { ChatPanel } from '@/components/ChatPanel';
import type { GraphData, GraphNode } from '@/lib/types';

// react-force-graph-2d touches window during import — client-only, no SSR.
const ForceGraph2D = dynamic(() => import('react-force-graph-2d'), { ssr: false });

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

const TYPE_COLORS: Record<string, string> = {
  module: '#60a5fa',
  class: '#c084fc',
  function: '#4ade80',
};

type GraphNodeRuntime = GraphNode & { x?: number; y?: number; fx?: number; fy?: number };

interface FGNode {
  id: string;
  name: string;
  type: string;
  color: string;
  r: number;
  x?: number;
  y?: number;
  fx?: number;
  fy?: number;
  __cited?: boolean;
  __selected?: boolean;
}

interface FGLink {
  source: string | FGNode;
  target: string | FGNode;
  type: string;
  __active?: boolean;
}

export default function Home() {
  const [graphData, setGraphData] = useState<GraphData | null>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [explanation, setExplanation] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [repoPath, setRepoPath] = useState('');
  const [parsing, setParsing] = useState(false);
  const [activeTab, setActiveTab] = useState<'inspector' | 'chat'>('inspector');
  const [highlightedIds, setHighlightedIds] = useState<Set<string>>(new Set());

  const [chatQuestion, setChatQuestion] = useState('');
  const [chatAnswer, setChatAnswer] = useState('');
  const [chatCitedNodes, setChatCitedNodes] = useState<string[]>([]);
  const [chatLoading, setChatLoading] = useState(false);

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const graphRef = useRef<any>(null);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);

  // Measure the wrapper instead of reading window at render time — the old
  // version read window.innerWidth during SSR and broke `next build`.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () =>
      setDims({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [graphData]);

  // Restore the last parsed repo and load whatever the API still holds.
  useEffect(() => {
    const saved = window.localStorage.getItem('codegraph-repo-path');
    if (saved) {
      setRepoPath(saved);
      setLoading(true);
      axios
        .get(`${API_URL}/graph`)
        .then((res) => setGraphData(res.data))
        .catch(() => setGraphData(null))
        .finally(() => setLoading(false));
    }
  }, []);

  const handleParse = useCallback(async () => {
    const path = repoPath.trim();
    if (!path) return;
    setParsing(true);
    setError(null);
    setSelectedNode(null);
    setExplanation('');
    setChatAnswer('');
    setChatCitedNodes([]);
    setHighlightedIds(new Set());
    window.localStorage.setItem('codegraph-repo-path', path);
    try {
      const parseRes = await axios.post(`${API_URL}/parse`, { repo_path: path });
      if (!parseRes.data?.nodes) throw new Error('Parser returned no data');
      const graphRes = await axios.get<GraphData>(`${API_URL}/graph`);
      setGraphData(graphRes.data);
      if (!graphRes.data.nodes?.length) {
        setError('No Python files were found in that path.');
      }
    } catch (err) {
      const detail =
        axios.isAxiosError(err) && err.response?.data?.detail
          ? String(err.response.data.detail)
          : 'Failed to parse repository — is the API running?';
      setError(detail);
    } finally {
      setParsing(false);
    }
  }, [repoPath]);

  const handleNodeClick = useCallback(async (raw: unknown) => {
    const node = raw as FGNode;
    const target = graphData?.nodes.find((n) => n.id === node.id) ?? null;
    setSelectedNode(target);
    setActiveTab('inspector');
    setExplanation('');
    if (!target) return;
    try {
      const res = await axios.get(
        `${API_URL}/node/${encodeURIComponent(target.id)}/explain`
      );
      setExplanation(res.data.explanation);
    } catch {
      setExplanation('Failed to load explanation for this node.');
    }
  }, [graphData]);

  const handleChat = useCallback(async () => {
    const q = chatQuestion.trim();
    if (!q) return;
    setChatLoading(true);
    try {
      const res = await axios.post(`${API_URL}/chat`, { question: q });
      setChatAnswer(res.data.answer);
      setChatCitedNodes(res.data.cited_nodes ?? []);
      setHighlightedIds(new Set(res.data.cited_nodes ?? []));
      if ((res.data.cited_nodes ?? []).length > 0) setActiveTab('chat');
    } catch {
      setChatAnswer('Failed to get an answer — check that the API is running.');
      setChatCitedNodes([]);
      setHighlightedIds(new Set());
    } finally {
      setChatLoading(false);
    }
  }, [chatQuestion]);

  const handleCiteClick = useCallback((id: string) => {
    setHighlightedIds((prev) => {
      const next = new Set(prev);
      if (prev.size === 1 && prev.has(id)) return new Set<string>();
      next.clear();
      next.add(id);
      return next;
    });
  }, []);

  const clearHighlights = useCallback(() => {
    setHighlightedIds(new Set());
  }, []);

  // Build the force-graph payload from the API's from_id/to_id edges — the
  // old code mapped e.source/e.target and silently dropped every link.
  const fgGraph = useMemo(() => {
    if (!graphData) return null;
    const byId = new Map(graphData.nodes.map((n) => [n.id, n]));
    const valid = graphData.edges.filter(
      (e) => byId.has(e.from_id) && byId.has(e.to_id)
    );
    const pos = layout(graphData, valid);
    const nodes: FGNode[] = graphData.nodes.map((n) => ({
      id: n.id,
      name: n.name,
      type: n.type,
      color: TYPE_COLORS[n.type] ?? '#9ca3af',
      r: n.type === 'module' ? 5 : n.type === 'class' ? 4 : 3,
      x: pos.get(n.id)?.x,
      y: pos.get(n.id)?.y,
      // Pin files to the radial layout; symbols stay free so links can
      // relax them into something readable.
      ...(n.type === 'module'
        ? { fx: pos.get(n.id)?.x, fy: pos.get(n.id)?.y }
        : {}),
    }));
    const links: FGLink[] = valid.map((e) => ({
      source: e.from_id,
      target: e.to_id,
      type: e.type,
    }));
    return { nodes, links };
  }, [graphData]);

  // Mirror highlight/selection onto node/link objects, then force a repaint —
  // force-graph stops its engine after cooldown, so in-place mutation needs
  // an explicit .refresh() or the highlight would only appear after panning.
  useEffect(() => {
    const g = graphRef.current;
    if (!g || !fgGraph) return;
    for (const n of g.graphData().nodes as FGNode[]) {
      n.__cited = highlightedIds.has(n.id);
      n.__selected = selectedNode?.id === n.id;
    }
    for (const l of g.graphData().links as FGLink[]) {
      const s = typeof l.source === 'object' ? (l.source as FGNode).id : l.source;
      const t = typeof l.target === 'object' ? (l.target as FGNode).id : l.target;
      l.__active =
        !!s && !!t && (highlightedIds.has(s) || highlightedIds.has(t));
    }
    g.refresh?.();
  }, [highlightedIds, selectedNode, fgGraph]);

  const paintNode = useCallback((node: FGNode, ctx: CanvasRenderingContext2D, scale: number) => {
    const r = node.r ?? 3;
    ctx.beginPath();
    ctx.arc(node.x ?? 0, node.y ?? 0, r, 0, 2 * Math.PI, false);
    ctx.fillStyle = node.__cited || node.__selected ? '#eab308' : node.color;
    ctx.fill();
    if (node.__cited || node.__selected) {
      ctx.strokeStyle = '#eab308';
      ctx.lineWidth = 1.5 / scale;
      ctx.stroke();
    }
    // Screen-constant label: counteract the global zoom scale.
    const fontSize = 4 / scale;
    ctx.font = `${fontSize}px JetBrains Mono, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = node.__cited || node.__selected ? '#fde68a' : 'rgba(165,180,252,0.75)';
    ctx.fillText(node.name, node.x ?? 0, (node.y ?? 0) + r + 2 / scale);
  }, []);

  const paintLink = useCallback((link: FGLink, ctx: CanvasRenderingContext2D) => {
    const s = link.source as FGNode;
    const t = link.target as FGNode;
    if (!s?.x || !t?.x) return;
    ctx.beginPath();
    ctx.moveTo(s.x, s.y ?? 0);
    ctx.lineTo(t.x, t.y ?? 0);
    ctx.strokeStyle = link.__active ? 'rgba(74,222,128,0.9)' : 'rgba(75,85,99,0.35)';
    ctx.lineWidth = link.__active ? 1.2 : 0.7;
    if (link.type === 'calls') {
      ctx.setLineDash([3, 3]);
    } else {
      ctx.setLineDash([]);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }, []);

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden">
      <Toolbar
        repoPath={repoPath}
        setRepoPath={setRepoPath}
        parsing={parsing}
        onParse={handleParse}
        nodeCount={graphData?.nodes.length ?? 0}
        edgeCount={graphData?.edges.length ?? 0}
      />

      {error && (
        <div className="px-4 py-2 bg-red-950/60 border-b border-red-800 text-sm text-red-300 flex items-center justify-between shrink-0">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-200" aria-label="Dismiss">
            ✕
          </button>
        </div>
      )}

      <div className="flex-1 flex overflow-hidden min-h-0">
        <div className="flex-1 relative min-w-0" ref={wrapRef}>
          {dims && fgGraph && (
            <ForceGraph2D
              ref={graphRef}
              graphData={fgGraph}
              width={dims.w}
              height={dims.h}
              backgroundColor="#0a0a0a"
              nodeCanvasObject={paintNode as any}
              nodeCanvasObjectMode={() => 'replace'}
              linkCanvasObject={paintLink as any}
              linkCanvasObjectMode={() => 'replace'}
              onNodeClick={handleNodeClick}
              enableNodeDrag={false}
              d3AlphaDecay={0.03}
              d3VelocityDecay={0.4}
            />
          )}

          {fgGraph && (
            <button
              onClick={clearHighlights}
              disabled={highlightedIds.size === 0}
              className={`absolute top-3 right-3 btn text-xs ${
                highlightedIds.size === 0 ? 'btn-secondary opacity-40' : 'btn-primary'
              }`}
            >
              Clear highlight
            </button>
          )}

          {!fgGraph && !loading && !parsing && (
            <div className="flex items-center justify-center h-full text-gray-500 text-sm px-8 text-center">
              Enter an absolute path to a Python repository and click
              <span className="text-yellow-500 font-medium mx-1">Parse Repo</span>
              to build its code graph.
            </div>
          )}

          {(loading || parsing) && (
            <div className="absolute inset-0 bg-black/50 flex items-center justify-center z-10">
              <div className="animate-spin rounded-full h-12 w-12 border-4 border-yellow-500 border-t-transparent" />
            </div>
          )}
        </div>

        <aside className="w-96 shrink-0 flex flex-col border-l border-gray-800 bg-bg-elevated min-h-0">
          <div className="flex border-b border-gray-800 shrink-0">
            {(['inspector', 'chat'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setActiveTab(t)}
                className={`flex-1 px-4 py-2.5 text-sm font-medium transition-colors ${
                  activeTab === t
                    ? 'text-yellow-500 border-b-2 border-yellow-500 bg-gray-900/40'
                    : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                {t === 'inspector' ? 'Inspector' : 'Chat'}
              </button>
            ))}
          </div>

          <div className="flex-1 min-h-0">
            {activeTab === 'inspector' ? (
              <SidePanel selectedNode={selectedNode} explanation={explanation} />
            ) : (
              <ChatPanel
                question={chatQuestion}
                setQuestion={setChatQuestion}
                answer={chatAnswer}
                citedNodes={chatCitedNodes}
                loading={chatLoading}
                onAsk={handleChat}
                onCiteClick={handleCiteClick}
              />
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

/** Cheap radial layout: files are angle-sorted by directory so related code
 * lands together; symbols fan out around their file. Force simulation then
 * relaxes it (fx/fy pin files, symbols drift inside). */
function layout(
  data: GraphData,
  edges: { from_id: string; to_id: string }[]
): Map<string, { x: number; y: number }> {
  const pos = new Map<string, { x: number; y: number }>();
  const files = data.nodes.filter((n) => n.type === 'module');
  const R = 60 + files.length * 2;

  // Group files by directory for angular clustering.
  const byDir = new Map<string, string[]>();
  for (const f of files) {
    const dir = f.file.split('/').slice(0, -1).join('/');
    if (!byDir.has(dir)) byDir.set(dir, []);
    byDir.get(dir)!.push(f.id);
  }
  const dirs = [...byDir.keys()].sort();
  dirs.forEach((dir, di) => {
    const ids = byDir.get(dir)!;
    ids.forEach((id, i) => {
      const angle = (di / Math.max(dirs.length, 1)) * 2 * Math.PI + (i / ids.length) * 0.35;
      pos.set(id, { x: Math.cos(angle) * R, y: Math.sin(angle) * R });
    });
  });

  // Symbols: fan around their file if they have one, else use edges.
  const fileOf = (id: string) => id.split('::')[0];
  const symbols = data.nodes.filter((n) => n.type !== 'module');
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
    if (!pos.has(s.id)) pos.set(s.id, { x: (Math.random() - 0.5) * R, y: (Math.random() - 0.5) * R });
  }

  // Nudge connected cross-file symbols slightly toward each other so the
  // simulation converges faster.
  const byId = new Map(data.nodes.map((n) => [n.id, n]));
  for (const e of edges) {
    const a = byId.get(e.from_id);
    const b = byId.get(e.to_id);
    if (a && b && a.type !== 'module' && b.type !== 'module') {
      const pa = pos.get(a.id);
      const pb = pos.get(b.id);
      if (pa && pb) {
        const dx = pb.x - pa.x;
        const dy = pb.y - pa.y;
        pa.x += dx * 0.05;
        pa.y += dy * 0.05;
        pb.x -= dx * 0.05;
        pb.y -= dy * 0.05;
      }
    }
  }

  return pos;
}
