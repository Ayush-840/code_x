"use client";

import { useEffect, useState } from "react";
import { useAuthedFetch } from "@/lib/api";

interface DeployFile {
  type: string;
  preview?: string;
}

export function DeploymentTab({ repoId }: { repoId: string }) {
  const api = useAuthedFetch();
  const [files, setFiles] = useState<Record<string, DeployFile> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    api.get<{ content: Record<string, DeployFile> }>(`/repos/${repoId}/deployment`)
      .then((res) => {
        const content = (res as unknown as { content?: Record<string, DeployFile> }).content;
        setFiles(content ?? null);
      })
      .catch(() => setFiles(null))
      .finally(() => setLoading(false));
  }, [api, repoId]);

  if (loading) {
    return (
      <div style={{ textAlign: "center", padding: "60px 24px" }}>
        <div className="spinner" style={{ margin: "0 auto 16px" }} />
        <p style={{ color: "var(--text-muted)" }}>Loading deployment info…</p>
      </div>
    );
  }

  if (!files || Object.keys(files).length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-icon">🚀</div>
        <h3>No deployment configuration detected</h3>
        <p>No Dockerfile, docker-compose, vercel.json, railway.toml, or similar deployment files were found.</p>
      </div>
    );
  }

  const entries = Object.entries(files);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ marginBottom: 8, fontSize: 14, color: "var(--text-muted)" }}>
        {entries.length} deployment file{entries.length !== 1 ? "s" : ""} detected
      </div>
      {entries.map(([path, file]) => (
        <div key={path} className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "14px 20px", display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 14 }}>📄</span>
            <code style={{
              background: "var(--surface-3)", borderRadius: 4, padding: "2px 8px",
              fontSize: 13, color: "#e2e8f0", fontFamily: "monospace",
            }}>
              {path}
            </code>
            <span style={{
              marginLeft: "auto", fontSize: 11, fontWeight: 600,
              background: "rgba(13,148,136,.15)", color: "#2dd4bf",
              borderRadius: 4, padding: "2px 8px", textTransform: "uppercase",
            }}>
              {file.type}
            </span>
          </div>
          {file.preview && (
            <div style={{
              borderTop: "1px solid var(--border)", padding: "12px 20px",
              background: "rgba(0,0,0,.2)",
            }}>
              <pre style={{
                fontSize: 12, lineHeight: 1.5, color: "var(--text-secondary)",
                whiteSpace: "pre-wrap", margin: 0, fontFamily: "monospace",
              }}>
                {file.preview}
              </pre>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
