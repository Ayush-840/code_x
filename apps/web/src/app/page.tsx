"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { isAuthenticated } from "@/lib/api";
import { HeroReveal } from "@/components/HeroReveal";
import { MotionLink } from "@/components/MotionLink";

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
    return <div className="bg-lab-bg min-h-screen" />;
  }

  return (
    <div className="bg-lab-bg text-lab-text min-h-screen font-sans relative">
      {/* Animated background */}
      <div className="gradient-bg" />

      {/* Nav */}
      <nav className="app-nav">
        <div className="app-logo">
          <div className="app-logo-icon">⚡</div>
          <span className="font-display tracking-wide">Vibe Coder</span>
        </div>
        <div className="flex items-center gap-4">
          <a href="/analyze" className="text-xs font-mono text-lab-textMuted hover:text-white transition-colors">
            Public analysis
          </a>
          <a href="/login" className="text-xs font-mono text-lab-textMuted hover:text-white transition-colors">
            Sign in
          </a>
          <a href="/login" className="btn btn-primary btn-sm">
            Get started
          </a>
        </div>
      </nav>

      {/* Hero */}
      <section className="max-w-4xl mx-auto px-6 pt-20 pb-16 text-center relative z-10">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-lab-blueDim border border-lab-blue/30 text-[11px] font-mono uppercase tracking-wider text-lab-blue mb-8">
          <span className="w-1.5 h-1.5 rounded-full bg-lab-blue animate-pulse" />
          Every answer traced back to your real code
        </div>

        <h1 className="font-display text-5xl sm:text-7xl font-bold tracking-tight mb-6 leading-tight text-white">
          You built it.<br />
          <HeroReveal>
            <span className="text-gradient">Can you explain it?</span>
          </HeroReveal>
        </h1>

        <p className="text-lab-textMuted text-base sm:text-lg max-w-2xl mx-auto mb-10 leading-relaxed font-sans">
          Point us at a GitHub repo and we'll read it with you — the architecture, how each module
          works, and the questions an interviewer would ask about it. Then practice out loud and
          get scored, with every answer citing the exact lines it came from.
        </p>

        <div className="flex gap-4 justify-center flex-wrap mb-16">
          <MotionLink href="/login" className="btn btn-primary btn-lg flex items-center gap-2">
            <span>Start with your repo</span>
            <span>→</span>
          </MotionLink>
          <MotionLink href="#how" className="btn btn-ghost btn-lg">
            See how it works
          </MotionLink>
        </div>

        {/* Terminal mockup */}
        <div className="glass max-w-2xl mx-auto overflow-hidden text-left border border-lab-border shadow-2xl">
          <div className="flex gap-2 px-4 py-3 border-b border-lab-border bg-lab-card/50">
            {["#ff5f56", "#ffbd2e", "#27c93f"].map((c) => (
              <span key={c} className="w-3 h-3 rounded-full inline-block" style={{ backgroundColor: c }} />
            ))}
          </div>
          <div className="p-5 font-mono text-xs space-y-1.5 bg-black/40">
            <TerminalLine color="#8B8B9E" text="$ vibe-coder connect https://github.com/you/my-app" />
            <TerminalLine color="#00D8FF" text="✓  Cloning repository…" delay={0.4} />
            <TerminalLine color="#00D8FF" text="✓  AST parsing 347 files across 12 modules…" delay={0.8} />
            <TerminalLine color="#00D8FF" text="✓  Indexing 2,841 code chunks (dense + BM25)…" delay={1.2} />
            <TerminalLine color="#00D8FF" text="✓  Generating architecture overview…" delay={1.6} />
            <TerminalLine color="#00D8FF" text="✓  Study guide ready. 47 interview questions generated." delay={2.0} />
            <TerminalLine color="#F2F2F5" text='$ ask "How does authentication work?"' delay={2.5} />
            <TerminalLine
              color="#8B8B9E"
              text={'The auth module (src/auth/middleware.ts:12-48) uses stateless JWTs…\n[src/auth/middleware.ts:12-48] [src/routes/auth.ts:31-67]'}
              delay={3.0}
            />
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="max-w-5xl mx-auto px-6 py-20 relative z-10">
        <p className="section-label text-center">01 // WORKFLOW</p>
        <h2 className="section-title text-center mb-3">How Vibe Coder works</h2>
        <p className="text-lab-textMuted text-center text-sm mb-12 max-w-lg mx-auto">
          Four phases. One goal: from repository to interview confidence.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {STAGES.map((stage, i) => (
            <div key={stage.label} className="panel p-5 space-y-2">
              <div className="font-display text-4xl text-lab-blue/30 font-bold">
                {String(i + 1).padStart(2, "0")}
              </div>
              <div className="font-semibold text-white text-sm">{stage.label}</div>
              <div className="text-xs text-lab-textMuted leading-relaxed">{stage.desc}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section className="max-w-5xl mx-auto px-6 py-20 relative z-10">
        <p className="section-label text-center">02 // CAPABILITIES</p>
        <h2 className="section-title text-center mb-3">Everything you need to ace the interview</h2>
        <p className="text-lab-textMuted text-center text-sm mb-12 max-w-lg mx-auto">
          From repository connection to interview-day confidence — all in one place.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {FEATURES.map((f) => (
            <div key={f.title} className="panel p-5 space-y-2">
              <div className="text-3xl mb-1">{f.icon}</div>
              <h3 className="font-semibold text-white text-sm">{f.title}</h3>
              <p className="text-xs text-lab-textMuted leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Comparison table */}
      <section className="max-w-5xl mx-auto px-6 py-20 relative z-10">
        <p className="section-label text-center">03 // COMPARISON</p>
        <h2 className="section-title text-center mb-3">Why Vibe Coder?</h2>
        <p className="text-lab-textMuted text-center text-sm mb-12 max-w-lg mx-auto">
          No other tool combines repository connection, interview prep, and citation grounding.
        </p>
        <div className="panel p-0 overflow-hidden">
          <table className="w-full border-collapse font-mono text-xs">
            <thead>
              <tr className="border-b border-lab-border bg-lab-card/50">
                {["Platform", "Interview Prep", "Repo-Connected", "Citation-Grounded"].map((h) => (
                  <th key={h} className="p-4 text-left font-semibold text-lab-textMuted uppercase tracking-wider">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {COMPETITORS.map((c) => (
                <tr
                  key={c.name}
                  className={`border-b border-lab-border/50 transition-colors ${
                    c.highlight ? "bg-lab-blueDim/40" : "hover:bg-lab-card/30"
                  }`}
                >
                  <td className={`p-4 font-sans ${c.highlight ? "font-bold text-lab-blue" : "text-white"}`}>
                    {c.name}
                  </td>
                  <td className="p-4 text-center"><Check on={c.interviewPrep} /></td>
                  <td className="p-4 text-center"><Check on={c.repoConnected} /></td>
                  <td className="p-4 text-center"><Check on={c.citationGrounded} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* CTA */}
      <section className="max-w-3xl mx-auto px-6 py-20 text-center relative z-10">
        <div className="panel p-10 space-y-4 border-lab-blue/30">
          <h2 className="font-display text-4xl font-bold text-white">
            Ready to master your own code?
          </h2>
          <p className="text-lab-textMuted text-sm max-w-md mx-auto">
            Connect a GitHub repository and generate your study guide in minutes.
          </p>
          <div className="pt-4">
            <a href="/login" className="btn btn-primary btn-lg">
              Get started for free →
            </a>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-lab-border py-8 px-6 text-center space-y-2 relative z-10 font-mono text-xs text-lab-textMuted">
        <div className="flex items-center justify-center gap-2 font-display text-base text-white">
          <div className="w-5 h-5 rounded bg-lab-blueDim border border-lab-blue/30 text-lab-blue flex items-center justify-center text-xs">
            ⚡
          </div>
          <span>Vibe Coder</span>
        </div>
        <p>AI-powered interview preparation. Built for the vibe-coding generation.</p>
      </footer>
    </div>
  );
}

function TerminalLine({ text, color, delay = 0 }: { text: string; color: string; delay?: number }) {
  return (
    <div
      style={{
        color,
        fontSize: 12,
        lineHeight: 1.7,
        fontFamily: "monospace",
        animation: `fadeUp .4s ease both`,
        animationDelay: `${delay}s`,
        whiteSpace: "pre-wrap",
      }}
    >
      {text}
    </div>
  );
}