"use client";

import { useEffect, useState } from "react";
import { useAuthedFetch } from "@/lib/api";
import { ExternalLink } from "lucide-react";

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
      <div className="panel flex items-center justify-center h-64">
        <div className="flex flex-col items-center gap-3 text-lab-textMuted">
          <div className="w-8 h-8 border-2 border-lab-blue border-t-transparent rounded-full animate-spin" />
          <p>Loading deployment info…</p>
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
          <h3 className="text-lab-text font-semibold mb-1">No deployment configuration detected</h3>
          <p className="text-lab-textMuted text-sm">
            No Dockerfile, docker-compose, vercel.json, railway.toml, or similar deployment files were found.
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
          {entries.length} deployment file{entries.length !== 1 ? "s" : ""} detected
        </p>
        {entries.map(([path, file]) => (
          <div key={path} className="bg-lab-card border border-lab-border rounded-lg overflow-hidden">
            <div className="px-4 py-3 flex items-center gap-3">
              <ExternalLink className="w-5 h-5 text-lab-textMuted hover:text-lab-blue transition-colors shrink-0" />
              <code className="px-2 py-1 rounded text-sm font-mono bg-lab-bg border border-lab-border text-lab-text flex-1 truncate">
                {path}
              </code>
              <span className="px-2 py-0.5 rounded text-xs font-mono bg-lab-blueDim text-lab-blue border border-lab-blue/30 shrink-0">
                {file.type}
              </span>
            </div>
            {file.preview && (
              <div className="border-t border-lab-border px-4 py-3 bg-lab-bg">
                <pre className="text-xs font-mono text-lab-textMuted leading-relaxed whitespace-pre-wrap m-0">
                  {file.preview}
                </pre>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}