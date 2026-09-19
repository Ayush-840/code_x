"use client";

import { useEffect, useState } from "react";
import { useAuthRedirect } from "@/components/auth";
import { useAuthedFetch, clearTokens } from "@/lib/api";
import { useSocket } from "@/lib/socket";
import { ArchitectureTab } from "@/components/tabs/ArchitectureTab";
import { ModulesTab } from "@/components/tabs/ModulesTab";
import { QuestionsTab } from "@/components/tabs/QuestionsTab";
import { ChatTab } from "@/components/tabs/ChatTab";
import { MockInterviewTab } from "@/components/tabs/MockInterviewTab";
import { useRouter } from "next/navigation";

type Tab = "architecture" | "modules" | "questions" | "chat" | "interview";

interface Repo {
  id: string;
  fullName: string;
  primaryLanguage: string | null;
  status: string;
  totalFiles: number;
  totalLines: number;
}

const TABS: { key: Tab; label: string; icon: string }[] = [
  { key: "architecture", label: "Architecture",   icon: "🏗️" },
  { key: "modules",      label: "Modules",         icon: "🧩" },
  { key: "questions",    label: "Question Bank",   icon: "❓" },
  { key: "chat",         label: "Ask",             icon: "💬" },
  { key: "interview",    label: "Mock Interview",  icon: "🎤" },
];

const STATUS_BADGE: Record<string, string> = {
  READY:      "badge-green",
  PARSING:    "badge-blue",
  INDEXING:   "badge-blue",
  GENERATING: "badge-blue",
  FAILED:     "badge-red",
  PENDING:    "badge-gray",
};

export function ClientRepoPage({ repoId }: { repoId: string }) {
  const authStatus = useAuthRedirect();
  const api = useAuthedFetch();
  const socket = useSocket();
  const router = useRouter();
  const [repo, setRepo] = useState<Repo | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("architecture");
  const [analysisProgress, setAnalysisProgress] = useState<{ stage: string; progress: number; message: string } | null>(null);

  useEffect(() => {
    if (authStatus !== "authed") return;
    api.get<Repo>(`/repos/${repoId}`).then(setRepo).catch(() => setRepo(null));
  }, [api, repoId, authStatus]);

  useEffect(() => {
    if (!socket) return;
    socket.emit("repo:join", { repoId });
    socket.on("analysis:progress", (p: { repoId: string; stage: string; progress: number; message: string }) => {
      if (p.repoId === repoId) {
        setAnalysisProgress(p);
        if (p.progress === 100) {
          api.get<Repo>(`/repos/${repoId}`).then(setRepo).catch(() => {});
        }
      }
    });
    return () => { socket.off("analysis:progress"); };
  }, [socket, repoId, api]);

  if (authStatus !== "authed") {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg)" }}>
        <div className="spinner" />
      </div>
    );
  }

  const isAnalyzing = analysisProgress && analysisProgress.progress < 100;

  return (
    <div style={{ background: "var(--bg)", minHeight: "100vh", color: "var(--text-primary)", fontFamily: "Inter, sans-serif" }}>
      <div className="gradient-bg" />

      {/* Top Nav */}
      <nav className="app-nav">
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <button className="btn btn-ghost btn-sm" onClick={() => router.push("/dashboard")}>
            ← Dashboard
          </button>
          <div className="app-logo" style={{ gap: 8 }}>
            <div className="app-logo-icon">⚡</div>
            <span style={{ fontSize: 16 }}>{repo?.fullName ?? "Repository"}</span>
          </div>
          {repo && (
            <span className={`badge ${STATUS_BADGE[repo.status] ?? "badge-gray"}`}>
              {repo.status}
            </span>
          )}
        </div>
        {repo && (
          <div style={{ display: "flex", gap: 16, fontSize: 13, color: "var(--text-muted)" }}>
            <span>{repo.primaryLanguage ?? "—"}</span>
            <span>{repo.totalFiles} files</span>
            <span>{repo.totalLines.toLocaleString()} lines</span>
          </div>
        )}
      </nav>

      {/* Analysis in-progress banner */}
      {isAnalyzing && (
        <div style={S.analysisBanner}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
            <span style={{ color: "var(--brand-400)", fontWeight: 600, fontSize: 14 }}>
              ⚙ {analysisProgress.stage} — {analysisProgress.message}
            </span>
            <span style={{ color: "var(--text-muted)", fontSize: 14 }}>{analysisProgress.progress}%</span>
          </div>
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${analysisProgress.progress}%` }} />
          </div>
        </div>
      )}

      <div className="page-wide">
        {/* Tabs */}
        <nav className="tab-bar">
          {TABS.map((t) => (
            <button
              key={t.key}
              className={`tab-btn${activeTab === t.key ? " active" : ""}`}
              onClick={() => setActiveTab(t.key)}
            >
              <span style={{ marginRight: 6 }}>{t.icon}</span>
              {t.label}
            </button>
          ))}
        </nav>

        {/* Tab content */}
        {activeTab === "architecture" && <ArchitectureTab repoId={repoId} />}
        {activeTab === "modules"      && <ModulesTab repoId={repoId} />}
        {activeTab === "questions"    && <QuestionsTab repoId={repoId} />}
        {activeTab === "chat"         && <ChatTab repoId={repoId} socket={socket} />}
        {activeTab === "interview"    && <MockInterviewTab repoId={repoId} socket={socket} />}
      </div>
    </div>
  );
}

const S = {
  analysisBanner: {
    background: "rgba(13,148,136,.08)",
    borderBottom: "1px solid rgba(13,148,136,.2)",
    padding: "12px 24px",
  },
} as const;