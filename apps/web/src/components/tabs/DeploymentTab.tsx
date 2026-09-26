"use client";

import { useEffect, useState } from "react";
import { useAuthedFetch } from "@/lib/api";
import { ChevronDown } from "lucide-react";

interface DeployFile {
  type: string;
  preview?: string;
}

/**
 * A small friendly icon per known deployment file, so the cards scan quickly.
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
      <div className="panel flex items-center justify-center h-64">
        <div className="flex flex-col items-center gap-3 text-lab-textMuted">
          <div className="w-8 h-8 border-2 border-lab-blue border-t-transparent rounded-full animate-spin" />
          <p>Looking for deployment configs…</p>
        </div>
      </div>
    );
  }

  if (!files || Object.keys(files).length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <p className="section-label">05 // DEPLOYMENT</p>
          <h2 className="section-title">Deployment Configuration</h2>
        </div>
        <div className="panel text-center py-12">
          <div className="text-4xl mb-2">🚀</div>
          <h3 className="text-lab-text font-semibold mb-1">No deployment setup found</h3>
          <p className="text-lab-textMuted text-sm max-w-md mx-auto">
            We didn't spot anything like a Dockerfile, vercel.json, or CI workflow. If this project is deployed some other way, nothing's wrong — we just can't see it from the code.
          </p>
        </div>
      </div>
    );
  }

  const entries = Object.entries(files);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <p className="section-label">05 // DEPLOYMENT</p>
        <h2 className="section-title">Deployment Configuration</h2>
      </div>

      <div className="panel space-y-3">
        <p className="text-sm text-lab-textMuted">
          Here's how this project ships — {entries.length} deployment file{entries.length !== 1 ? "s" : ""} we found
        </p>
        {entries.map(([path, file]) => {
          const hasPreview = Boolean(file.preview);
          const isOpen = expanded === path;
          return (
            <div key={path} className="bg-lab-card border border-lab-border rounded-lg overflow-hidden">
              <button
                className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-lab-blue/5 transition-colors"
                onClick={() => setExpanded(isOpen ? null : path)}
                aria-expanded={hasPreview ? isOpen : undefined}
              >
                <span className="text-base shrink-0">{deployIcon(path)}</span>
                <code className="px-2 py-1 rounded text-sm font-mono bg-lab-bg border border-lab-border text-lab-text flex-1 truncate">
                  {path}
                </code>
                <span className="px-2 py-0.5 rounded text-xs font-mono bg-lab-blueDim text-lab-blue border border-lab-blue/30 shrink-0">
                  {file.type}
                </span>
                {hasPreview && (
                  <ChevronDown
                    className={`w-4 h-4 text-lab-textMuted transition-transform shrink-0 ${isOpen ? "rotate-180" : ""}`}
                  />
                )}
              </button>
              {hasPreview && isOpen && (
                <div className="border-t border-lab-border px-4 py-3 bg-lab-bg">
                  <pre className="text-xs font-mono text-lab-textMuted leading-relaxed whitespace-pre-wrap m-0 max-h-80 overflow-auto">
                    {file.preview}
                  </pre>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}