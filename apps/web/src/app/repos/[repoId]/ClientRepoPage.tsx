"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useAuthRedirect } from "@/components/auth";
import { useAuthedFetch } from "@/lib/api";
import { useSocket } from "@/lib/socket";
import { ArchitectureTab } from "@/components/tabs/ArchitectureTab";
import { ModulesTab } from "@/components/tabs/ModulesTab";
import { QuestionsTab } from "@/components/tabs/QuestionsTab";
import { ChatTab } from "@/components/tabs/ChatTab";
import { MockInterviewTab } from "@/components/tabs/MockInterviewTab";
import { DeploymentTab } from "@/components/tabs/DeploymentTab";
import { FileGraphTab } from "@/components/FileGraphTab";
import type { FileTreeNode } from "@/components/FileGraph";
import type { FileEdge } from "@/lib/fileConnections";
import { useRouter } from "next/navigation";

interface FileExplanation {
  summary?: string;
  sections?: { heading: string; text: string }[];
  questions?: { question: string; answer: string }[];
  citations?: { filePath: string; startLine: number; endLine: number }[];
  isDemo?: boolean;
}

type Tab = "architecture" | "filegraph" | "modules" | "questions" | "chat" | "interview" | "deployment";

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
  { key: "filegraph",    label: "File Graph",      icon: "🗂️" },
  { key: "modules",      label: "Modules",         icon: "🧩" },
  { key: "questions",    label: "Question Bank",   icon: "❓" },
  { key: "chat",         label: "Ask",             icon: "💬" },
  { key: "interview",    label: "Mock Interview",  icon: "🎤" },
  { key: "deployment",   label: "Deployment",      icon: "🚀" },
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

  // Stable fetcher identities for child tabs (TRD-F01): inline arrows here
  // used to hand FileGraphTab a new prop identity on every render, re-firing
  // its load effect and flipping the whole panel to the spinner on every
  // analysis:progress event — the File Graph flicker loop.
  const fetchTree = useCallback(async () => {
    const art = await api.get<{ content: FileTreeNode }>(`/repos/${repoId}/file-tree`);
    return art.content ?? (art as unknown as FileTreeNode);
  }, [api, repoId]);

  const explainFile = useCallback(
    (path: string) => api.post<FileExplanation>(`/repos/${repoId}/files/explain`, { path }),
    [api, repoId]
  );

  // Import edges for the connected-files graph — 404 is expected until the
  // next analysis writes the file-edges artifact, so resolve to [].
  const fetchFileEdges = useCallback(async (): Promise<FileEdge[]> => {
    try {
      const art = await api.get<{ content?: { edges?: FileEdge[] } }>(`/repos/${repoId}/file-edges`);
      return art.content?.edges ?? [];
    } catch {
      return [];
    }
  }, [api, repoId]);

  useEffect(() => {
    if (!socket) return;
    socket.emit("repo:join", { repoId });
    // Throttled (TRD-F03): progress events stream frequently during analysis;
    // updating state on every one re-rendered this whole page — and with it,
    // every tab. Cap rendered updates at ~4/sec, but always pass 100% through
    // so completion is never delayed by the throttle window.
    let lastRender = 0;
    const onProgress = (p: { repoId: string; stage: string; progress: number; message: string }) => {
      if (p.repoId !== repoId) return;
      const now = Date.now();
      if (p.progress === 100 || now - lastRender >= 250) {
        lastRender = now;
        setAnalysisProgress({ stage: p.stage, progress: p.progress, message: p.message });
      }
      if (p.progress === 100) {
        api.get<Repo>(`/repos/${repoId}`).then(setRepo).catch(() => {});
      }
    };
    socket.on("analysis:progress", onProgress);
    return () => { socket.off("analysis:progress", onProgress); };
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

        {/* Tab content — crossfade + slide on switch (UI Revamp Manual §4.2).
            mode="wait" so tabs never stack; the key forces a remount so each
            tab's own effects run exactly as before. */}
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, x: 8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -8 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
          >
            {activeTab === "architecture" && <ArchitectureTab repoId={repoId} />}
            {activeTab === "filegraph" && (
              <FileGraphTab fetchTree={fetchTree} explainFile={explainFile} fetchFileEdges={fetchFileEdges} />
            )}
            {activeTab === "modules"      && <ModulesTab repoId={repoId} />}
            {activeTab === "questions"    && <QuestionsTab repoId={repoId} />}
            {activeTab === "chat"         && <ChatTab repoId={repoId} socket={socket} />}
            {activeTab === "interview"    && <MockInterviewTab repoId={repoId} socket={socket} />}
            {activeTab === "deployment"   && <DeploymentTab repoId={repoId} />}
          </motion.div>
        </AnimatePresence>
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