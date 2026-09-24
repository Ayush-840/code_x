"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { Folder, FileCode, ArrowRight, ExternalLink, ChevronRight, ChevronDown, Filter, Loader2 } from "lucide-react";
import type { FileTreeNode } from "@/components/FileGraph";

interface FileExplanation {
  summary?: string;
  sections?: { heading: string; text: string }[];
  questions?: { question: string; answer: string }[];
  citations?: { filePath: string; startLine: number; endLine: number }[];
  flow?: { step: string; desc: string }[];
  isDemo?: boolean;
}

export interface FileGraphTabProps {
  fetchTree: () => Promise<FileTreeNode>;
  explainFile: (path: string) => Promise<FileExplanation>;
}

interface FileListItem {
  node: FileTreeNode;
  depth: number;
  parentPath: string;
  isExpanded: boolean;
}

function flattenTree(
  root: FileTreeNode,
  expanded: Set<string>,
  depth = 0,
  parentPath = ""
): FileListItem[] {
  const items: FileListItem[] = [];
  const path = parentPath ? `${parentPath}/${root.name}` : `/${root.name}`;

  items.push({
    node: root,
    depth,
    parentPath,
    isExpanded: expanded.has(path),
  });

  if (root.kind === "dir" && expanded.has(path)) {
    for (const child of root.children) {
      items.push(...flattenTree(child, expanded, depth + 1, path));
    }
  }

  return items;
}

function countFiles(node: FileTreeNode): number {
  if (node.kind === "file") return 1;
  return node.children.reduce((acc, c) => acc + countFiles(c), 0);
}

function getTopLevelDirs(root: FileTreeNode): string[] {
  const dirs = new Set<string>();
  for (const child of root.children) {
    if (child.kind === "dir") {
      dirs.add(child.name);
    } else {
      dirs.add("(root)");
    }
  }
  return Array.from(dirs).sort();
}

export function FileGraphTab({ fetchTree, explainFile }: FileGraphTabProps) {
  const [tree, setTree] = useState<FileTreeNode | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [explanation, setExplanation] = useState<FileExplanation | null>(null);
  const [explainLoading, setExplainLoading] = useState(false);
  const [explainError, setExplainError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "explained" | "unexplained">("all");
  const [dirFilter, setDirFilter] = useState<string>("all");
  // Mirrors `tree` for use inside effects without re-triggering them; also
  // distinguishes first load (spinner OK) from background refresh (must stay
  // silent) — the heart of the flicker fix (TRD-F01).
  const treeRef = useRef<FileTreeNode | null>(null);
  // Per-path explanation cache (PRD-F07): re-selecting a file is instant and
  // re-renders with new prop identities never re-request the same file.
  const explanationCache = useRef<Map<string, FileExplanation>>(new Map());

  // Load tree — first load shows the full-panel spinner; any later run of this
  // effect (a genuinely changed fetcher identity) refreshes silently in the
  // background and never tears down rendered content (PRD-F01/F04).
  useEffect(() => {
    let cancelled = false;
    const isRefetch = treeRef.current !== null;
    if (isRefetch) {
      setError(null);
    } else {
      setLoading(true);
    }
    fetchTree()
      .then((t) => {
        if (cancelled) return;
        treeRef.current = t;
        setTree(t);
        setError(null);
        // Auto-expand root and small top-level dirs (only on first load so a
        // silent refresh does not yank the user's collapse state).
        if (!isRefetch) {
          const initialExpanded = new Set<string>();
          initialExpanded.add(`/${t.name}`);
          for (const child of t.children) {
            if (child.kind === "dir" && child.children.length <= 12 && countFiles(child) <= 200) {
              initialExpanded.add(`/${t.name}/${child.name}`);
            }
          }
          setExpanded(initialExpanded);
        }
      })
      .catch((e) => {
        if (cancelled) return;
        // First load: full-panel error (nothing rendered yet). Background
        // refresh: inline banner — the cached tree stays mounted.
        setError(e instanceof Error ? e.message : "Failed to load file tree");
      })
      .finally(() => {
        if (!cancelled && !isRefetch) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [fetchTree]);

  // Fetch explanation when a file is selected — cache-first, request-guarded,
  // and errors surface inline with a working Retry (PRD-F07/F08).
  useEffect(() => {
    if (!selectedPath) {
      setExplanation(null);
      setExplainError(null);
      return;
    }
    const cached = explanationCache.current.get(selectedPath);
    if (cached) {
      setExplanation(cached);
      setExplainError(null);
      setExplainLoading(false);
      return;
    }
    let cancelled = false;
    setExplainLoading(true);
    setExplainError(null);
    explainFile(selectedPath)
      .then((exp) => {
        if (cancelled) return;
        explanationCache.current.set(selectedPath, exp);
        setExplanation(exp);
      })
      .catch((e) => {
        if (cancelled) return;
        setExplanation(null);
        setExplainError(e instanceof Error ? e.message : "Failed to explain file");
      })
      .finally(() => !cancelled && setExplainLoading(false));
    return () => { cancelled = true; };
  }, [selectedPath, explainFile]);

  const fileItems = useMemo(() => {
    if (!tree) return [];
    return flattenTree(tree, expanded);
  }, [tree, expanded]);

  const filteredItems = useMemo(() => {
    return fileItems.filter((item) => {
      if (item.node.kind === "dir") return true;
      if (filter === "all") return true;
      if (filter === "explained") return false; // would need explanation cache
      if (filter === "unexplained") return true;
      return true;
    }).filter((item) => {
      if (dirFilter === "all") return true;
      const topDir = item.node.path.split("/")[1] || "(root)";
      return dirFilter === topDir;
    });
  }, [fileItems, filter, dirFilter]);

  const topLevelDirs = useMemo(() => tree ? getTopLevelDirs(tree) : [], [tree]);

  const toggleDir = useCallback((path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(path) ? next.delete(path) : next.add(path);
      return next;
    });
  }, []);

  const handleFileClick = useCallback((path: string) => {
    setSelectedPath(path);
  }, []);

  // Guarded retry paths (PRD-F08): same loading/error handling as the
  // effects, no unhandled promise rejections.
  const retryRefresh = useCallback(() => {
    let cancelled = false;
    setError(null);
    fetchTree()
      .then((t) => {
        if (cancelled) return;
        treeRef.current = t;
        setTree(t);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load file tree");
      });
    return () => { cancelled = true; };
  }, [fetchTree]);

  const retryExplain = useCallback(
    (p: string) => {
      let cancelled = false;
      setExplainLoading(true);
      setExplainError(null);
      explainFile(p)
        .then((exp) => {
          if (cancelled) return;
          explanationCache.current.set(p, exp);
          setExplanation(exp);
        })
        .catch((e) => {
          if (!cancelled) {
            setExplanation(null);
            setExplainError(e instanceof Error ? e.message : "Failed to explain file");
          }
        })
        .finally(() => {
          if (!cancelled) setExplainLoading(false);
        });
      return () => { cancelled = true; };
    },
    [explainFile]
  );

  if (loading) {
    return (
      <div className="panel flex items-center justify-center h-[600px]">
        <div className="flex flex-col items-center gap-4 text-lab-textMuted">
          <Loader2 className="w-8 h-8 text-lab-blue animate-spin" />
          <p>Loading file graph…</p>
        </div>
      </div>
    );
  }

  // Full-panel error screen only when nothing has loaded yet (first load).
  // With a cached tree present, failures surface as an inline banner below
  // (PRD-F04) — tearing down rendered content was the flicker bug.
  if (error && !tree) {
    return (
      <div className="panel text-center">
        <div className="text-4xl mb-2">🗂️</div>
        <h3 className="text-lab-text font-semibold mb-1">File graph unavailable</h3>
        <p className="text-lab-textMuted text-sm max-w-md mx-auto">{error}</p>
      </div>
    );
  }

  if (!tree || tree.children.length === 0) {
    return (
      <div className="panel text-center">
        <div className="text-4xl mb-2">🗂️</div>
        <h3 className="text-lab-text font-semibold mb-1">No files parsed</h3>
        <p className="text-lab-textMuted text-sm max-w-md mx-auto">
          The analysis pipeline found no source files in this repository.
        </p>
      </div>
    );
  }

  const totalFiles = countFiles(tree);

  return (
    <div className="panel grid grid-cols-1 md:grid-cols-12 gap-6 p-4 sm:p-6 min-h-[600px]">
      {/* Inline refresh-error banner (PRD-F04): a failed background refresh
          keeps the cached tree rendered — never the full-panel error screen. */}
      {error && (
        <div className="md:col-span-12 flex items-center justify-between gap-3 px-3 py-2 rounded-lg border border-red-400/40 bg-red-400/10 text-xs font-mono">
          <span className="text-red-400">Refresh failed: {error}</span>
          <button
            onClick={() => retryRefresh()}
            className="btn px-2 py-1 text-[11px] bg-lab-blueDim text-lab-blue border border-lab-blue/30 hover:bg-lab-blue/20"
          >
            Retry
          </button>
        </div>
      )}

      {/* Left: File List Sidebar - 4 cols */}
      <div className="md:col-span-4 border-r border-lab-border pr-4 space-y-3 font-mono text-xs overflow-y-auto">
        {/* Header */}
        <div className="flex items-center gap-2 text-lab-textMuted uppercase tracking-wider pb-2 border-b border-lab-border">
          <Folder className="w-4 h-4 text-lab-blue" />
          <span>/{tree.name}</span>
          <span className="px-2 py-0.5 rounded text-[10px] bg-lab-blueDim text-lab-blue border border-lab-blue/30">
            {totalFiles} files
          </span>
        </div>

        {/* Filter Chips */}
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setFilter("all")}
            className={`px-2 py-1 rounded text-[10px] font-mono border transition-colors ${
              filter === "all"
                ? "bg-lab-blueDim text-lab-blue border-lab-blue/40"
                : "text-lab-textMuted hover:text-white border-lab-border hover:bg-lab-card"
            }`}
          >
            All
          </button>
          <button
            onClick={() => setFilter("unexplained")}
            className={`px-2 py-1 rounded text-[10px] font-mono border transition-colors ${
              filter === "unexplained"
                ? "bg-lab-blueDim text-lab-blue border-lab-blue/40"
                : "text-lab-textMuted hover:text-white border-lab-border hover:bg-lab-card"
            }`}
          >
            Unexplained
          </button>
          <button
            onClick={() => setFilter("explained")}
            className={`px-2 py-1 rounded text-[10px] font-mono border transition-colors ${
              filter === "explained"
                ? "bg-lab-blueDim text-lab-blue border-lab-blue/40"
                : "text-lab-textMuted hover:text-white border-lab-border hover:bg-lab-card"
            }`}
          >
            Explained
          </button>
        </div>

        {/* Directory Filter */}
        {topLevelDirs.length > 1 && (
          <div className="flex flex-wrap gap-2 pt-2 border-t border-lab-border">
            <button
              onClick={() => setDirFilter("all")}
              className={`px-2 py-1 rounded text-[10px] font-mono border transition-colors ${
                dirFilter === "all"
                  ? "bg-lab-blueDim text-lab-blue border-lab-blue/40"
                  : "text-lab-textMuted hover:text-white border-lab-border hover:bg-lab-card"
              }`}
            >
              All dirs
            </button>
            {topLevelDirs.map((dir) => (
              <button
                key={dir}
                onClick={() => setDirFilter(dir)}
                className={`px-2 py-1 rounded text-[10px] font-mono border transition-colors ${
                  dirFilter === dir
                    ? "bg-lab-blueDim text-lab-blue border-lab-blue/40"
                    : "text-lab-textMuted hover:text-white border-lab-border hover:bg-lab-card"
                }`}
              >
                {dir}
              </button>
            ))}
          </div>
        )}

        {/* File List */}
        <div className="space-y-1 max-h-[450px] overflow-y-auto pr-1">
          {filteredItems.map((item, idx) => {
            const isDir = item.node.kind === "dir";
            const isSelected = selectedPath === item.node.path;
            const hasChildren = isDir && item.node.children.length > 0;
            const isExpanded = item.isExpanded && hasChildren;
            const fileCount = isDir ? countFiles(item.node) : 0;

            return (
              <button
                key={item.node.path}
                onClick={() => isDir ? toggleDir(item.node.path) : handleFileClick(item.node.path)}
                className={`w-full text-left px-2 py-2 rounded transition-colors flex items-center gap-2 ${
                  isSelected
                    ? "bg-lab-blue/15 text-lab-blue border-l-2 border-lab-blue"
                    : "text-lab-textMuted hover:bg-lab-card hover:text-white"
                }`}
                style={{ paddingLeft: `${8 + item.depth * 12}px` }}
              >
                {isDir && hasChildren && (
                  <span className="flex-shrink-0 text-lab-blue" style={{ width: 16 }}>
                    {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                  </span>
                )}
                {!isDir && <span className="flex-shrink-0" style={{ width: 16 }} />}
                {isDir ? (
                  <Folder className={`w-3 h-3 flex-shrink-0 ${isSelected ? "text-lab-blue" : "text-lab-textMuted"}`} />
                ) : (
                  <FileCode className={`w-3 h-3 flex-shrink-0 ${isSelected ? "text-lab-blue" : "text-lab-textMuted"}`} />
                )}
                <span className="flex-1 truncate">{item.node.name}{isDir && "/"}</span>
                {isDir && fileCount > 0 && (
                  <span className="text-[9px] text-lab-dim px-1.5 py-0.5 rounded bg-lab-bg-raise">
                    {fileCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Right: Detail Panel - 8 cols */}
      <div className="md:col-span-8 font-mono space-y-6 overflow-y-auto pr-2">
        {!selectedPath ? (
          <div className="text-center py-12 text-lab-textMuted">
            <Folder className="w-12 h-12 mx-auto mb-4 text-lab-blue/30" />
            <p className="text-sm">Click a file in the sidebar to see its explanation</p>
            <p className="text-[11px] mt-1">Files are grouped by directory. Use filters to narrow down.</p>
          </div>
        ) : (
          <>
            {/* File header */}
            <div className="flex items-center gap-3 pb-3 border-b border-lab-border">
              <ExternalLink
                className="w-5 h-5 text-lab-textMuted hover:text-lab-blue transition-colors"
                onClick={(e) => { e.stopPropagation(); }}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 text-xs text-lab-textMuted uppercase tracking-wider">
                  {selectedPath.split("/").slice(0, -1).join("/") || "/"}{selectedPath.split("/").slice(0, -1).length > 0 && "/"}
                  <span className="font-semibold text-lab-text truncate">
                    {selectedPath.split("/").pop()}
                  </span>
                </div>
              </div>
            </div>

            {/* Explanation Content */}
            {explainLoading ? (
              <div className="flex items-center justify-center py-12 text-lab-textMuted">
                <Loader2 className="w-6 h-6 text-lab-blue animate-spin mr-2" />
                <span>Explaining <code className="text-lab-blue">{selectedPath}</code>…</span>
              </div>
            ) : explanation ? (
              <div>
                {/* Numbered Architecture Flow Steps */}
                {explanation.flow && explanation.flow.length > 0 ? (
                  <div className="space-y-2">
                    {explanation.flow.map((step, idx) => (
                      <div
                        key={idx}
                        className="p-3 bg-lab-bg border border-lab-border rounded-lg flex items-start gap-3 hover:border-lab-blue/40 transition-colors"
                      >
                        <div className="w-7 h-7 rounded bg-lab-blueDim text-lab-blue flex items-center justify-center text-xs font-bold shrink-0 font-display">
                          0{idx + 1}
                        </div>
                        <div className="flex-1 text-xs">
                          <div className="text-white font-semibold flex items-center gap-2">
                            <span>{step.step}</span>
                            {idx < explanation.flow!.length - 1 && <ArrowRight className="w-3 h-3 text-lab-blue" />}
                          </div>
                          <p className="text-lab-textMuted text-[11px] mt-0.5">{step.desc}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  /* Fallback: free-form explanation */
                  <p className="text-xs text-lab-textMuted leading-relaxed whitespace-pre-wrap">
                    {explanation.summary || explanation.sections?.[0]?.text || "No explanation available."}
                  </p>
                )}

                {/* Metric Pills - Citations */}
                {explanation.citations && explanation.citations.length > 0 && (
                  <div className="flex flex-wrap gap-2 pt-2 border-t border-lab-border">
                    <span className="text-[10px] text-lab-dim uppercase tracking-wider">Grounded in:</span>
                    {explanation.citations.slice(0, 6).map((c, i) => (
                      <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono bg-lab-blueDim text-lab-blue border border-lab-blue/30">
                        <span className="w-1 h-1 rounded-full bg-lab-blue shrink-0" />
                        {c.filePath}:{c.startLine}–{c.endLine}
                      </span>
                    ))}
                  </div>
                )}

                {/* Sections (if no flow but has sections) */}
                {!explanation.flow?.length && explanation.sections?.length ? (
                  <div className="space-y-3 pt-2">
                    {explanation.sections.map((sec, i) => (
                      <div key={i} className="p-3 bg-lab-card border border-lab-border rounded-lg">
                        <div className="text-xs font-semibold text-lab-text mb-1">{sec.heading}</div>
                        <p className="text-[11px] text-lab-textMuted leading-relaxed">{sec.text}</p>
                      </div>
                    ))}
                  </div>
                ) : null}

                {/* Interview Questions */}
                {explanation.questions && explanation.questions.length > 0 && (
                  <div className="pt-4 border-t border-lab-border">
                    <div className="section-label mb-3">03 // INTERVIEW QUESTIONS</div>
                    <div className="space-y-2">
                      {explanation.questions.map((q, i) => (
                        <details key={i} className="p-3 bg-lab-card border border-lab-border rounded-lg group">
                          <summary className="cursor-pointer font-semibold text-xs text-white flex items-center gap-2 list-none">
                            {q.question}
                            <ChevronDown className="w-4 h-4 text-lab-textMuted transition-transform group-open:rotate-180 shrink-0" />
                          </summary>
                          <p className="text-[11px] text-lab-textMuted leading-relaxed mt-2">{q.answer}</p>
                        </details>
                      ))}
                    </div>
                  </div>
                )}

                {explanation.isDemo && (
                  <div className="pt-4 border-t border-lab-border text-center">
                    <span className="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono bg-lab-blueDim text-lab-blue border border-lab-blue/30">
                      Demo mode — limited accuracy
                    </span>
                  </div>
                )}
              </div>
            ) : explainError ? (
              <div className="text-center py-12 text-lab-textMuted">
                <p className="text-sm text-red-400">{explainError}</p>
                <button
                  onClick={() => selectedPath && retryExplain(selectedPath)}
                  className="mt-4 btn px-3 py-1.5 text-sm bg-lab-blueDim text-lab-blue border border-lab-blue/30 hover:bg-lab-blue/20"
                >
                  Retry
                </button>
              </div>
            ) : (
              <div className="text-center py-12 text-lab-textMuted">
                <p className="text-sm">No explanation available for this file</p>
                <button
                  onClick={() => selectedPath && retryExplain(selectedPath)}
                  className="mt-4 btn px-3 py-1.5 text-sm bg-lab-blueDim text-lab-blue border border-lab-blue/30 hover:bg-lab-blue/20"
                >
                  Retry
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}