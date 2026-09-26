"use client";

import { MermaidDiagram } from "@/components/MermaidDiagram";

export interface ArchComponent {
  name: string;
  role: string;
  dependsOn?: string[];
  files?: number;
  lines?: number;
}

export interface ArchEntryPoint {
  path?: string;
  module?: string;
}

export interface ArchStack {
  languages?: Record<string, number>;
  frameworks?: string[];
  detected?: boolean;
}

export interface Architecture {
  components?: ArchComponent[];
  entryPoints?: (string | ArchEntryPoint)[];
  stack?: ArchStack | string[];
  summary?: string;
  diagram?: string;
}

/**
 * Presentational renderer for the architecture artifact: summary, tech-stack
 * chips, component cards, entry points, and an optional mermaid diagram.
 * Shared by the authed ArchitectureTab and the public analyze page so both
 * render the same structured cards instead of a raw JSON dump. Every section
 * is conditional, so partial artifact shapes degrade gracefully.
 */
export function ArchitectureView({ arch }: { arch: Architecture }) {
  return (
    <div className="space-y-6">
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
                  const stack = arch.stack as ArchStack;
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
                {(c.files !== undefined || c.lines !== undefined) && (
                  <div className="text-[11px] font-mono text-lab-textMuted mb-2">
                    {c.files ?? "—"} files{c.lines !== undefined ? ` · ${c.lines.toLocaleString()} lines` : ""}
                  </div>
                )}
                {(c.dependsOn?.length ?? 0) > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {c.dependsOn!.map((d) => (
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
                label = `${ep.path ?? ""} (${ep.module ?? ""})`;
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
