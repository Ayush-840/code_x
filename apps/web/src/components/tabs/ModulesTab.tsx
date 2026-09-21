"use client";

import { useEffect, useState } from "react";
import { useAuthedFetch } from "@/lib/api";

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
    // Try artifact first (richer data), fall back to CodeModule list
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
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ marginBottom: 8, fontSize: 14, color: "var(--text-muted)" }}>
        {modules.length} module{modules.length !== 1 ? "s" : ""} detected · reading order
      </div>
      {sorted.map((mod, i) => {
        const key = mod.id ?? mod.name;
        const isOpen = expanded === key;
        const desc = mod.purpose ?? mod.purposeSummary;
        return (
          <div key={key} className="card" style={{ padding: 0, overflow: "hidden" }}>
            {/* Header row */}
            <button
              onClick={() => setExpanded(isOpen ? null : key)}
              style={S.rowBtn}
            >
              <div style={{ flex: 1, textAlign: "left" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 700, minWidth: 20 }}>
                    #{i + 1}
                  </span>
                  <span style={{ fontSize: 16, fontWeight: 700, color: "var(--text-primary)" }}>
                    {mod.name}
                  </span>
                  {mod.path && <code style={S.pathChip}>{mod.path}</code>}
                </div>
                {desc && !isOpen && (
                  <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 3, lineHeight: 1.4 }}>
                    {desc.slice(0, 120)}{desc.length > 120 ? "…" : ""}
                  </p>
                )}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                {mod.fileCount !== undefined && (
                  <span style={S.meta}>{mod.fileCount} files</span>
                )}
                {mod.lineCount !== undefined && (
                  <span style={S.meta}>{mod.lineCount.toLocaleString()} lines</span>
                )}
                {mod.complexityScore !== null && mod.complexityScore !== undefined && (
                  <span className={`badge ${mod.complexityScore > 70 ? "badge-red" : mod.complexityScore > 40 ? "badge-amber" : "badge-green"}`}>
                    Complexity {Math.round(mod.complexityScore)}
                  </span>
                )}
                <span style={{ color: "var(--text-muted)", fontSize: 18, transition: "transform .2s", transform: isOpen ? "rotate(180deg)" : "none" }}>
                  ⌄
                </span>
              </div>
            </button>

            {/* Expanded body */}
            {isOpen && (
              <div style={S.body}>
                {desc && (
                  <div style={S.section}>
                    <div style={S.sectionLabel}>Purpose</div>
                    <p style={S.bodyText}>{desc}</p>
                  </div>
                )}
                {mod.abstractions && mod.abstractions.length > 0 && (
                  <div style={S.section}>
                    <div style={S.sectionLabel}>Key abstractions</div>
                    <div style={S.pillRow}>
                      {mod.abstractions.map((a) => <code key={a} style={S.codeChip}>{a}</code>)}
                    </div>
                  </div>
                )}
                {mod.failureModes && mod.failureModes.length > 0 && (
                  <div style={S.section}>
                    <div style={S.sectionLabel}>Common failure modes</div>
                    <ul style={S.list}>
                      {mod.failureModes.map((f, i) => <li key={i} style={S.listItem}>{f}</li>)}
                    </ul>
                  </div>
                )}
                {mod.talkingPoints && mod.talkingPoints.length > 0 && (
                  <div style={S.section}>
                    <div style={S.sectionLabel}>💡 Interview talking points</div>
                    <ul style={S.list}>
                      {mod.talkingPoints.map((tp, i) => <li key={i} style={{ ...S.listItem, color: "#2dd4bf" }}>{tp}</li>)}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function LoadingState() {
  return (
    <div style={{ textAlign: "center", padding: "60px 24px" }}>
      <div className="spinner" style={{ margin: "0 auto 16px" }} />
      <p style={{ color: "var(--text-muted)" }}>Loading modules…</p>
    </div>
  );
}

function EmptyState({ error }: { error?: string }) {
  return (
    <div className="empty-state">
      <div className="empty-icon">🧩</div>
      <h3>No modules yet</h3>
      <p>{error ? `Error: ${error}` : "Run the analysis pipeline to generate module explanations."}</p>
    </div>
  );
}

const S = {
  rowBtn: {
    width: "100%",
    background: "none",
    border: "none",
    padding: "16px 20px",
    display: "flex",
    alignItems: "center",
    gap: 12,
    cursor: "pointer",
  },
  pathChip: {
    background: "var(--surface-3)",
    borderRadius: 4,
    padding: "1px 8px",
    fontSize: 12,
    color: "var(--text-muted)",
    fontFamily: "monospace",
  },
  meta: { fontSize: 13, color: "var(--text-muted)" },
  body: {
    padding: "0 20px 20px",
    borderTop: "1px solid var(--border)",
    display: "flex",
    flexDirection: "column" as const,
    gap: 16,
    paddingTop: 16,
  },
  section: {},
  sectionLabel: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: ".06em",
    textTransform: "uppercase" as const,
    color: "var(--text-muted)",
    marginBottom: 8,
  },
  bodyText: { fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.65 },
  pillRow: { display: "flex", flexWrap: "wrap" as const, gap: 8 },
  codeChip: {
    background: "var(--surface-3)",
    border: "1px solid var(--border)",
    borderRadius: 4,
    padding: "2px 10px",
    fontSize: 12,
    color: "#e2e8f0",
    fontFamily: "monospace",
  },
  list: { paddingLeft: 20, display: "flex", flexDirection: "column" as const, gap: 6 },
  listItem: { fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.5 },
} as const;