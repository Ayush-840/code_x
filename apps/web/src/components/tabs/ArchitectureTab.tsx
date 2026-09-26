"use client";

import { useEffect, useState } from "react";
import { useAuthedFetch } from "@/lib/api";
import { ArchitectureView, type Architecture } from "./ArchitectureView";

export function ArchitectureTab({ repoId }: { repoId: string }) {
  const api = useAuthedFetch();
  const [data, setData] = useState<{ content: Architecture } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    api.get<{ content: Architecture }>(`/repos/${repoId}/architecture`)
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [api, repoId]);

  if (loading) return <LoadingState label="architecture overview" />;
  if (error) return <NotReadyState message={error} />;
  if (!data) return <NotReadyState />;

  const arch = data.content ?? (data as unknown as Architecture);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <p className="section-label">01 // ARCHITECTURE</p>
        <h2 className="section-title">Architecture Overview</h2>
      </div>

      <ArchitectureView arch={arch} />
    </div>
  );
}

function LoadingState({ label }: { label?: string }) {
  return (
    <div className="panel flex items-center justify-center h-64">
      <div className="flex flex-col items-center gap-3 text-lab-textMuted">
        <div className="w-8 h-8 border-2 border-lab-blue border-t-transparent rounded-full animate-spin" />
        <p>Loading {label ?? "data"}…</p>
      </div>
    </div>
  );
}

function NotReadyState({ message }: { message?: string }) {
  return (
    <div className="panel text-center py-12">
      <div className="text-4xl mb-2">🏗️</div>
      <h3 className="text-lab-text font-semibold mb-1">Architecture not ready yet</h3>
      <p className="text-lab-textMuted text-sm max-w-md mx-auto">
        {message ? `Error: ${message}` : "Run the analysis pipeline on your repository to generate the architecture overview."}
      </p>
    </div>
  );
}
