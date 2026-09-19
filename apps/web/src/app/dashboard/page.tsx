"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuthRedirect } from "@/components/auth";
import { useAuthedFetch, clearTokens } from "@/lib/api";
import { useSocket } from "@/lib/socket";
import { RepoConnectForm } from "@/components/RepoConnectForm";

interface Repository {
  id: string;
  fullName: string;
  defaultBranch: string;
  primaryLanguage: string | null;
  totalFiles: number;
  totalLines: number;
  status: string;
  lastAnalyzedAt: string | null;
  createdAt: string;
}

interface Usage {
  planTier: string;
  reposUsed: number;
  reposRemaining: number;
  messagesUsed: number;
  chatsRemaining: number;
  mockInterviewsUsed: number;
  mockInterviewsRemaining: number;
}

interface Progress {
  stage: string;
  progress: number;
  message: string;
}

const STATUS_BADGE: Record<string, string> = {
  READY:      "badge-green",
  PARSING:    "badge-blue",
  INDEXING:   "badge-blue",
  GENERATING: "badge-blue",
  CLONING:    "badge-blue",
  PENDING:    "badge-gray",
  FAILED:     "badge-red",
};

export default function DashboardPage() {
  const status = useAuthRedirect();
  const api = useAuthedFetch();
  const socket = useSocket();
  const router = useRouter();

  const [repos, setRepos] = useState<Repository[]>([]);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [progress, setProgress] = useState<Record<string, Progress>>({});
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [repoList, usageData] = await Promise.all([
        api.get<Repository[]>("/repos"),
        api.get<Usage>("/usage/summary"),
      ]);
      setRepos(repoList);
      setUsage(usageData);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [api]);

  useEffect(() => {
    if (status === "authed") void load();
  }, [status, load]);

  useEffect(() => {
    if (!socket) return;
    socket.on("analysis:progress", (p: Progress & { repoId: string }) => {
      setProgress((prev) => ({ ...prev, [p.repoId]: p }));
      if (p.progress === 100) void load();
    });
    return () => { socket.off("analysis:progress"); };
  }, [socket, load]);

  const onConnected = useCallback((repo: Repository) => {
    setRepos((prev) => [repo, ...prev]);
  }, []);

  const analyze = useCallback(async (repoId: string, accessToken: string) => {
    if (!socket) return;
    const res = await api.post<{ jobId: string; repoId: string }>(
      `/repos/${repoId}/analyze`,
      { accessToken }
    );
    setProgress((prev) => ({
      ...prev,
      [res.repoId]: { stage: "QUEUED", progress: 0, message: "Queued" },
    }));
    socket.emit("repo:join", { repoId, jobId: res.jobId });
  }, [api, socket]);

  const logout = () => { clearTokens(); router.replace("/login"); };

  if (status !== "authed") {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg)" }}>
        <div className="spinner" />
      </div>
    );
  }

  return (
    <div style={{ background: "var(--bg)", minHeight: "100vh", color: "var(--text-primary)", fontFamily: "Inter, sans-serif" }}>
      <div className="gradient-bg" />

      {/* Nav */}
      <nav className="app-nav">
        <div className="app-logo">
          <div className="app-logo-icon">⚡</div>
          Vibe Coder
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span className={`badge ${STATUS_BADGE[usage?.planTier ?? ""] ?? "badge-gray"}`}>
            {usage?.planTier ?? "FREE"}
          </span>
          <button className="btn btn-ghost btn-sm" onClick={logout}>Sign out</button>
        </div>
      </nav>

      <div className="page">
        {/* Error */}
        {error && (
          <div className="error-banner">
            ⚠ {error} — ensure the API server is running on port 4000.
          </div>
        )}

        {/* Usage tiles */}
        <div style={S.usageGrid}>
          <UsageTile icon="📁" label="Repositories" used={usage?.reposUsed} remaining={usage?.reposRemaining} />
          <UsageTile icon="💬" label="Chat Messages" used={usage?.messagesUsed} remaining={usage?.chatsRemaining} />
          <UsageTile icon="🎤" label="Mock Interviews" used={usage?.mockInterviewsUsed} remaining={usage?.mockInterviewsRemaining} />
        </div>

        {/* Connect form */}
        <div className="card" style={{ marginBottom: 32 }}>
          <h2 style={S.cardTitle}>Connect a new repository</h2>
          <p style={S.cardSub}>Paste a GitHub URL and your Personal Access Token to start analysis.</p>
          {usage && usage.reposRemaining > 0 ? (
            <RepoConnectForm onConnected={onConnected} />
          ) : (
            <p style={{ color: "var(--text-muted)", marginTop: 12 }}>
              Repo limit reached for your plan. Delete a repo to free up quota.
            </p>
          )}
        </div>

        {/* Repo list */}
        <h2 style={S.sectionH2}>My repositories</h2>
        {repos.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">📂</div>
            <h3>No repositories yet</h3>
            <p>Connect a GitHub repository above to generate your study guide.</p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {repos.map((repo) => (
              <RepoCard
                key={repo.id}
                repo={repo}
                progress={progress[repo.id]}
                onAnalyze={(token) => analyze(repo.id, token)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function UsageTile({ icon, label, used, remaining }: { icon: string; label: string; used?: number; remaining?: number }) {
  const left = typeof remaining === "number" ? remaining : 0;
  const total = (used ?? 0) + left;
  const pct = total > 0 ? Math.round(((used ?? 0) / total) * 100) : 0;
  return (
    <div className="card card-sm" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 22 }}>{icon}</span>
        <span style={{ fontWeight: 600, fontSize: 15, color: "var(--text-primary)" }}>{label}</span>
      </div>
      <div style={{ fontSize: 24, fontWeight: 800, color: "var(--text-primary)" }}>
        {used ?? 0} <span style={{ fontSize: 14, color: "var(--text-muted)", fontWeight: 400 }}>used</span>
      </div>
      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${pct}%` }} />
      </div>
      <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{left} remaining</div>
    </div>
  );
}

function RepoCard({ repo, progress, onAnalyze }: { repo: Repository; progress?: Progress; onAnalyze: (token: string) => Promise<void>; }) {
  const [token, setToken] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const isActive = progress && progress.progress < 100;
  const badgeClass = STATUS_BADGE[repo.status] ?? "badge-gray";

  const handleAnalyze = async () => {
    setAnalyzing(true);
    try { await onAnalyze(token); } finally { setAnalyzing(false); }
  };

  return (
    <div className="card" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
      <div style={{ flex: 1, minWidth: 220 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
          <span style={{ fontWeight: 700, fontSize: 16, color: "var(--text-primary)" }}>{repo.fullName}</span>
          <span className={`badge ${badgeClass}`}>{repo.status}</span>
        </div>
        <div style={{ fontSize: 13, color: "var(--text-muted)", display: "flex", gap: 12 }}>
          <span>{repo.primaryLanguage ?? "—"}</span>
          <span>{repo.totalFiles} files</span>
          <span>{repo.totalLines.toLocaleString()} lines</span>
          {repo.lastAnalyzedAt && (
            <span>Last analyzed {new Date(repo.lastAnalyzedAt).toLocaleDateString()}</span>
          )}
        </div>
      </div>

      {isActive ? (
        <div style={{ width: 280 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, fontSize: 12 }}>
            <span style={{ color: "var(--brand-400)", fontWeight: 600 }}>{progress.stage}</span>
            <span style={{ color: "var(--text-muted)" }}>{progress.progress}%</span>
          </div>
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${progress.progress}%` }} />
          </div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>{progress.message}</div>
        </div>
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {repo.status === "READY" ? (
            <button className="btn btn-primary btn-sm" onClick={() => window.location.assign(`/repos/${repo.id}`)}>
              Open study guide →
            </button>
          ) : (
            <>
              <input
                className="input"
                type="password"
                placeholder="GitHub PAT"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                style={{ width: 200, padding: "7px 12px" }}
              />
              <button
                className="btn btn-ghost btn-sm"
                disabled={!token || analyzing}
                onClick={handleAnalyze}
              >
                {analyzing ? <span className="spinner" style={{ width: 14, height: 14 }} /> : null}
                {repo.status === "FAILED" ? "Retry" : "Analyze"}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

const S = {
  usageGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 14, marginBottom: 28 },
  cardTitle: { fontSize: 17, fontWeight: 700, marginBottom: 4, color: "var(--text-primary)" },
  cardSub: { fontSize: 14, color: "var(--text-muted)", marginBottom: 16 },
  sectionH2: { fontSize: 20, fontWeight: 700, marginBottom: 14, color: "var(--text-primary)" },
} as const;