"use client";

import { useState } from "react";
import { useAuthedFetch, ApiError } from "@/lib/api";

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

export function RepoConnectForm({
  onConnected,
}: {
  onConnected: (repo: Repository) => void;
}) {
  const api = useAuthedFetch();
  const [repoUrl, setRepoUrl] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const repo = await api.post<Repository>("/repos/connect", {
        repoUrl,
        accessToken,
      });
      onConnected(repo);
      setRepoUrl("");
      setAccessToken("");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not connect repository");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <strong>Connect a repository</strong>
      <div style={styles.row}>
        <input
          style={{ ...styles.input, flex: 2 }}
          placeholder="https://github.com/owner/repository"
          value={repoUrl}
          onChange={(e) => setRepoUrl(e.target.value)}
        />
        <input
          style={{ ...styles.input, flex: 1 }}
          type="password"
          placeholder="GitHub Personal Access Token"
          value={accessToken}
          onChange={(e) => setAccessToken(e.target.value)}
        />
        <button
          style={styles.button}
          disabled={busy || !repoUrl || !accessToken}
          onClick={() => void submit()}
        >
          {busy ? "Connecting…" : "Connect"}
        </button>
      </div>
      {error ? <p style={styles.error}>{error}</p> : null}
      <p style={styles.hint}>
        Use a token with repo scope. In demo mode any token format works.
      </p>
    </div>
  );
}

const styles = {
  row: { display: "flex", gap: 10, marginTop: 12 },
  input: {
    padding: "10px 12px",
    borderRadius: 8,
    border: "1px solid #d6d8de",
    fontSize: 14,
  },
  button: {
    background: "#2d9d78",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    padding: "0 20px",
    fontSize: 14,
    fontWeight: 600,
    whiteSpace: "nowrap",
  },
  error: { color: "#a22626", fontSize: 13, margin: "10px 0 0" },
  hint: { color: "#8a8f98", fontSize: 12, margin: "8px 0 0" },
} as const;