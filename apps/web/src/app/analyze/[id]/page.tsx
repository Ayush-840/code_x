"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useParams } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { publicGet, publicPost, ApiError } from "@/lib/publicApi";
import { FileGraphTab } from "@/components/FileGraphTab";
import { friendlyStage } from "@/lib/stages";
import { ArchitectureView } from "@/components/tabs/ArchitectureView";
import { CodeGraphTab, type CodeGraphData } from "@/components/CodeGraphTab";
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

// Minimal re-declaration of the architecture artifact shape for the public
// page's casts. Keep in sync with ArchitectureView in components/tabs.
interface ArchitectureShape {
  components?: { name: string; role: string; dependsOn?: string[]; files?: number; lines?: number }[];
  entryPoints?: (string | { path?: string; module?: string })[];
  stack?: { languages?: Record<string, number>; frameworks?: string[] } | string[];
  summary?: string;
  diagram?: string;
}

// Deployment artifact shape written by the worker's detectDeployment():
// { [repoRelativePath]: { type: "file" | "directory", preview?: string } }.
interface DeployEntryInfo {
  type?: string;
  preview?: string;
}

/**
 * A small friendly icon per known deployment file, so the cards scan quickly.
 * Falls back to a neutral 📄 for anything unrecognized.
 */
function deployIcon(path: string): string {
  const base = path.split("/").pop()?.toLowerCase() ?? "";
  if (base.includes("dockerfile") || base.includes("docker")) return "🐳";
  if (base.startsWith("vercel")) return "▲";
  if (base.includes("railway")) return "🚄";
  if (base.includes("render")) return "🎨";
  if (base.includes("netlify")) return "🌐";
  if (base.includes("fly")) return "🪰";
  if (base.includes("terraform") || base.endsWith(".tf")) return "🏗️";
  if (base.includes("workflow") || path.includes(".github")) return "⚙️";
  if (base.includes("k8s") || base.includes("kube")) return "☸️";
  if (base === "makefile") return "🛠️";
  return "📄";
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
  const [activeTab, setActiveTab] = useState<"modules" | "files" | "architecture" | "codegraph" | "deployment">("modules");

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

  // CodeGraph tab fetchers (PRD-G03, anonymous flow): hit the API's public
  // codegraph proxy routes. Keyed on id — stable for the page's lifetime.
  const fetchCodeGraph = useCallback(
    () => publicGet<CodeGraphData>(`/v1/public/${id}/codegraph`),
    [id]
  );
  const explainNode = useCallback(
    (nodeId: string) =>
      publicPost<{ explanation: string }>(`/v1/public/${id}/codegraph/explain`, { node_id: nodeId }),
    [id]
  );
  const askGraph = useCallback(
    (question: string) =>
      publicPost<{ answer: string; cited_nodes: string[] }>(`/v1/public/${id}/codegraph/chat`, { question }),
    [id]
  );

  if (error) {
    return (
      <div className="bg-lab-bg text-lab-text min-h-screen relative font-sans">
        <div className="max-w-xl mx-auto py-32 px-6 text-center">
          <div className="text-5xl mb-4">🔍</div>
          <h2 className="text-xl font-bold mb-2 text-white">We couldn't find that analysis</h2>
          <p className="text-lab-textMuted text-sm">
            {error}
          </p>
          <p className="text-lab-textMuted text-xs mt-2 max-w-md mx-auto">
            The link may have expired — anonymous analyses stick around for 7 days — or the URL may be off by a character.
          </p>
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
      NOT_FOUND: "We couldn't find that repository. Double-check the URL — it needs to point to a public GitHub repo.",
      RATE_LIMITED: "We briefly hit GitHub's rate limit. Give it a few minutes and try again — or sign in for a higher limit.",
      SYSTEM_ERROR: "Something hiccuped on our end — your link was fine. Please try again in a moment.",
    };
    return (
      <div className="bg-lab-bg text-lab-text min-h-screen relative font-sans">
        <div className="max-w-xl mx-auto py-32 px-6 text-center">
          <div className="text-5xl mb-4">😅</div>
          <h2 className="text-xl font-bold mb-2 text-white">We hit a snag</h2>
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
            Try again
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
            Taking a look at {result?.fullName ?? "your repository"}…
          </h2>
          <p className="text-lab-textMuted text-sm mb-4 min-h-[20px]">
            {friendlyStage(stage)}
          </p>
          <div className="w-full h-1.5 bg-lab-border rounded-full overflow-hidden">
            <div className="h-full bg-lab-blue transition-all duration-300" style={{ width: `${pct}%` }} />
          </div>
          <p className="text-[11px] text-lab-dim font-mono mt-3">
            {stage} · {pct}% — usually done in under a minute. This page updates itself.
          </p>
        </div>
      </div>
    );
  }

  // The generation service stores this artifact as type "architecture" (see
  // packages/generation main.py /generate) — the old "architecture_overview"
  // lookup never matched anything, so the tab always showed the empty state.
  const archArtifact = result.artifacts.find((a) => a.artifactType === "architecture");
  const deployArtifact = result.artifacts.find((a) => a.artifactType === "deployment");

  // The deployment artifact is an always-written map (empty = "nothing found");
  // flatten it once for the cards. Keyed on the artifact reference so the 3s
  // status poll doesn't recompute this after READY.
  const deployEntries = useMemo(
    () =>
      Object.entries(
        (deployArtifact?.content ?? {}) as Record<string, DeployEntryInfo>
      ),
    [deployArtifact]
  );

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
          {(["modules", "files", "codegraph", "architecture", "deployment"] as const).map((t) => (
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
              {t === "codegraph" && "🕸️ "}
              {t === "deployment" && "🚀 "}
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </nav>

        {/* Tab content — crossfade + slide on switch (UI Revamp Manual §4.2). */}
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, x: 8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -8 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
          >
        {activeTab === "modules" && (
          <div className="space-y-4">
            <p className="text-sm text-lab-textMuted">
              {result.modules.length === 0
                ? "Nothing here yet"
                : result.modules.length === 1
                  ? "Here's the one module we found, in suggested reading order"
                  : `Here's how we'd read the codebase — ${result.modules.length} modules, easiest first`}
            </p>
            {result.modules.length === 0 ? (
              <div className="panel text-center py-12">
                <div className="text-4xl mb-2">🧩</div>
                <h3 className="text-lab-text font-semibold mb-1">No modules detected</h3>
                <p className="text-lab-textMuted text-sm max-w-md mx-auto">
                  We couldn't pick out distinct modules for this repository — it may be very small, or in a language we don't fully support yet. The other tabs may still have useful detail.
                </p>
              </div>
            ) : (
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
                          {mod.fileCount} file{mod.fileCount === 1 ? "" : "s"} · {(mod.lineCount ?? 0).toLocaleString()} line{(mod.lineCount ?? 0) === 1 ? "" : "s"}
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
            )}
          </div>
        )}

        {activeTab === "files" && (
          <FileGraphTab
            fetchTree={fetchTree}
            explainFile={explainFile}
            fetchFileEdges={fetchFileEdges}
          />
        )}

        {activeTab === "codegraph" && (
          <CodeGraphTab fetchGraph={fetchCodeGraph} explainNode={explainNode} ask={askGraph} />
        )}

        {activeTab === "architecture" && (
          <div className="space-y-6">
            <div>
              <p className="section-label">01 // ARCHITECTURE</p>
              <h2 className="section-title">Architecture Overview</h2>
            </div>
            {archArtifact ? (
              <ArchitectureView arch={archArtifact.content as unknown as ArchitectureShape} />
            ) : (
              <div className="panel text-center py-12">
                <div className="text-4xl mb-2">🏗️</div>
                <h3 className="text-lab-text font-semibold mb-1">Architecture not ready yet</h3>
                <p className="text-lab-textMuted text-sm max-w-md mx-auto">
                  The overview didn't come through with this analysis — the other tabs still have the full picture of the codebase.
                </p>
              </div>
            )}
          </div>
        )}

        {activeTab === "deployment" && (
          <div className="space-y-6">
            <div>
              <p className="section-label">05 // DEPLOYMENT</p>
              <h2 className="section-title">How this project ships</h2>
            </div>
            {deployEntries.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {deployEntries.map(([path, info]) => (
                  <div key={path} className="panel p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-base">{deployIcon(path)}</span>
                      <code className="text-xs font-mono text-white break-all">{path}</code>
                    </div>
                    {info.preview && (
                      <pre className="text-[11px] font-mono text-lab-textMuted leading-relaxed whitespace-pre-wrap bg-lab-bg p-3 rounded-lg border border-lab-border max-h-40 overflow-auto mt-2">
                        {info.preview}
                      </pre>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="panel text-center py-12">
                <div className="text-4xl mb-2">🚀</div>
                <h3 className="text-lab-text font-semibold mb-1">No deployment setup found</h3>
                <p className="text-lab-textMuted text-sm max-w-md mx-auto">
                  We didn't spot anything like a Dockerfile, vercel.json, or CI workflow. If this project is deployed some other way, nothing's wrong — we just can't see it from the code.
                </p>
              </div>
            )}
          </div>
        )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}



