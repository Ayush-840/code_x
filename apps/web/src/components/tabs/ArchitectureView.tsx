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
 * Presentational renderer for the architecture artifact, shared by the authed
 * ArchitectureTab and the public analyze page.
 *
 * Deliberately NOT the old eyebrow-label + panel-per-section formula: one real
 * heading, sections separated by spacing and plain h3s, stack as a single line
 * of text, components as a divided list. The only rule between items is where
 * it aids scanning (the component list). Every section is conditional, so
 * partial artifact shapes degrade gracefully.
 */
export function ArchitectureView({ arch }: { arch: Architecture }) {
  const stackItems = Array.isArray(arch.stack)
    ? arch.stack
    : (() => {
        const stack = arch.stack as ArchStack | undefined;
        const langs = stack?.languages ? Object.keys(stack.languages) : [];
        return [...(stack?.frameworks ?? []), ...langs];
      })();

  const entryPointLabels = (arch.entryPoints ?? []).map((ep) =>
    typeof ep === "string" ? ep : `${ep.path ?? ""} (${ep.module ?? ""})`
  );

  return (
    <div className="max-w-3xl">
      <h2 className="text-2xl font-display text-white mb-1">Architecture</h2>
      {arch.summary && (
        <p className="text-lab-textMuted leading-relaxed mt-3 mb-8">{arch.summary}</p>
      )}
      {!arch.summary && <div className="mb-8" />}

      {stackItems.length > 0 && (
        <div className="mb-8">
          <h3 className="text-sm font-semibold text-white mb-2">Stack</h3>
          <p className="text-sm text-lab-textMuted">{stackItems.join(" · ")}</p>
        </div>
      )}

      {arch.components && arch.components.length > 0 && (
        <div className="mb-8">
          <h3 className="text-sm font-semibold text-white mb-1">Components</h3>
          <div className="divide-y divide-lab-border">
            {arch.components.map((c) => (
              <div key={c.name} className="py-3">
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-sm text-white">{c.name}</span>
                  <span className="text-xs text-lab-textMuted">{c.role}</span>
                </div>
                {(c.files !== undefined || c.lines !== undefined) && (
                  <p className="text-xs text-lab-dim mt-1 font-mono">
                    {c.files ?? "—"} files
                    {c.lines !== undefined ? ` · ${c.lines.toLocaleString()} lines` : ""}
                  </p>
                )}
                {(c.dependsOn?.length ?? 0) > 0 && (
                  <p className="text-xs text-lab-dim mt-1 font-mono">
                    depends on {c.dependsOn!.join(", ")}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {entryPointLabels.length > 0 && (
        <div className="mb-8">
          <h3 className="text-sm font-semibold text-white mb-2">Entry points</h3>
          <ul className="text-sm font-mono text-lab-textMuted space-y-1">
            {entryPointLabels.map((label, i) => (
              <li key={i}>{label}</li>
            ))}
          </ul>
        </div>
      )}

      {arch.diagram && (
        <div>
          <h3 className="text-sm font-semibold text-white mb-3">Diagram</h3>
          <MermaidDiagram chart={arch.diagram} />
        </div>
      )}
    </div>
  );
}
