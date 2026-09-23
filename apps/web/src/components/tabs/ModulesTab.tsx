"use client";

import { useEffect, useState } from "react";
import { useAuthedFetch } from "@/lib/api";
import { ChevronDown } from "lucide-react";

interface Module {
  id?: string;
  name: string;
  path?: string;
  purpose?: string;
  purposeSummary?: string;
  abstractions?: string[];
  failureModes?: string[];
  talkingPoints?: string[];
  complexityScore?: number | null;
  fileCount?: number;
  lineCount?: number;
  readingOrderIndex?: number | null;
}

export function ModulesTab({ repoId }: { repoId: string }) {
  const api = useAuthedFetch();
  const [modules, setModules] = useState<Module[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    api.get<{ content: { modules?: Module[] } }>(`/repos/${repoId}/modules`)
      .then((res) => {
        const content = (res as unknown as { content?: { modules?: Module[] } }).content;
        if (content?.modules) setModules(content.modules);
        else setModules(res as unknown as Module[]);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [api, repoId]);

  if (loading) return <LoadingState />;
  if (error) return <EmptyState error={error} />;
  if (modules.length === 0) return <EmptyState />;

  const sorted = [...modules].sort((a, b) => (a.readingOrderIndex ?? 999) - (b.readingOrderIndex ?? 999));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <p className="section-label">02 // MODULES</p>
        <h2 className="section-title">Module Explanations</h2>
      </div>

      <div className="panel space-y-3">
        <p className="text-sm text-lab-textMuted">
          {modules.length} module{modules.length !== 1 ? "s" : ""} detected · reading order
        </p>
        {sorted.map((mod, i) => {
          const key = mod.id ?? mod.name;
          const isOpen = expanded === key;
          const desc = mod.purpose ?? mod.purposeSummary;
          return (
            <div key={key} className="bg-lab-card border border-lab-border rounded-lg overflow-hidden">
              {/* Header row */}
              <button
                onClick={() => setExpanded(isOpen ? null : key)}
                className="w-full flex items-center gap-4 px-4 py-4 text-left hover:bg-lab-blue/5 transition-colors"
              >
                <div className="flex-1 text-left">
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-lab-textMuted font-bold min-w-[24px]">#{i + 1}</span>
                    <span className="font-semibold text-white text-base">{mod.name}</span>
                    {mod.path && (
                      <code className="px-2 py-0.5 rounded text-xs font-mono bg-lab-bg-raise border border-lab-border text-lab-textMuted">
                        {mod.path}
                      </code>
                    )}
                  </div>
                  {desc && !isOpen && (
                    <p className="text-sm text-lab-textMuted mt-1.5 line-clamp-1">{desc}</p>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  {mod.fileCount !== undefined && (
                    <span className="text-sm text-lab-textMuted">{mod.fileCount} files</span>
                  )}
                  {mod.lineCount !== undefined && (
                    <span className="text-sm text-lab-textMuted">{mod.lineCount.toLocaleString()} lines</span>
                  )}
                  {mod.complexityScore !== null && mod.complexityScore !== undefined && (
                    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-mono ${
                      mod.complexityScore > 70
                        ? "bg-red-500/20 text-red-400 border border-red-500/30"
                        : mod.complexityScore > 40
                        ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                        : "bg-green-500/20 text-green-400 border border-green-500/30"
                    }`}>
                      <span className="w-1 h-1 rounded-full bg-current shrink-0" />
                      Complexity {Math.round(mod.complexityScore)}
                    </span>
                  )}
                  <ChevronDown
                    className={`w-5 h-5 text-lab-textMuted transition-transform ${
                      isOpen ? "rotate-180" : ""
                    }`}
                  />
                </div>
              </button>

              {/* Expanded body */}
              {isOpen && (
                <div className="border-t border-lab-border px-4 pb-4 space-y-5 pt-4">
                  {desc && (
                    <div>
                      <p className="text-xs font-mono uppercase tracking-wider text-lab-textMuted mb-2">Purpose</p>
                      <p className="text-sm text-lab-textMuted leading-relaxed">{desc}</p>
                    </div>
                  )}
                  {mod.abstractions && mod.abstractions.length > 0 && (
                    <div>
                      <p className="text-xs font-mono uppercase tracking-wider text-lab-textMuted mb-2">Key abstractions</p>
                      <div className="flex flex-wrap gap-2">
                        {mod.abstractions.map((a) => (
                          <code key={a} className="px-2 py-1 rounded text-xs font-mono bg-lab-card border border-lab-border text-lab-text">
                            {a}
                          </code>
                        ))}
                      </div>
                    </div>
                  )}
                  {mod.failureModes && mod.failureModes.length > 0 && (
                    <div>
                      <p className="text-xs font-mono uppercase tracking-wider text-lab-textMuted mb-2">Common failure modes</p>
                      <ul className="space-y-2">
                        {mod.failureModes.map((f, i) => (
                          <li key={i} className="text-sm text-lab-textMuted leading-relaxed flex gap-2">
                            <span className="text-red-400 shrink-0">•</span>
                            <span>{f}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {mod.talkingPoints && mod.talkingPoints.length > 0 && (
                    <div>
                      <p className="text-xs font-mono uppercase tracking-wider text-lab-textMuted mb-2">💡 Interview talking points</p>
                      <ul className="space-y-2">
                        {mod.talkingPoints.map((tp, i) => (
                          <li key={i} className="text-sm text-lab-blue leading-relaxed flex gap-2">
                            <span className="text-lab-blue shrink-0">•</span>
                            <span>{tp}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="panel flex items-center justify-center h-64">
      <div className="flex flex-col items-center gap-3 text-lab-textMuted">
        <div className="w-8 h-8 border-2 border-lab-blue border-t-transparent rounded-full animate-spin" />
        <p>Loading modules…</p>
      </div>
    </div>
  );
}

function EmptyState({ error }: { error?: string }) {
  return (
    <div className="panel text-center py-12">
      <div className="text-4xl mb-2">🧩</div>
      <h3 className="text-lab-text font-semibold mb-1">No modules yet</h3>
      <p className="text-lab-textMuted text-sm">
        {error ? `Error: ${error}` : "Run the analysis pipeline to generate module explanations."}
      </p>
    </div>
  );
}