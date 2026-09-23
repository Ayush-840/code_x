"use client";

import { useEffect, useState, useRef } from "react";
import type { Socket } from "socket.io-client";
import { Loader2 } from "lucide-react";

interface Question {
  sessionId?: string;
  questionId: string;
  questionText: string;
  category: string;
  questionNumber: number;
  totalQuestions: number;
}

interface Scores {
  clarity: number;
  depth: number;
  specificity: number;
  confidence: number;
}

interface Report {
  overallScore: number;
  strengths: string[];
  gaps: string[];
  studySuggestions: string[];
}

const PERSONAS = [
  {
    id: "friendly-senior",
    name: "Collaborative Senior Staff",
    desc: "Supportive, focuses on thought process and trade-off justification.",
    icon: "🤝",
  },
  {
    id: "strict-architect",
    name: "Principal System Architect",
    desc: "Probes deeply into edge cases, latency, and failure domains.",
    icon: "🔬",
  },
  {
    id: "startup-lead",
    name: "Fast-Paced Startup Lead",
    desc: "Focuses on delivery speed, pragmatic compromises, and maintenance.",
    icon: "🚀",
  },
];

const DIFFICULTIES = [
  { id: "junior", label: "Foundational", level: "Mid" },
  { id: "senior", label: "Senior Engineer", level: "Senior" },
  { id: "staff", label: "Staff / Principal", level: "Staff" },
];

export function MockInterviewTab({
  repoId,
  socket,
}: {
  repoId: string;
  socket: Socket | null;
}) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [question, setQuestion] = useState<Question | null>(null);
  const [answer, setAnswer] = useState("");
  const [feedback, setFeedback] = useState<{ scores: Scores; feedback: string } | null>(null);
  const [report, setReport] = useState<Report | null>(null);

  const [selectedPersona, setSelectedPersona] = useState("friendly-senior");
  const [selectedDifficulty, setSelectedDifficulty] = useState("senior");
  const [submitting, setSubmitting] = useState(false);

  const [elapsedSec, setElapsedSec] = useState(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!socket) return;

    const onQuestion = (q: Question) => {
      setSessionId(q.sessionId ?? null);
      setQuestion(q);
      setFeedback(null);
      setAnswer("");
      setSubmitting(false);
      setElapsedSec(0);
    };

    const onScore = (s: { scores: Scores; feedback: string }) => {
      setFeedback(s);
      setSubmitting(false);
    };

    const onComplete = (p: { report: Report }) => {
      setReport(p.report);
      setQuestion(null);
      setSubmitting(false);
    };

    socket.on("mock-interview:question", onQuestion);
    socket.on("mock-interview:score", onScore);
    socket.on("mock-interview:complete", onComplete);

    return () => {
      socket.off("mock-interview:question", onQuestion);
      socket.off("mock-interview:score", onScore);
      socket.off("mock-interview:complete", onComplete);
    };
  }, [socket]);

  useEffect(() => {
    if (question && !feedback && !report) {
      timerRef.current = setInterval(() => {
        setElapsedSec((prev) => prev + 1);
      }, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [question, feedback, report]);

  const start = () => {
    if (!socket) {
      setReport(null);
      setQuestion({
        sessionId: "demo-sess",
        questionId: "q1",
        questionText: "Walk me through the overall architecture of this project and why key tech choices were made.",
        category: "architecture",
        questionNumber: 1,
        totalQuestions: 5,
      });
      return;
    }
    setReport(null);
    socket.emit("mock-interview:start", {
      repoId,
      persona: selectedPersona,
      difficulty: selectedDifficulty,
    });
  };

  const submit = () => {
    if (!answer.trim() || submitting) return;
    setSubmitting(true);
    if (!socket || !sessionId) {
      setTimeout(() => {
        setFeedback({
          scores: { clarity: 85, depth: 80, specificity: 75, confidence: 90 },
          feedback: "Great structuring. You clearly articulated the service responsibilities. To elevate to Staff level, cite concrete failure mitigation strategies.",
        });
        setSubmitting(false);
      }, 600);
      return;
    }
    socket.emit("mock-interview:answer", { sessionId, answer });
  };

  const next = () => {
    if (!socket || !sessionId) {
      setReport({
        overallScore: 84,
        strengths: ["Clean modular explanation", "Database trade-off articulation", "Confident delivery"],
        gaps: ["Could reference more low-level file boundaries", "Async retry policies under load"],
        studySuggestions: [
          "Review apps/worker pipeline error recovery handlers",
          "Deep-dive into Prisma connection pooling thresholds",
        ],
      });
      setQuestion(null);
      return;
    }
    socket.emit("mock-interview:next", { sessionId });
  };

  const formatTime = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const remainder = secs % 60;
    return `${mins.toString().padStart(2, "0")}:${remainder.toString().padStart(2, "0")}`;
  };

  /* ────────────────────────────────────────────────────────── */
  /* Render Debrief / Final Report */
  /* ────────────────────────────────────────────────────────── */
  if (report) {
    const getVerdict = (score: number) => {
      if (score >= 85) return { text: "Strong Hire", color: "bg-green-500/20 text-green-400 border-green-500/30" };
      if (score >= 70) return { text: "Hire", color: "bg-teal-500/20 text-teal-400 border-teal-500/30" };
      if (score >= 50) return { text: "Lean Hire", color: "bg-amber-500/20 text-amber-400 border-amber-500/30" };
      return { text: "Needs Additional Preparation", color: "bg-red-500/20 text-red-400 border-red-500/30" };
    };
    const verdict = getVerdict(report.overallScore);

    return (
      <div className="space-y-6">
        <div>
          <p className="section-label">05 // MOCK INTERVIEW</p>
          <h2 className="section-title">Mock Interview Scorecard</h2>
        </div>

        <div className="panel p-6 space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-xs font-mono uppercase tracking-wider text-lab-blue mb-1 block">Evaluation Debrief</span>
              <h3 className="text-2xl font-display font-bold text-white">Mock Interview Scorecard</h3>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-baseline gap-2">
                <span className="text-4xl font-mono font-bold text-lab-blue">{report.overallScore}</span>
                <span className="text-lab-textMuted">/ 100</span>
              </div>
              <span className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-sm font-mono border ${verdict.color}`}>
                {verdict.text}
              </span>
            </div>
          </div>

          <hr className="border-lab-border" />

          {/* Strengths & Gaps Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-lab-card border border-lab-border rounded-lg p-4">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-green-400 text-xl">✓</span>
                <span className="font-semibold text-white">Demonstrated Strengths</span>
              </div>
              <ul className="space-y-2">
                {report.strengths.map((s, i) => (
                  <li key={i} className="flex gap-2 text-sm text-lab-textMuted">
                    <span className="text-green-400 shrink-0">•</span>
                    <span>{s}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="bg-lab-card border border-lab-border rounded-lg p-4">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-amber-400 text-xl">⚠</span>
                <span className="font-semibold text-white">Target Improvement Areas</span>
              </div>
              <ul className="space-y-2">
                {report.gaps.map((g, i) => (
                  <li key={i} className="flex gap-2 text-sm text-lab-textMuted">
                    <span className="text-amber-400 shrink-0">•</span>
                    <span>{g}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Study Suggestions */}
          <div>
            <h4 className="text-xs font-mono uppercase tracking-wider text-lab-textMuted mb-3">Targeted Revision Recommendations</h4>
            <div className="space-y-2">
              {report.studySuggestions.map((rec, i) => (
                <div key={i} className="flex gap-3 px-4 py-3 bg-lab-card border border-lab-border rounded-lg">
                  <span className="text-xl shrink-0">📖</span>
                  <p className="text-sm text-white leading-relaxed">{rec}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-end pt-4 border-t border-lab-border">
            <button
              className="px-6 py-2.5 text-sm font-semibold rounded-lg bg-lab-blue text-black hover:bg-lab-blue/80 transition-colors"
              onClick={start}
            >
              Start Another Session
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* ────────────────────────────────────────────────────────── */
  /* Render Setup / Pre-interview screen */
  /* ────────────────────────────────────────────────────────── */
  if (!question) {
    return (
      <div className="space-y-6">
        <div>
          <p className="section-label">05 // MOCK INTERVIEW</p>
          <h2 className="section-title">Simulated Technical Interview</h2>
        </div>

        <div className="panel p-6 max-w-2xl mx-auto">
          <div className="text-center mb-8">
            <div className="w-14 h-14 rounded-xl bg-lab-blueDim border border-lab-blue/30 flex items-center justify-center text-4xl mx-auto mb-4">
              🎙️
            </div>
            <h3 className="text-xl font-display font-bold text-white mb-3">Simulated Technical Interview</h3>
            <p className="text-lab-textMuted text-sm leading-relaxed max-w-xl mx-auto">
              Practice speaking on your repository under simulated pressure. Receive immediate rubric scores,
              depth evaluations, and actionable feedback tailored to your code.
            </p>
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-mono bg-amber-500/20 text-amber-400 border border-amber-500/30 mt-4">
              DEMO MODE
            </span>
          </div>

          {/* Persona selector */}
          <div className="mb-6">
            <label className="block text-xs font-mono uppercase tracking-wider text-lab-textMuted mb-3">Interviewer Persona</label>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {PERSONAS.map((p) => {
                const isSelected = selectedPersona === p.id;
                return (
                  <div
                    key={p.id}
                    className={`p-4 rounded-lg border cursor-pointer transition-all ${
                      isSelected
                        ? "border-lab-blue bg-lab-blue/10"
                        : "border-lab-border bg-lab-card hover:border-lab-blue/40"
                    }`}
                    onClick={() => setSelectedPersona(p.id)}
                  >
                    <div className="text-3xl mb-2">{p.icon}</div>
                    <div className="font-semibold text-white text-sm">{p.name}</div>
                    <div className="text-xs text-lab-textMuted mt-1">{p.desc}</div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Difficulty selector */}
          <div className="mb-8">
            <label className="block text-xs font-mono uppercase tracking-wider text-lab-textMuted mb-3">Interview Target Level</label>
            <div className="flex gap-3">
              {DIFFICULTIES.map((d) => {
                const isSelected = selectedDifficulty === d.id;
                return (
                  <button
                    key={d.id}
                    type="button"
                    className={`flex-1 px-4 py-3 rounded-lg border text-sm font-medium transition-all ${
                      isSelected
                        ? "bg-lab-blue text-black border-lab-blue"
                        : "bg-lab-card text-lab-textMuted border-lab-border hover:border-lab-blue/40"
                    }`}
                    onClick={() => setSelectedDifficulty(d.id)}
                  >
                    <span className="font-semibold">{d.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex justify-center">
            <button
              className="px-8 py-3 text-base font-semibold rounded-lg bg-lab-blue text-black hover:bg-lab-blue/80 transition-colors"
              onClick={start}
            >
              Begin Interview Simulation →
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* ────────────────────────────────────────────────────────── */
  /* Render Active Question Screen */
  /* ────────────────────────────────────────────────────────── */
  const wordCount = answer.trim() ? answer.trim().split(/\s+/).length : 0;

  return (
    <div className="space-y-6">
      <div>
        <p className="section-label">05 // MOCK INTERVIEW</p>
        <h2 className="section-title">Interview Simulation</h2>
      </div>

      <div className="panel p-6 max-w-3xl mx-auto space-y-6">
        {/* Top Info Bar */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-mono bg-teal-500/20 text-teal-400 border border-teal-500/30">
              Question {question.questionNumber} of {question.totalQuestions}
            </span>
            <span className="text-xs text-lab-textMuted">
              Focus: <strong className="text-white">{question.category}</strong>
            </span>
          </div>

          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-lab-card border border-lab-border">
            <span className="text-lab-blue text-xs">⏱</span>
            <span className="font-mono text-sm font-semibold tabular-nums">{formatTime(elapsedSec)}</span>
          </div>
        </div>

        {/* Question text */}
        <h3 className="text-xl font-display font-semibold text-white leading-snug">{question.questionText}</h3>

        {/* Interview tip */}
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-teal-500/10 border border-teal-500/20">
          <span className="text-lab-blue text-lg">💡</span>
          <span className="text-xs text-lab-textMuted">
            Tip: Frame your answer with the problem context, tech constraints, key decisions, and runtime trade-offs.
          </span>
        </div>

        {/* Answer textarea */}
        <div className="relative">
          <textarea
            className="w-full bg-lab-card border border-lab-border rounded-lg px-4 py-4 text-white text-sm font-sans leading-relaxed resize-y focus:outline-none focus:ring-2 focus:ring-lab-blue/40 focus:border-transparent"
            rows={8}
            placeholder="Type your response as if speaking in the interview. Explicitly name files, libraries, and design trade-offs..."
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            disabled={!!feedback || submitting}
          />
          <div className="absolute bottom-3 right-3 text-[10px] text-lab-dim">
            {wordCount} {wordCount === 1 ? "word" : "words"}
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end">
          {!feedback ? (
            <button
              className="px-6 py-2.5 text-sm font-semibold rounded-lg bg-lab-blue text-black hover:bg-lab-blue/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              onClick={submit}
              disabled={!answer.trim() || submitting}
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Evaluating answer…</span>
                </>
              ) : (
                <span>Submit Answer for Review</span>
              )}
            </button>
          ) : (
            <button
              className="px-6 py-2.5 text-sm font-semibold rounded-lg bg-lab-blue text-black hover:bg-lab-blue/80 transition-colors"
              onClick={next}
            >
              {question.questionNumber >= question.totalQuestions ? "View Final Scorecard →" : "Next Question →"}
            </button>
          )}
        </div>

        {/* Feedback Section */}
        {feedback && (
          <div className="pt-6 border-t border-lab-border space-y-6">
            <div className="flex items-center gap-2">
              <span className="text-xl">🎯</span>
              <span className="font-semibold text-base text-white">Interviewer Assessment</span>
            </div>

            {/* Metric Meters */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <ScoreMeter label="Clarity" value={feedback.scores.clarity} />
              <ScoreMeter label="Technical Depth" value={feedback.scores.depth} />
              <ScoreMeter label="Code Specificity" value={feedback.scores.specificity} />
              <ScoreMeter label="Confidence" value={feedback.scores.confidence} />
            </div>

            {/* Qualitative Critique */}
            <div className="px-4 py-3 rounded-lg bg-teal-500/05 border border-teal-500/15">
              <p className="text-xs font-semibold text-teal-300 mb-1">Reviewer Notes:</p>
              <p className="text-sm text-white leading-relaxed m-0">{feedback.feedback}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ScoreMeter({ label, value }: { label: string; value: number }) {
  const getColor = (v: number) => {
    if (v >= 80) return "bg-green-500";
    if (v >= 60) return "bg-lab-blue";
    if (v >= 40) return "bg-amber-500";
    return "bg-red-500";
  };

  const color = getColor(value);

  return (
    <div className="bg-lab-card border border-lab-border rounded-lg p-3">
      <div className="flex justify-between text-xs mb-2">
        <span className="font-medium text-lab-textMuted">{label}</span>
        <span className="font-mono font-bold text-white">{value}%</span>
      </div>
      <div className="h-1.5 rounded-full bg-lab-bg overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${color}`}
          style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
        />
      </div>
    </div>
  );
}