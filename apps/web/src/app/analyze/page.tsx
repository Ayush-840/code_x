"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { publicPost, ApiError } from "@/lib/publicApi";

export default function AnalyzePage() {
  const router = useRouter();
  const [repoUrl, setRepoUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!repoUrl) return;
    setBusy(true);
    setError(null);
    try {
      const res = await publicPost<{ id: string; status: string; cached: boolean }>(
        "/v1/public/analyze",
        { repoUrl }
      );
      router.push(`/analyze/${res.id}`);
    } catch (e) {
      // Submit-time errors are network/validation problems (job failures
      // surface on the detail page, PRD-I04) — so this fallback must not
      // blame the URL.
      setError(
        e instanceof ApiError
          ? e.message
          : "Couldn't reach the analysis service. Check your connection and try again."
      );
      setBusy(false);
    }
  };

  return (
    <div className="bg-lab-bg text-lab-text min-h-screen font-sans relative">
      <div className="gradient-bg" />

      <nav className="app-nav">
        <a href="/" className="flex items-center gap-2.5 font-display text-xl text-white font-bold no-underline">
          <div className="w-8 h-8 rounded-lg bg-lab-blueDim border border-lab-blue/40 text-lab-blue flex items-center justify-center text-sm shadow-[0_0_12px_rgba(0,216,255,0.3)]">
            ⚡
          </div>
          <span>Vibe Coder</span>
        </a>
        <div className="flex gap-4 items-center">
          <a href="/login" className="text-xs font-mono text-lab-textMuted hover:text-white transition-colors">
            Sign in
          </a>
          <a href="/login" className="btn btn-primary btn-sm">
            Get started
          </a>
        </div>
      </nav>

      <section className="max-w-xl mx-auto px-6 py-24 text-center relative z-10">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-lab-blueDim border border-lab-blue/30 text-[11px] font-mono uppercase tracking-wider text-lab-blue mb-6">
          <span className="w-1.5 h-1.5 rounded-full bg-lab-blue animate-pulse" />
          No login required
        </div>

        <h1 className="font-display text-4xl sm:text-6xl font-bold tracking-tight mb-4 text-white">
          Understand any <span className="text-gradient">public repository</span>
        </h1>
        <p className="text-lab-textMuted text-sm sm:text-base max-w-md mx-auto mb-10 leading-relaxed">
          Paste a GitHub link and we'll walk you through the codebase — the architecture, how the modules fit together, and how it ships. No setup, no sign-up.
        </p>

        <div className="flex gap-2 max-w-md mx-auto mb-3">
          <input
            className="input flex-1 h-12 text-sm"
            placeholder="https://github.com/owner/repo"
            value={repoUrl}
            onChange={(e) => setRepoUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void submit()}
            disabled={busy}
          />
          <button
            className="btn btn-primary h-12 px-6 text-sm font-semibold whitespace-nowrap"
            disabled={busy || !repoUrl}
            onClick={() => void submit()}
          >
            {busy ? "On it — hang tight…" : "Explain this repo"}
          </button>
        </div>
        {error && <p className="text-xs text-rose-400 mt-2 max-w-md mx-auto">{error}</p>}

        <p className="text-xs text-lab-dim mt-6">
          Works with public GitHub repos · takes about a minute · results stay up for 7 days
        </p>
      </section>
    </div>
  );
}

