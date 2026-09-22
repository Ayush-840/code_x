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
    <div style={{ background: "#0a0c10", minHeight: "100vh", color: "#f0f4ff", fontFamily: "Inter, sans-serif" }}>
      <div className="gradient-bg" />

      <nav style={S.nav}>
        <a href="/" style={S.logoLink}>
          <div style={S.logoIcon}>⚡</div>
          <span style={{ fontWeight: 700, fontSize: 18 }}>Vibe Coder</span>
        </a>
        <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
          <a href="/login" style={{ color: "var(--text-secondary)", fontSize: 14 }}>Sign in</a>
          <a href="/login" className="btn btn-primary btn-sm">Get started</a>
        </div>
      </nav>

      <section style={S.hero}>
        <div style={S.tag}>
          <span style={S.tagDot} />
          No login required
        </div>

        <h1 style={S.title}>
          Analyze any <span className="text-gradient">public repository</span>
        </h1>
        <p style={S.sub}>
          Paste a GitHub URL and get an AI-powered architecture overview, module breakdown,
          reading order, and deployment detection — instantly.
        </p>

        <div style={S.inputRow}>
          <input
            style={S.input}
            placeholder="https://github.com/owner/repo"
            value={repoUrl}
            onChange={(e) => setRepoUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void submit()}
            disabled={busy}
          />
          <button
            className="btn btn-primary"
            style={{ padding: "0 28px", height: 48, fontSize: 15, fontWeight: 600, whiteSpace: "nowrap" as const }}
            disabled={busy || !repoUrl}
            onClick={() => void submit()}
          >
            {busy ? "Analyzing…" : "Analyze"}
          </button>
        </div>
        {error && <p style={{ color: "#f87171", fontSize: 13, marginTop: 10 }}>{error}</p>}

        <p style={S.hint}>
          Only public repositories. Results expire after 7 days.
        </p>
      </section>
    </div>
  );
}

const S = {
  nav: {
    position: "sticky" as const, top: 0, zIndex: 50,
    background: "rgba(10,12,16,.85)", backdropFilter: "blur(16px)",
    borderBottom: "1px solid rgba(255,255,255,.08)",
    padding: "0 40px", height: 64,
    display: "flex", alignItems: "center", justifyContent: "space-between",
  },
  logoLink: { display: "flex", alignItems: "center", gap: 10, textDecoration: "none", color: "inherit" },
  logoIcon: {
    width: 34, height: 34,
    background: "linear-gradient(135deg, #0d9488, #2dd4bf)",
    borderRadius: 8,
    display: "flex", alignItems: "center", justifyContent: "center",
    fontSize: 18, boxShadow: "0 0 20px rgba(13,148,136,.35)",
  },
  hero: {
    maxWidth: 700, margin: "0 auto", padding: "100px 24px 60px", textAlign: "center" as const,
  },
  tag: {
    display: "inline-flex", alignItems: "center", gap: 8,
    background: "rgba(13,148,136,.12)", border: "1px solid rgba(13,148,136,.3)",
    borderRadius: 999, padding: "5px 14px", fontSize: 12, fontWeight: 600,
    color: "#2dd4bf", letterSpacing: ".04em", textTransform: "uppercase" as const, marginBottom: 28,
  },
  tagDot: {
    width: 6, height: 6, background: "#2dd4bf", borderRadius: "50%",
    boxShadow: "0 0 6px #2dd4bf", animation: "pulse-dot 1.5s ease-in-out infinite",
  },
  title: { fontSize: "clamp(32px, 5vw, 52px)", fontWeight: 900, lineHeight: 1.15, marginBottom: 16, letterSpacing: "-.02em" },
  sub: { fontSize: 18, color: "var(--text-secondary)", lineHeight: 1.65, maxWidth: 560, margin: "0 auto 36px" },
  inputRow: {
    display: "flex", gap: 10, maxWidth: 540, margin: "0 auto",
  },
  input: {
    flex: 1, height: 48, padding: "0 16px", borderRadius: 10,
    border: "1px solid rgba(255,255,255,.15)", background: "rgba(255,255,255,.06)",
    color: "#f0f4ff", fontSize: 15, outline: "none",
  },
  hint: { color: "var(--text-muted)", fontSize: 13, marginTop: 14 },
} as const;
