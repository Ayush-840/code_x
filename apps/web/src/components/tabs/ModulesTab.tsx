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

/**
 * Modules are sequential — a reading order, not a grid of equal tiles — so
 * this is a numbered list separated by rules, expanding in place. Stats
 * (files/lines/complexity) live inside the expanded body where they support
 * the walkthrough instead of decorating the collapsed row.
 */
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
    <div className="max-w-3xl">
      <h2 className="text-2xl font-display text-white mb-1">Modules</h2>
      <p className="text-lab-textMuted text-sm mt-2 mb-6">
        {modules.length === 1
          ? "One module — here's the walkthrough."
          : `${modules.length} modules, in the order we'd read the codebase.`}
      </p>

      <div className="divide-y divide-lab-border">
        {sorted.map((mod, i) => {
          const key = mod.id ?? mod.name;
          const isOpen = expanded === key;
          const desc = mod.purpose ?? mod.purposeSummary;
          const stats = [
            mod.fileCount !== undefined ? `${mod.fileCount} files` : null,
            mod.lineCount !== undefined ? `${mod.lineCount.toLocaleString()} lines` : null,
            mod.complexityScore != null ? `complexity ${Math.round(mod.complexityScore)}` : null,
          ].filter(Boolean);

          return (
            <div key={key} className="py-3">
              <button
                onClick={() => setExpanded(isOpen ? null : key)}
                className="w-full flex items-baseline gap-3 text-left"
                aria-expanded={isOpen}
              >
                <span className="text-xs text-lab-dim font-mono tabular-nums w-6 shrink-0 pt-1">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="font-semibold text-white text-base">{mod.name}</span>
                  {desc && !isOpen && (
                    <span className="block text-sm text-lab-textMuted mt-0.5 line-clamp-1">{desc}</span>
                  )}
                </span>
                {mod.path && (
                  <code className="hidden sm:block text-xs font-mono text-lab-dim truncate max-w-[220px] shrink-0">
                    {mod.path}
                  </code>
                )}
                <ChevronDown
                  className={`w-4 h-4 shrink-0 text-lab-dim transition-transform ${isOpen ? "rotate-180" : ""}`}
                />
              </button>

              {isOpen && (
                <div className="pl-9 pr-1 mt-3 space-y-5">
                  {desc && (
                    <div>
                      <h4 className="text-sm font-semibold text-white mb-1">Purpose</h4>
                      <p className="text-sm text-lab-textMuted leading-relaxed">{desc}</p>
                    </div>
                  )}
                  {mod.abstractions && mod.abstractions.length > 0 && (
                    <div>
                      <h4 className="text-sm font-semibold text-white mb-1">Key abstractions</h4>
                      <p className="text-sm font-mono text-lab-textMuted">{mod.abstractions.join(" · ")}</p>
                    </div>
                  )}
                  {mod.failureModes && mod.failureModes.length > 0 && (
                    <div>
                      <h4 className="text-sm font-semibold text-white mb-1">Common failure modes</h4>
                      <ul className="text-sm text-lab-textMuted space-y-1.5 leading-relaxed">
                        {mod.failureModes.map((f, j) => (
                          <li key={j} className="flex gap-2">
                            <span className="text-red-400 shrink-0">•</span>
                            <span>{f}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {mod.talkingPoints && mod.talkingPoints.length > 0 && (
                    <div>
                      <h4 className="text-sm font-semibold text-white mb-1">Interview talking points</h4>
                      <ul className="text-sm text-lab-textMuted space-y-1.5 leading-relaxed">
                        {mod.talkingPoints.map((tp, j) => (
                          <li key={j} className="flex gap-2">
                            <span className="text-lab-blue shrink-0">•</span>
                            <span>{tp}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {stats.length > 0 && (
                    <p className="text-xs font-mono text-lab-dim">{stats.join(" · ")}</p>
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
    <div className="flex items-center justify-center h-64 text-lab-textMuted">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-2 border-lab-blue border-t-transparent rounded-full animate-spin" />
        <p>Fetching your module walkthroughs…</p>
      </div>
    </div>
  );
}

function EmptyState({ error }: { error?: string }) {
  return (
    <div className="max-w-3xl py-16 text-center">
      <div className="text-4xl mb-2">🧩</div>
      <h3 className="text-white font-semibold mb-1">
        {error ? "We hit a snag loading modules" : "No modules yet"}
      </h3>
      <p className="text-lab-textMuted text-sm max-w-md mx-auto">
        {error
          ? `${error} — a refresh usually does it. If not, re-run the analysis below.`
          : "Run the analysis pipeline and we'll break the codebase into modules with a suggested reading order."}
      </p>
    </div>
  );
}
