"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { isAuthenticated } from "@/lib/api";

const FEATURES = [
  {
    icon: "🔬",
    title: "AST-Level Code Analysis",
    desc: "Tree-sitter parses every file to extract functions, classes, dependency graphs, and design patterns — not just keyword matching.",
  },
  {
    icon: "🔍",
    title: "Hybrid Retrieval (Dense + Sparse)",
    desc: "Dense embeddings capture semantic meaning. BM25 catches exact symbol names. Reciprocal Rank Fusion combines both for interview-accurate answers.",
  },
  {
    icon: "📌",
    title: "Citation-Grounded Answers",
    desc: "Every answer links back to specific files and line ranges in your repo. No hallucinations — only what your code actually does.",
  },
  {
    icon: "🏗️",
    title: "Architecture Overview",
    desc: "Auto-generated system diagram, dependency graph, entry-point analysis, and tech-stack fingerprint — your entire project at a glance.",
  },
  {
    icon: "🧩",
    title: "Module-by-Module Explainers",
    desc: "Purpose, key abstractions, internal logic walkthrough, failure modes, and interview talking points for every module.",
  },
  {
    icon: "🎤",
    title: "Mock Interview Simulator",
    desc: "AI personas that probe, challenge, and score you on clarity, depth, specificity, and confidence — just like the real thing.",
  },
];

interface Competitor {
  name: string;
  interviewPrep: boolean | "partial";
  repoConnected: boolean | "partial";
  citationGrounded: boolean | "partial";
  highlight?: boolean;
}

const COMPETITORS: Competitor[] = [
  { name: "GitHub Copilot",   interviewPrep: false, repoConnected: "partial", citationGrounded: false },
  { name: "ChatGPT / Claude", interviewPrep: false, repoConnected: false,     citationGrounded: false },
  { name: "Pramp",            interviewPrep: true,  repoConnected: false,     citationGrounded: false },
  { name: "LeetCode",         interviewPrep: true,  repoConnected: false,     citationGrounded: false },
  { name: "Vibe Coder",       interviewPrep: true,  repoConnected: true,      citationGrounded: true, highlight: true },
];

const STAGES = [
  { label: "Deep Code Analysis",       desc: "AST parsing across all languages" },
  { label: "Hybrid Retrieval Index",   desc: "Dense + sparse search combined" },
  { label: "Citation-Based Generation",desc: "Every answer grounded in your code" },
  { label: "Interview Simulation",     desc: "Realistic scoring and feedback" },
];

function Check({ on }: { on: boolean | "partial" }) {
  if (on === true)    return <span style={{ color: "#4ade80", fontSize: 18 }}>✓</span>;
  if (on === "partial") return <span style={{ color: "#fbbf24", fontSize: 16 }}>~</span>;
  return <span style={{ color: "#ef4444", fontSize: 16 }}>✗</span>;
}

export default function LandingPage() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    isAuthenticated().then((authed) => {
      if (authed) router.replace("/dashboard");
    });
  }, [router]);

  if (!mounted) {
    return <div style={{ background: "#0a0c10", minHeight: "100vh" }} />;
  }

  return (
    <div style={{ background: "#0a0c10", color: "#f0f4ff", minHeight: "100vh", fontFamily: "Inter, sans-serif" }}>
      {/* Animated background */}
      <div className="gradient-bg" />

      {/* Nav */}
      <nav style={S.nav}>
        <div style={S.navLogo}>
          <div style={S.logoIcon}>⚡</div>
          <span style={{ fontWeight: 700, fontSize: 18 }}>Vibe Coder</span>
        </div>
        <div style={S.navRight}>
          <a href="/analyze" style={S.navLink}>Public analysis</a>
          <a href="/login" style={S.navLink}>Sign in</a>
          <a href="/login" className="btn btn-primary btn-sm">Get started</a>
        </div>
      </nav>

      {/* Hero */}
      <section style={S.hero}>
        <div className="fade-up" style={S.heroTag}>
          <span style={S.tagDot} />
          AI-powered · Citation-grounded · Repository-connected
        </div>

        <h1 className="fade-up fade-up-delay-1" style={S.heroTitle}>
          You built it.<br />
          <span className="text-gradient">Can you explain it?</span>
        </h1>

        <p className="fade-up fade-up-delay-2" style={S.heroSub}>
          Connect any GitHub repository and Vibe Coder builds an interview-ready study guide from your
          actual code — architecture diagrams, module walkthroughs, a curated question bank, and a
          live mock-interview simulator that scores your answers in real time.
        </p>

        <div className="fade-up fade-up-delay-3" style={S.heroActions}>
          <a href="/login" className="btn btn-primary btn-lg" style={{ gap: 10 }}>
            <span>Connect your repo</span>
            <span>→</span>
          </a>
          <a href="#how" className="btn btn-ghost btn-lg">See how it works</a>
        </div>

        {/* Terminal mockup */}
        <div className="fade-up fade-up-delay-4 glass" style={S.terminal}>
          <div style={S.terminalDots}>
            {["#ff5f56","#ffbd2e","#27c93f"].map(c => (
              <span key={c} style={{ width: 12, height: 12, borderRadius: "50%", background: c, display: "inline-block" }} />
            ))}
          </div>
          <div style={S.terminalBody}>
            <TerminalLine color="#94a3b8" text="$ vibe-coder connect https://github.com/you/my-app" />
            <TerminalLine color="#4ade80" text="✓  Cloning repository…" delay={0.4} />
            <TerminalLine color="#4ade80" text="✓  AST parsing 347 files across 12 modules…" delay={0.8} />
            <TerminalLine color="#4ade80" text="✓  Indexing 2,841 code chunks (dense + BM25)…" delay={1.2} />
            <TerminalLine color="#4ade80" text="✓  Generating architecture overview…" delay={1.6} />
            <TerminalLine color="#2dd4bf" text="✓  Study guide ready. 47 interview questions generated." delay={2.0} />
            <TerminalLine color="#60a5fa" text='$ ask "How does authentication work?"' delay={2.5} />
            <TerminalLine
              color="#e2e8f0"
              text={'The auth module (src/auth/middleware.ts:12-48) uses stateless JWTs…\n[src/auth/middleware.ts:12-48] [src/routes/auth.ts:31-67]'}
              delay={3.0}
            />
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how" style={S.section}>
        <h2 style={S.sectionTitle}>How Vibe Coder works</h2>
        <p style={S.sectionSub}>Four phases. One goal: from repository to interview confidence.</p>
        <div style={S.stagesGrid}>
          {STAGES.map((stage, i) => (
            <div key={stage.label} className="card" style={S.stageCard}>
              <div style={S.stageNum}>{String(i + 1).padStart(2, "0")}</div>
              <div style={S.stageLabel}>{stage.label}</div>
              <div style={S.stageDesc}>{stage.desc}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section style={S.section}>
        <h2 style={S.sectionTitle}>Everything you need to ace the interview</h2>
        <p style={S.sectionSub}>From repository connection to interview-day confidence — all in one place.</p>
        <div style={S.featGrid}>
          {FEATURES.map(f => (
            <div key={f.title} className="card" style={S.featCard}>
              <div style={S.featIcon}>{f.icon}</div>
              <h3 style={S.featTitle}>{f.title}</h3>
              <p style={S.featDesc}>{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Comparison table */}
      <section style={S.section}>
        <h2 style={S.sectionTitle}>Why Vibe Coder?</h2>
        <p style={S.sectionSub}>No other tool combines repository connection, interview prep, and citation grounding.</p>
        <div className="glass" style={S.table}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["Platform", "Interview Prep", "Repo-Connected", "Citation-Grounded"].map(h => (
                  <th key={h} style={S.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {COMPETITORS.map(c => (
                <tr key={c.name} style={c.highlight ? S.trHighlight : S.tr}>
                  <td style={{ ...S.td, fontWeight: c.highlight ? 700 : 400, color: c.highlight ? "#2dd4bf" : "#f0f4ff" }}>
                    {c.name}
                  </td>
                  <td style={{ ...S.td, textAlign: "center" }}><Check on={c.interviewPrep} /></td>
                  <td style={{ ...S.td, textAlign: "center" }}><Check on={c.repoConnected} /></td>
                  <td style={{ ...S.td, textAlign: "center" }}><Check on={c.citationGrounded} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* CTA */}
      <section style={S.cta}>
        <div className="glass" style={S.ctaCard}>
          <h2 style={{ fontSize: 36, fontWeight: 800, marginBottom: 12 }}>
            Ready to master your own code?
          </h2>
          <p style={{ color: "var(--text-secondary)", fontSize: 18, marginBottom: 32 }}>
            Connect a GitHub repository and generate your study guide in minutes.
          </p>
          <a href="/login" className="btn btn-primary btn-lg">
            Get started for free →
          </a>
        </div>
      </section>

      {/* Footer */}
      <footer style={S.footer}>
        <div style={S.footerLogo}>
          <div style={S.logoIcon}>⚡</div>
          <span style={{ fontWeight: 700 }}>Vibe Coder</span>
        </div>
        <p style={{ color: "var(--text-muted)", fontSize: 13 }}>
          AI-powered interview preparation. Built for the vibe-coding generation.
        </p>
      </footer>
    </div>
  );
}

function TerminalLine({ text, color, delay = 0 }: { text: string; color: string; delay?: number }) {
  return (
    <div style={{
      color,
      fontSize: 13,
      lineHeight: 1.7,
      fontFamily: "monospace",
      animation: `fadeUp .4s ease both`,
      animationDelay: `${delay}s`,
      whiteSpace: "pre-wrap",
    }}>
      {text}
    </div>
  );
}

const S = {
  nav: {
    position: "sticky" as const,
    top: 0,
    zIndex: 50,
    background: "rgba(10,12,16,.85)",
    backdropFilter: "blur(16px)",
    borderBottom: "1px solid rgba(255,255,255,.08)",
    padding: "0 40px",
    height: 64,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  },
  navLogo: { display: "flex", alignItems: "center", gap: 10 },
  logoIcon: {
    width: 34, height: 34,
    background: "linear-gradient(135deg, #0d9488, #2dd4bf)",
    borderRadius: 8,
    display: "flex", alignItems: "center", justifyContent: "center",
    fontSize: 18,
    boxShadow: "0 0 20px rgba(13,148,136,.35)",
  },
  navRight: { display: "flex", alignItems: "center", gap: 16 },
  navLink: { color: "var(--text-secondary)", fontSize: 14, fontWeight: 500 },

  hero: {
    maxWidth: 900,
    margin: "0 auto",
    padding: "80px 24px 60px",
    textAlign: "center" as const,
  },
  heroTag: {
    display: "inline-flex", alignItems: "center", gap: 8,
    background: "rgba(13,148,136,.12)",
    border: "1px solid rgba(13,148,136,.3)",
    borderRadius: 999,
    padding: "5px 14px",
    fontSize: 12,
    fontWeight: 600,
    color: "#2dd4bf",
    letterSpacing: ".04em",
    marginBottom: 28,
    textTransform: "uppercase" as const,
  },
  tagDot: {
    width: 6, height: 6,
    background: "#2dd4bf",
    borderRadius: "50%",
    boxShadow: "0 0 6px #2dd4bf",
    animation: "pulse-dot 1.5s ease-in-out infinite",
  },
  heroTitle: {
    fontSize: "clamp(40px, 7vw, 72px)",
    fontWeight: 900,
    lineHeight: 1.1,
    marginBottom: 24,
    letterSpacing: "-.02em",
  },
  heroSub: {
    fontSize: "clamp(16px, 2vw, 20px)",
    color: "var(--text-secondary)",
    lineHeight: 1.65,
    maxWidth: 680,
    margin: "0 auto 36px",
  },
  heroActions: { display: "flex", gap: 14, justifyContent: "center", flexWrap: "wrap" as const, marginBottom: 48 },

  terminal: {
    maxWidth: 700,
    margin: "0 auto",
    padding: "0",
    overflow: "hidden",
  },
  terminalDots: {
    display: "flex", gap: 8, padding: "14px 18px",
    borderBottom: "1px solid rgba(255,255,255,.06)",
  },
  terminalBody: {
    padding: "20px 24px",
    display: "flex",
    flexDirection: "column" as const,
    gap: 4,
    background: "rgba(0,0,0,.3)",
  },

  section: { maxWidth: 1060, margin: "0 auto", padding: "80px 24px" },
  sectionTitle: { fontSize: "clamp(28px, 4vw, 42px)", fontWeight: 800, textAlign: "center" as const, marginBottom: 12, letterSpacing: "-.02em" },
  sectionSub: { color: "var(--text-secondary)", textAlign: "center" as const, fontSize: 18, marginBottom: 52, maxWidth: 560, margin: "0 auto 52px" },

  stagesGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 16 },
  stageCard: { position: "relative" as const },
  stageNum: { fontSize: 44, fontWeight: 900, color: "rgba(20,184,166,.2)", lineHeight: 1, marginBottom: 12, fontVariantNumeric: "tabular-nums" },
  stageLabel: { fontSize: 17, fontWeight: 700, marginBottom: 6, color: "var(--text-primary)" },
  stageDesc: { fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.55 },

  featGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 16 },
  featCard: { display: "flex", flexDirection: "column" as const, gap: 10 },
  featIcon: { fontSize: 32 },
  featTitle: { fontSize: 17, fontWeight: 700, color: "var(--text-primary)" },
  featDesc: { fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.6 },

  table: { padding: 0, overflow: "hidden" },
  th: { padding: "14px 20px", textAlign: "left" as const, fontSize: 12, fontWeight: 700, color: "var(--text-muted)", letterSpacing: ".05em", textTransform: "uppercase" as const, borderBottom: "1px solid rgba(255,255,255,.08)" },
  td: { padding: "14px 20px", fontSize: 14, borderBottom: "1px solid rgba(255,255,255,.05)" },
  tr: { transition: "background .15s" },
  trHighlight: { background: "rgba(13,148,136,.07)" },

  cta: { padding: "80px 24px", textAlign: "center" as const },
  ctaCard: { maxWidth: 640, margin: "0 auto", padding: "60px 48px" },

  footer: {
    borderTop: "1px solid rgba(255,255,255,.06)",
    padding: "32px 40px",
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    gap: 10,
    textAlign: "center" as const,
  },
  footerLogo: { display: "flex", alignItems: "center", gap: 8, fontWeight: 700, fontSize: 16 },
} as const;