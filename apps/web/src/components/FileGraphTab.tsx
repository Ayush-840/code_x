"use client";

import { useEffect, useState } from "react";
import { FileGraph, type FileTreeNode } from "@/components/FileGraph";

interface FileExplanation {
  summary?: string;
  sections?: { heading: string; text: string }[];
  questions?: { question: string; answer: string }[];
  citations?: { filePath: string; startLine: number; endLine: number }[];
  isDemo?: boolean;
}

export interface FileGraphTabProps {
  /** Fetch the file-tree artifact; throws on failure. */
  fetchTree: () => Promise<FileTreeNode>;
  /** Lazily explain one file (cache handled server-side). */
  explainFile: (path: string) => Promise<FileExplanation>;
}

export function FileGraphTab({ fetchTree, explainFile }: FileGraphTabProps) {
  const [tree, setTree] = useState<FileTreeNode | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetchTree()
      .then(setTree)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load file tree"))
      .finally(() => setLoading(false));
  }, [fetchTree]);

  if (loading) {
    return (
      <div style={{ textAlign: "center", padding: "60px 24px" }}>
        <div className="spinner" style={{ margin: "0 auto 16px" }} />
        <p style={{ color: "var(--text-muted)" }}>Loading file graph…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="empty-state">
        <div className="empty-icon">🗂️</div>
        <h3>File graph unavailable</h3>
        <p style={{ maxWidth: 380, margin: "0 auto" }}>{error}</p>
      </div>
    );
  }

  // Empty tree: the pipeline ran but nothing parseable was found.
  if (!tree || tree.children.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-icon">🗂️</div>
        <h3>No files parsed</h3>
        <p style={{ maxWidth: 380, margin: "0 auto" }}>
          The analysis pipeline found no source files in this repository.
        </p>
      </div>
    );
  }

  return <FileGraph tree={tree} explainFile={explainFile} />;
}
