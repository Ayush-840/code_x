"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useParams } from "next/navigation";
import { publicGet, publicPost, ApiError } from "@/lib/publicApi";
import { FileGraphTab } from "@/components/FileGraphTab";
import type { FileTreeNode } from "@/components/FileGraph";
import type { FileEdge } from "@/lib/fileConnections";

interface FileExplanation {
  summary?: string;
  sections?: { heading: string; text: string }[];
  questions?: { question: string; answer: string }[];
  citations?: { filePath: string; startLine: number; endLine: number }[];
  isDemo?: boolean;
}

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
  job: { stage?: string | null; progress: number; status: string; errorMessage?: string | null; errorCategory?: string | null } | null;
  modules: Module[];
  artifacts: Artifact[];
}

export default function PublicAnalysisPage() {
  const params = useParams();
  const id = params.id as string;
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"modules" | "files" | "architecture" | "deployment">("modules");

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const poll = async () => {
      try {
        const data = await publicGet<AnalysisResult>(`/v1/public/${id}`);
        if (cancelled) return;
        setResult(data);
        if (data.status !== "READY" && data.status !== "FAILED") {
          timer = setTimeout(poll, 3000);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof ApiError ? e.message : "Failed to load analysis");
      }
    };

    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [id]);

  // Hooks live above the early returns below (Rules of Hooks): the old file
  // declared its useCallbacks after them, so an error/FAILED render changed
  // the component's hook count.
  // Key the tree fetcher on the artifact reference, not the whole result
  // object (TRD-F01): the 3s status poll replaces `result` on every cycle
  // while PENDING, and keying on it handed FileGraphTab a new prop identity
  // each poll — the anonymous-page half of the flicker loop.
  const fileTreeArtifact = useMemo(
    () => result?.artifacts.find((a) => a.artifactType === "file-tree"),
    [result]
  );
  const fetchTree = useCallback(async () => {
    if (!fileTreeArtifact) throw new Error("No file tree for this analysis");
    return fileTreeArtifact.content as unknown as FileTreeNode;
  }, [fileTreeArtifact]);

  const explainFile = useCallback(
    (path: string) => publicPost<FileExplanation>(`/v1/public/${id}/files/explain`, { path }),
    [id]
  );

  // Import edges artifact — keyed on the artifact reference (same TRD-F01
  // reasoning as the tree fetcher above); absent for pre-feature analyses.
  const fileEdgesArtifact = useMemo(
    () => result?.artifacts.find((a) => a.artifactType === "file-edges"),
    [result]
  );
  const fetchFileEdges = useCallback(async (): Promise<FileEdge[]> => {
    const content = fileEdgesArtifact?.content as { edges?: FileEdge[] } | undefined;
    return content?.edges ?? [];
  }, [fileEdgesArtifact]);

  if (error) {
    return (
      <div className="bg-lab-bg text-lab-text min-h-screen relative font-sans">
        <div className="max-w-xl mx-auto py-32 px-6 text-center">
          <div className="text-5xl mb-4">⚠️</div>
          <h2 className="text-xl font-bold mb-2 text-white">Analysis not found</h2>
          <p className="text-lab-textMuted text-sm">{error}</p>
          <a href="/analyze" className="mt-6 inline-block px-4 py-2 bg-lab-blue text-black font-semibold rounded-lg hover:bg-lab-blue/80 transition-colors">
            Analyze another repo
          </a>
        </div>
      </div>
    );
  }

  if (result?.status === "FAILED") {
    const category = result.job?.errorCategory ?? "SYSTEM_ERROR";
    const messages: Record<string, string> = {
      NOT_FOUND: "This repository couldn't be found. Double-check the URL — it must point to a public GitHub repo.",
      RATE_LIMITED: "GitHub's rate limit was hit. Wait a few minutes and try again — or sign in for a higher limit.",
      SYSTEM_ERROR: "Something went wrong on our end. Your repo URL was fine — please try again in a bit.",
    };
    return (
      <div className="bg-lab-bg text-lab-text min-h-screen relative font-sans">
        <div className="max-w-xl mx-auto py-32 px-6 text-center">
          <div className="text-5xl mb-4">⚠️</div>
          <h2 className="text-xl font-bold mb-2 text-white">Analysis failed</h2>
          <p className="text-lab-textMuted text-sm max-w-md mx-auto mb-4">
            {messages[category] ?? messages.SYSTEM_ERROR}
          </p>
          {result.job?.errorMessage && (
            <details className="mb-6 text-lab-textMuted text-xs">
              <summary className="cursor-pointer font-mono">Technical details</summary>
              <code className="block mt-2 font-mono text-left bg-lab-card p-3 rounded border border-lab-border text-red-400 break-words">
                {result.job.errorMessage}
              </code>
            </details>
          )}
          <a href="/analyze" className="inline-block px-4 py-2 bg-lab-blue text-black font-semibold rounded-lg hover:bg-lab-blue/80 transition-colors">
            Try another repo
          </a>
        </div>
      </div>
    );
  }

  if (!result || result.status !== "READY") {
    const pct = result?.job?.progress ?? 0;
    const stage = result?.job?.stage ?? "QUEUED";
    return (
      <div className="bg-lab-bg text-lab-text min-h-screen relative font-sans flex items-center justify-center">
        <div className="max-w-md w-full mx-auto py-24 px-6 text-center">
          <div className="w-8 h-8 border-2 border-lab-blue border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <h2 className="text-xl font-bold mb-2 text-white font-display tracking-wide">
            Analyzing {result?.fullName ?? "repository"}…
          </h2>
          <p className="text-lab-textMuted text-sm font-mono mb-4">
            {stage} — {pct}%
          </p>
          <div className="w-full h-1.5 bg-lab-border rounded-full overflow-hidden">
            <div className="h-full bg-lab-blue transition-all duration-300" style={{ width: `${pct}%` }} />
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
    <div className="bg-lab-bg text-lab-text min-h-screen relative font-sans">
      <nav className="sticky top-0 z-50 bg-lab-bg/85 backdrop-blur border-b border-lab-border px-6 md:px-10 h-16 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <a href="/analyze" className="no-underline text-current">
            <div className="w-8 h-8 rounded-lg bg-lab-blueDim border border-lab-blue/30 flex items-center justify-center text-lab-blue font-bold shadow-[0_0_12px_rgba(0,216,255,0.2)]">
              ⚡
            </div>
          </a>
          <div>
            <div className="font-bold text-sm text-white font-mono">{result.fullName}</div>
            <div className="text-[11px] text-lab-textMuted font-mono">
              branch: {result.defaultBranch} · expires {new Date(result.expiresAt).toLocaleDateString()}
            </div>
          </div>
        </div>
        <div className="flex gap-3 items-center">
          <button
            className="px-3 py-1.5 text-xs font-mono rounded-lg bg-lab-card border border-lab-border text-lab-textMuted hover:text-white hover:border-lab-blue/40 transition-colors"
            onClick={() => void claimAnalysis()}
          >
            Claim to account
          </button>
          <a
            href="/login"
            className="px-3 py-1.5 text-xs font-mono font-semibold rounded-lg bg-lab-blue text-black hover:bg-lab-blue/80 transition-colors"
          >
            Sign in to save
          </a>
        </div>
      </nav>

      <div className="max-w-6xl mx-auto px-4 md:px-6 py-6 pb-20 space-y-6">
        <nav className="flex gap-2 border-b border-lab-border pb-2">
          {(["modules", "files", "architecture", "deployment"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setActiveTab(t)}
              className={`px-4 py-2 text-xs font-mono uppercase tracking-wider rounded-lg transition-colors border ${
                activeTab === t
                  ? "bg-lab-blueDim text-lab-blue border-lab-blue/40 font-semibold"
                  : "text-lab-textMuted hover:text-white border-transparent hover:bg-lab-card"
              }`}
            >
              {t === "modules" && "🧩 "}
              {t === "files" && "🗂️ "}
              {t === "architecture" && "🏗️ "}
              {t === "deployment" && "🚀 "}
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </nav>

        {activeTab === "modules" && (
          <div className="space-y-4">
            <p className="text-xs font-mono text-lab-textMuted uppercase tracking-wider">
              {result.modules.length} module{result.modules.length !== 1 ? "s" : ""} · reading order
            </p>
            <div className="space-y-3">
              {result.modules
                .slice()
                .sort((a, b) => (a.readingOrderIndex ?? 999) - (b.readingOrderIndex ?? 999))
                .map((mod, i) => (
                  <div key={mod.id ?? mod.name} className="panel p-4">
                    <div className="flex items-center gap-3 mb-2 flex-wrap">
                      <span className="text-xs font-mono text-lab-blue font-bold min-w-[20px]">
                        #{i + 1}
                      </span>
                      <span className="font-semibold text-white text-base">{mod.name}</span>
                      {mod.path && (
                        <code className="px-2 py-0.5 rounded text-xs font-mono bg-lab-bg border border-lab-border text-lab-textMuted">
                          {mod.path}
                        </code>
                      )}
                      <span className="ml-auto text-xs font-mono text-lab-textMuted">
                        {mod.fileCount} files · {mod.lineCount?.toLocaleString()} lines
                      </span>
                    </div>
                    {mod.purposeSummary && (
                      <p className="text-xs text-lab-textMuted leading-relaxed pl-7">
                        {mod.purposeSummary}
                      </p>
                    )}
                  </div>
                ))}
            </div>
          </div>
        )}

        {activeTab === "files" && (
          <FileGraphTab
            fetchTree={fetchTree}
            explainFile={explainFile}
            fetchFileEdges={fetchFileEdges}
          />
        )}

        {activeTab === "architecture" && (
          <div className="panel p-6 space-y-4">
            <p className="section-label">01 // ARCHITECTURE</p>
            {archArtifact ? (
              <pre className="text-xs font-mono text-lab-textMuted leading-relaxed whitespace-pre-wrap bg-lab-bg p-4 rounded-lg border border-lab-border">
                {JSON.stringify(archArtifact.content, null, 2)}
              </pre>
            ) : (
              <p className="text-lab-textMuted text-sm">No architecture overview generated.</p>
            )}
          </div>
        )}

        {activeTab === "deployment" && (
          <div className="panel p-6 space-y-4">
            <p className="section-label">05 // DEPLOYMENT</p>
            {deployArtifact ? (
              <pre className="text-xs font-mono text-lab-textMuted leading-relaxed whitespace-pre-wrap bg-lab-bg p-4 rounded-lg border border-lab-border">
                {JSON.stringify(deployArtifact.content, null, 2)}
              </pre>
            ) : (
              <p className="text-lab-textMuted text-sm">No deployment configuration detected.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}



