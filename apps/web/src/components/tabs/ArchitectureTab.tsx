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
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Summary */}
      {arch.summary && (
        <div className="card">
          <h3 style={S.cardH}>Overview</h3>
          <p style={S.cardText}>{arch.summary}</p>
        </div>
      )}

      {/* Tech stack */}
      {arch.stack && (
        <div className="card">
          <h3 style={S.cardH}>Technology Stack</h3>
          <div style={S.pillRow}>
            {Array.isArray(arch.stack)
              ? arch.stack.map((s) => (
                  <span key={s} className="badge badge-teal" style={{ fontSize: 13, padding: "5px 12px" }}>{s}</span>
                ))
              : (() => {
                  const stack = arch.stack as { languages?: Record<string, number>; frameworks?: string[] };
                  const langs = stack.languages ? Object.keys(stack.languages) : [];
                  const frameworks = stack.frameworks ?? [];
                  return [...frameworks, ...langs].map((s) => (
                    <span key={s} className="badge badge-teal" style={{ fontSize: 13, padding: "5px 12px" }}>{s}</span>
                  ));
                })()}
          </div>
        </div>
      )}

      {/* Components */}
      {arch.components && arch.components.length > 0 && (
        <div className="card">
          <h3 style={S.cardH}>Components</h3>
          <div style={S.compGrid}>
            {arch.components.map((c) => (
              <div key={c.name} style={S.compCard}>
                <div style={S.compName}>{c.name}</div>
                <div style={S.compRole}>{c.role}</div>
                {c.dependsOn?.length > 0 && (
                  <div style={S.depRow}>
                    {c.dependsOn.map((d) => (
                      <span key={d} style={S.depChip}>{d}</span>
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
        <div className="card">
          <h3 style={S.cardH}>Entry Points</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {arch.entryPoints.map((ep, i) => {
              let label: string;
              if (typeof ep === "string") {
                label = ep;
              } else {
                const obj = ep as EntryPoint;
                label = `${obj.path ?? ""} (${obj.module ?? ""})`;
              }
              return <code key={i} style={S.codeChip}>{label}</code>;
            })}
          </div>
        </div>
      )}

      {/* Diagram — rendered, not raw text (PRD-G03) */}
      {arch.diagram && (
        <div className="card">
          <h3 style={S.cardH}>Architecture Diagram</h3>
          <MermaidDiagram chart={arch.diagram} />
        </div>
      )}
    </div>
  );
}

function LoadingState({ label }: { label?: string }) {
  return (
    <div style={{ textAlign: "center", padding: "60px 24px" }}>
      <div className="spinner" style={{ margin: "0 auto 16px" }} />
      <p style={{ color: "var(--text-muted)" }}>Loading {label ?? "data"}…</p>
    </div>
  );
}

function NotReadyState({ message }: { message?: string }) {
  return (
    <div className="empty-state">
      <div className="empty-icon">🏗️</div>
      <h3>Architecture not ready yet</h3>
      <p style={{ maxWidth: 380, margin: "0 auto" }}>
        {message
          ? `Error: ${message}`
          : "Run the analysis pipeline on your repository to generate the architecture overview."}
      </p>
    </div>
  );
}

const S = {
  cardH: { fontSize: 16, fontWeight: 700, marginBottom: 14, color: "var(--text-primary)" },
  cardText: { color: "var(--text-secondary)", lineHeight: 1.65, fontSize: 14 },
  pillRow: { display: "flex", flexWrap: "wrap" as const, gap: 8 },
  compGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))", gap: 12 },
  compCard: {
    background: "var(--surface-2)",
    border: "1px solid var(--border)",
    borderRadius: 10,
    padding: "14px 16px",
  },
  compName: { fontWeight: 700, fontSize: 15, marginBottom: 4, color: "var(--text-primary)" },
  compRole: { fontSize: 13, color: "var(--text-muted)", marginBottom: 10 },
  depRow: { display: "flex", flexWrap: "wrap" as const, gap: 6 },
  depChip: {
    background: "rgba(59,130,246,.12)",
    border: "1px solid rgba(59,130,246,.2)",
    borderRadius: 4,
    padding: "2px 8px",
    fontSize: 11,
    color: "#93c5fd",
    fontFamily: "monospace",
  },
  codeChip: {
    background: "var(--surface-3)",
    border: "1px solid var(--border)",
    borderRadius: 6,
    padding: "4px 10px",
    fontSize: 13,
    color: "#e2e8f0",
    fontFamily: "monospace",
  },
} as const;