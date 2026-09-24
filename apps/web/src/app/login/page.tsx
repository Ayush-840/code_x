"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { isAuthenticated, API_URL } from "@/lib/api";

function LoginContent() {
  const router = useRouter();
  const params = useSearchParams();
  const [mode, setMode] = useState<"checking" | "ready" | "error">("checking");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    // OAuth callback sets cookies, redirects here with ?authenticated=1
    const authenticated = params.get("authenticated");
    if (authenticated === "1") {
      router.replace("/dashboard");
      return;
    }
    // Check for auth error
    const authError = params.get("error");
    if (authError) {
      setErrorMsg(decodeURIComponent(authError));
      setMode("error");
      return;
    }
    // Already logged in
    isAuthenticated().then((authed) => {
      if (authed) {
        router.replace("/dashboard");
      } else {
        setMode("ready");
      }
    });
  }, [params, router]);

  // Shared, build-time-guarded URL (PRD-C03) — no silent localhost fallback here.

  if (mode === "checking") {
    return (
      <div style={S.page}>
        <div className="gradient-bg" />
        <div style={S.spinner}><div className="spinner" /></div>
      </div>
    );
  }

  if (mode === "error") {
    return (
      <div style={S.page}>
        <div className="gradient-bg" />
        <div className="glass fade-up" style={S.card}>
          <h1 style={S.h1}>Authentication Error</h1>
          <p style={{ ...S.p, marginBottom: 16 }}>{errorMsg ?? "Failed to authenticate."}</p>
          <a href="/login" style={{ ...S.githubBtn, textDecoration: "none" }}>Try Again</a>
        </div>
      </div>
    );
  }

  return (
    <div style={S.page}>
      <div className="gradient-bg" />

      {/* Logo */}
      <div style={S.logoArea}>
        <div style={S.logoIcon}>⚡</div>
        <span style={S.logoText}>Vibe Coder</span>
      </div>

      {/* Card */}
      <div className="glass fade-up" style={S.card}>
        <div style={S.cardHeader}>
          <h1 style={S.h1}>Welcome back</h1>
          <p style={S.p}>Sign in with GitHub to access your interview prep dashboard.</p>
        </div>

        <hr style={S.divider} />

        <a href={`${API_URL}/v1/auth/github`} style={{ display: "block" }}>
          <button style={S.githubBtn} className="btn">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
            </svg>
            Continue with GitHub
          </button>
        </a>

        <p style={S.note}>
          By signing in you agree to our Terms of Service. We request read-only access to your repositories.
        </p>

        <div style={S.steps}>
          {[
            { n: "1", t: "Connect a repo", d: "Paste any GitHub URL and your PAT" },
            { n: "2", t: "AI analyzes it",  d: "AST parsing + hybrid retrieval indexing" },
            { n: "3", t: "Prep for interviews", d: "Chat, question bank, mock interviews" },
          ].map(s => (
            <div key={s.n} style={S.step}>
              <div style={S.stepNum}>{s.n}</div>
              <div>
                <div style={S.stepTitle}>{s.t}</div>
                <div style={S.stepDesc}>{s.d}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <p style={S.footer}>
        <a href="/" style={{ color: "var(--text-muted)" }}>← Back to home</a>
      </p>
    </div>
  );
}

const S = {
  page: {
    minHeight: "100vh",
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    justifyContent: "center",
    padding: "40px 20px",
    position: "relative" as const,
    background: "var(--bg)",
  },
  spinner: { display: "flex", alignItems: "center", justifyContent: "center" },
  logoArea: {
    display: "flex", alignItems: "center", gap: 10,
    marginBottom: 28,
  },
  logoIcon: {
    width: 38, height: 38,
    background: "linear-gradient(135deg, #0d9488, #2dd4bf)",
    borderRadius: 10,
    display: "flex", alignItems: "center", justifyContent: "center",
    fontSize: 20,
    boxShadow: "0 0 24px rgba(13,148,136,.4)",
  },
  logoText: { fontWeight: 800, fontSize: 22, color: "var(--text-primary)" },

  card: {
    width: "100%",
    maxWidth: 400,
    padding: "32px",
    marginBottom: 24,
  },
  cardHeader: { marginBottom: 20 },
  h1: { fontSize: 24, fontWeight: 800, marginBottom: 6, color: "var(--text-primary)" },
  p: { color: "var(--text-secondary)", fontSize: 14, lineHeight: 1.55 },
  divider: { border: "none", borderTop: "1px solid var(--border)", margin: "20px 0" },

  githubBtn: {
    width: "100%",
    padding: "13px 20px",
    fontSize: 15,
    fontWeight: 700,
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,.12)",
    background: "#24292f",
    color: "#fff",
    display: "flex" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    gap: 10,
    transition: "all .18s ease",
    cursor: "pointer",
  },

  note: {
    fontSize: 11,
    color: "var(--text-muted)",
    textAlign: "center" as const,
    marginTop: 12,
    lineHeight: 1.5,
  },

  steps: {
    marginTop: 24,
    display: "flex",
    flexDirection: "column" as const,
    gap: 14,
    borderTop: "1px solid var(--border)",
    paddingTop: 20,
  },
  step: { display: "flex", gap: 12, alignItems: "flex-start" },
  stepNum: {
    width: 24, height: 24, minWidth: 24,
    background: "rgba(13,148,136,.15)",
    border: "1px solid rgba(13,148,136,.3)",
    borderRadius: "50%",
    display: "flex", alignItems: "center", justifyContent: "center",
    fontSize: 12, fontWeight: 700, color: "#2dd4bf",
  },
  stepTitle: { fontSize: 14, fontWeight: 600, color: "var(--text-primary)", marginBottom: 2 },
  stepDesc: { fontSize: 12, color: "var(--text-muted)" },

  footer: { color: "var(--text-muted)", fontSize: 13 },
} as const;

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div style={S.page}>
          <div className="gradient-bg" />
          <div style={S.spinner}><div className="spinner" /></div>
        </div>
      }
    >
      <LoginContent />
    </Suspense>
  );
}
