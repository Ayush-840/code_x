"use client";

import { useEffect, useState } from "react";
import { useAuthedFetch } from "@/lib/api";
import { MermaidDiagram } from "@/components/MermaidDiagram";

interface Component { name: string; role: string; dependsOn: string[]; }
interface EntryPoint { path?: string; module?: string; }
interface Stack { languages?: Record<string, number>; frameworks?: string[]; detected?: boolean; }
interface Architecture {
  components?: Component[];
  entryPoints?: (string | EntryPoint)[];
  stack?: Stack | string[];
  summary?: string;
  diagram?: string;
}

export function ArchitectureTab({ repoId }: { repoId: string }) {
  const api = useAuthedFetch();
  const [data, setData] = useState<{ content: Architecture } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    api.get<{ content: Architecture }>(`/repos/${repoId}/architecture`)
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [api, repoId]);

  if (loading) return <LoadingState label="architecture overview" />;
  if (error) return <NotReadyState message={error} />;
  if (!data) return <NotReadyState />;

  const arch = data.content ?? (data as unknown as Architecture);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <p className="section-label">01 // ARCHITECTURE</p>
        <h2 className="section-title">Architecture Overview</h2>
      </div>

      {/* Summary */}
      {arch.summary && (
        <div className="panel">
          <p className="text-sm text-lab-textMuted uppercase tracking-wider mb-3">Summary</p>
          <p className="text-lab-text text-base leading-relaxed">{arch.summary}</p>
        </div>
      )}

      {/* Tech stack */}
      {arch.stack && (
        <div className="panel">
          <p className="text-sm text-lab-textMuted uppercase tracking-wider mb-3">Technology Stack</p>
          <div className="flex flex-wrap gap-2">
            {Array.isArray(arch.stack)
              ? arch.stack.map((s) => (
                  <span key={s} className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-mono bg-lab-blueDim text-lab-blue border border-lab-blue/30">
                    <span className="w-1 h-1 rounded-full bg-lab-blue shrink-0" />
                    {s}
                  </span>
                ))
              : (() => {
                  const stack = arch.stack as { languages?: Record<string, number>; frameworks?: string[] };
                  const langs = stack.languages ? Object.keys(stack.languages) : [];
                  const frameworks = stack.frameworks ?? [];
                  return [...frameworks, ...langs].map((s) => (
                    <span key={s} className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-mono bg-lab-blueDim text-lab-blue border border-lab-blue/30">
                      <span className="w-1 h-1 rounded-full bg-lab-blue shrink-0" />
                      {s}
                    </span>
                  ));
                })()}
          </div>
        </div>
      )}

      {/* Components */}
      {arch.components && arch.components.length > 0 && (
        <div className="panel">
          <p className="text-sm text-lab-textMuted uppercase tracking-wider mb-3">Components</p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {arch.components.map((c) => (
              <div key={c.name} className="bg-lab-card border border-lab-border rounded-lg p-4 hover:border-lab-blue/40 transition-colors">
                <div className="font-semibold text-white mb-1 text-sm">{c.name}</div>
                <div className="text-lab-textMuted text-xs mb-2">{c.role}</div>
                {c.dependsOn?.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {c.dependsOn.map((d) => (
                      <span key={d} className="px-2 py-0.5 rounded text-[10px] font-mono bg-lab-blueDim text-lab-blue border border-lab-blue/30">
                        {d}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Entry points */}
      {arch.entryPoints && arch.entryPoints.length > 0 && (
        <div className="panel">
          <p className="text-sm text-lab-textMuted uppercase tracking-wider mb-3">Entry Points</p>
          <div className="space-y-2">
            {arch.entryPoints.map((ep, i) => {
              let label: string;
              if (typeof ep === "string") {
                label = ep;
              } else {
                const obj = ep as EntryPoint;
                label = `${obj.path ?? ""} (${obj.module ?? ""})`;
              }
              return (
                <code key={i} className="inline-flex items-center gap-1 px-3 py-1.5 rounded text-xs font-mono bg-lab-card border border-lab-border text-lab-textMuted hover:border-lab-blue/40 hover:text-white transition-colors">
                  {label}
                </code>
              );
            })}
          </div>
        </div>
      )}

      {/* Diagram — rendered, not raw text (PRD-G03) */}
      {arch.diagram && (
        <div className="panel">
          <p className="text-sm text-lab-textMuted uppercase tracking-wider mb-3">Architecture Diagram</p>
          <MermaidDiagram chart={arch.diagram} />
        </div>
      )}
    </div>
  );
}

function LoadingState({ label }: { label?: string }) {
  return (
    <div className="panel flex items-center justify-center h-64">
      <div className="flex flex-col items-center gap-3 text-lab-textMuted">
        <div className="w-8 h-8 border-2 border-lab-blue border-t-transparent rounded-full animate-spin" />
        <p>Loading {label ?? "data"}…</p>
      </div>
    </div>
  );
}

function NotReadyState({ message }: { message?: string }) {
  return (
    <div className="panel text-center py-12">
      <div className="text-4xl mb-2">🏗️</div>
      <h3 className="text-lab-text font-semibold mb-1">Architecture not ready yet</h3>
      <p className="text-lab-textMuted text-sm max-w-md mx-auto">
        {message ? `Error: ${message}` : "Run the analysis pipeline on your repository to generate the architecture overview."}
      </p>
    </div>
  );
}