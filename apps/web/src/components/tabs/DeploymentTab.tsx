"use client";

import { useEffect, useState } from "react";
import { useAuthedFetch } from "@/lib/api";
import { ChevronDown } from "lucide-react";

interface DeployFile {
  type: string;
  preview?: string;
}

/**
 * A small friendly icon per known deployment file, so the list scans quickly.
 * Mirrors the public analyze page's deployIcon — keep both in sync.
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

/**
 * Same summary-then-list shape as Architecture: a one-line intro, then each
 * deployment file as a row in a divided list with its config preview expanding
 * in place. The file path is already monospace — no pill chrome on top.
 */
export function DeploymentTab({ repoId }: { repoId: string }) {
  const api = useAuthedFetch();
  const [files, setFiles] = useState<Record<string, DeployFile> | null>(null);
  const [loading, setLoading] = useState(true);
  // Which config file's preview is expanded (one at a time).
  const [expanded, setExpanded] = useState<string | null>(null);

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
      <div className="flex items-center justify-center h-64 text-lab-textMuted">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-lab-blue border-t-transparent rounded-full animate-spin" />
          <p>Looking for deployment configs…</p>
        </div>
      </div>
    );
  }

  const entries = Object.entries(files ?? {});

  return (
    <div className="max-w-3xl">
      <h2 className="text-2xl font-display text-white mb-1">Deployment</h2>
      {!files || entries.length === 0 ? (
        <div className="py-16 text-center">
          <div className="text-4xl mb-2">🚀</div>
          <h3 className="text-white font-semibold mb-1">No deployment setup found</h3>
          <p className="text-lab-textMuted text-sm max-w-md mx-auto">
            We didn't spot anything like a Dockerfile, vercel.json, or CI workflow. If this project is deployed some other way, nothing's wrong — we just can't see it from the code.
          </p>
        </div>
      ) : (
        <>
          <p className="text-lab-textMuted text-sm mt-2 mb-6">
            Here's how this project ships — {entries.length} deployment file{entries.length !== 1 ? "s" : ""} we found.
          </p>
          <div className="divide-y divide-lab-border">
            {entries.map(([path, file]) => {
              const hasPreview = Boolean(file.preview);
              const isOpen = expanded === path;
              return (
                <div key={path} className="py-3">
                  <button
                    className="w-full flex items-center gap-3 text-left"
                    onClick={() => hasPreview && setExpanded(isOpen ? null : path)}
                    aria-expanded={hasPreview ? isOpen : undefined}
                  >
                    <span className="text-base shrink-0">{deployIcon(path)}</span>
                    <code className="text-sm font-mono text-white truncate">{path}</code>
                    <span className="text-xs text-lab-dim shrink-0 ml-auto">{file.type}</span>
                    {hasPreview && (
                      <ChevronDown
                        className={`w-4 h-4 text-lab-dim shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`}
                      />
                    )}
                  </button>
                  {hasPreview && isOpen && (
                    <pre className="mt-3 text-xs font-mono text-lab-textMuted leading-relaxed whitespace-pre-wrap max-h-80 overflow-auto">
                      {file.preview}
                    </pre>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
