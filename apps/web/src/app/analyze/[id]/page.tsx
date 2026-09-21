"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { publicGet, publicPost, ApiError } from "@/lib/publicApi";

interface Module {
  id?: string;
  name: string;
  path?: string;
  purposeSummary?: string;
  complexityScore?: number | null;
  fileCount?: number;
  lineCount?: number;
  readingOrderIndex?: number | null;
  abstractions?: string[];
  failureModes?: string[];
}

interface Artifact {
  artifactType: string;
  content: Record<string, unknown>;
}

interface AnalysisResult {
  id: string;
  fullName: string;
  status: string;
  defaultBranch: string;
  createdAt: string;
  expiresAt: string;
  job: { stage?: string | null; progress: number; status: string } | null;
  modules: Module[];
  artifacts: Artifact[];
}

export default function PublicAnalysisPage() {
  const params = useParams();
  const id = params.id as string;
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"modules" | "architecture" | "deployment">("modules");

  useEffect(() => {
    let timer: ReturnType<typeof setInterval>;

    const poll = async () => {
      try {
        const data = await publicGet<AnalysisResult>(`/v1/public/${id}`);
        setResult(data);
        if (data.status !== "READY" && data.status !== "FAILED") {
          timer = setInterval(poll, 3000);
        }
      } catch (e) {
        setError(e instanceof ApiError ? e.message : "Failed to load analysis");
      }
    };
    poll();
    return () => clearInterval(timer);
  }, [id]);

  if (error) {
    return (
      <div style={S.page}>
        <div className="gradient-bg" />
        <div style={S.center}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>⚠</div>
          <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>Analysis not found</h2>
          <p style={{ color: "var(--text-muted)", fontSize: 14 }}>{error}</p>
          <a href="/analyze" className="btn btn-primary" style={{ marginTop: 24 }}>Analyze another repo</a>
        </div>
      </div>
    );
  }

  if (!result || result.status !== "READY") {
    const pct = result?.job?.progress ?? 0;
    const stage = result?.job?.stage ?? "QUEUED";
    return (
      <div style={S.page}>
        <div className="gradient-bg" />
        <div style={S.center}>
          <div className="spinner" style={{ margin: "0 auto 16px" }} />
          <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>
            Analyzing {result?.fullName ?? "repository"}…
          </h2>
          <p style={{ color: "var(--text-muted)", fontSize: 14, marginBottom: 16 }}>
            {stage} — {pct}%
          </p>
          <div style={S.progressTrack}>
            <div style={{ ...S.progressFill, width: `${pct}%` }} />
          </div>
        </div>
      </div>
    );
  }

  const archArtifact = result.artifacts.find((a) => a.artifactType === "architecture_overview");
  const deployArtifact = result.artifacts.find((a) => a.artifactType === "deployment");

  const claimAnalysis = async () => {
    try {
      const res = await publicPost<{ repoId: string }>(`/v1/public/${id}/claim`, {});
      window.location.href = `/repos/${res.repoId}`;
    } catch (e) {
      alert(e instanceof ApiError ? e.message : "Could not claim analysis. Are you signed in?");
    }
  };

  return (
    <div style={S.page}>
      <div className="gradient-bg" />

      <nav style={S.nav}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <a href="/analyze" style={S.logoLink}>
            <div style={S.logoIcon}>⚡</div>
          </a>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>{result.fullName}</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
              branch: {result.defaultBranch} · expires {new Date(result.expiresAt).toLocaleDateString()}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button className="btn btn-ghost btn-sm" onClick={() => void claimAnalysis()}>
            Claim to account
          </button>
          <a href="/login" className="btn btn-primary btn-sm">Sign in to save</a>
        </div>
      </nav>

      <div style={S.content}>
        <nav style={S.tabBar}>
          {(["modules", "architecture", "deployment"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setActiveTab(t)}
              style={{
                ...S.tabBtn,
                borderBottomColor: activeTab === t ? "#2dd4bf" : "transparent",
                color: activeTab === t ? "#f0f4ff" : "var(--text-muted)",
              }}
            >
              {t === "modules" && "🧩 "}
              {t === "architecture" && "🏗️ "}
              {t === "deployment" && "🚀 "}
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </nav>

        {activeTab === "modules" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 4 }}>
              {result.modules.length} module{result.modules.length !== 1 ? "s" : ""} · reading order
            </p>
            {result.modules
              .slice()
              .sort((a, b) => (a.readingOrderIndex ?? 999) - (b.readingOrderIndex ?? 999))
              .map((mod, i) => (
              <div key={mod.id ?? mod.name} className="card" style={{ padding: "16px 20px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
                  <span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 700, minWidth: 20 }}>
                    #{i + 1}
                  </span>
                  <span style={{ fontSize: 16, fontWeight: 700 }}>{mod.name}</span>
                  {mod.path && (
                    <code style={{ background: "var(--surface-3)", borderRadius: 4, padding: "1px 8px", fontSize: 12, color: "var(--text-muted)" }}>
                      {mod.path}
                    </code>
                  )}
                  <span style={{ marginLeft: "auto", fontSize: 13, color: "var(--text-muted)" }}>
                    {mod.fileCount} files · {mod.lineCount?.toLocaleString()} lines
                  </span>
                </div>
                {mod.purposeSummary && (
                  <p style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.5, marginTop: 6, marginLeft: 30 }}>
                    {mod.purposeSummary}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}

        {activeTab === "architecture" && (
          <div className="card" style={{ padding: 24 }}>
            {archArtifact ? (
              <pre style={{ fontSize: 13, lineHeight: 1.6, whiteSpace: "pre-wrap", color: "var(--text-secondary)" }}>
                {JSON.stringify(archArtifact.content, null, 2)}
              </pre>
            ) : (
              <p style={{ color: "var(--text-muted)" }}>No architecture overview generated.</p>
            )}
          </div>
        )}

        {activeTab === "deployment" && (
          <div className="card" style={{ padding: 24 }}>
            {deployArtifact ? (
              <pre style={{ fontSize: 13, lineHeight: 1.6, whiteSpace: "pre-wrap", color: "var(--text-secondary)" }}>
                {JSON.stringify(deployArtifact.content, null, 2)}
              </pre>
            ) : (
              <p style={{ color: "var(--text-muted)" }}>No deployment configuration detected.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const S = {
  page: { background: "#0a0c10", minHeight: "100vh", color: "#f0f4ff", fontFamily: "Inter, sans-serif", position: "relative" as const },
  center: { maxWidth: 600, margin: "0 auto", padding: "120px 24px", textAlign: "center" as const },
  nav: {
    position: "sticky" as const, top: 0, zIndex: 50,
    background: "rgba(10,12,16,.85)", backdropFilter: "blur(16px)",
    borderBottom: "1px solid rgba(255,255,255,.08)",
    padding: "0 40px", height: 64,
    display: "flex", alignItems: "center", justifyContent: "space-between",
  },
  logoLink: { textDecoration: "none", color: "inherit" },
  logoIcon: {
    width: 34, height: 34,
    background: "linear-gradient(135deg, #0d9488, #2dd4bf)",
    borderRadius: 8,
    display: "flex", alignItems: "center", justifyContent: "center",
    fontSize: 18, boxShadow: "0 0 20px rgba(13,148,136,.35)",
  },
  content: { maxWidth: 900, margin: "0 auto", padding: "24px 24px 80px" },
  tabBar: { display: "flex", gap: 4, borderBottom: "1px solid rgba(255,255,255,.08)", marginBottom: 24 },
  tabBtn: {
    background: "none", border: "none", padding: "12px 16px", fontSize: 14, fontWeight: 600,
    cursor: "pointer", borderBottom: "2px solid transparent", transition: "all .15s",
  },
  progressTrack: {
    width: "100%", height: 6, background: "rgba(255,255,255,.08)", borderRadius: 3, overflow: "hidden",
  },
  progressFill: {
    height: "100%", background: "linear-gradient(90deg, #0d9488, #2dd4bf)", borderRadius: 3,
    transition: "width .3s",
  },
} as const;
