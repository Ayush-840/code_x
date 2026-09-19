"use client";

import { useEffect, useState, useRef } from "react";
import type { Socket } from "socket.io-client";

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

  // Setup state
  const [selectedPersona, setSelectedPersona] = useState("friendly-senior");
  const [selectedDifficulty, setSelectedDifficulty] = useState("senior");
  const [submitting, setSubmitting] = useState(false);

  // Timer state
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

  // Handle question timer
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
      // Mock session for demo preview
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
      // Mock score for demo preview
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
      // Mock next for demo preview
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
      if (score >= 85) return { text: "Strong Hire", color: "badge-green" };
      if (score >= 70) return { text: "Hire", color: "badge-teal" };
      if (score >= 50) return { text: "Lean Hire", color: "badge-amber" };
      return { text: "Needs Additional Preparation", color: "badge-red" };
    };
    const verdict = getVerdict(report.overallScore);

    return (
      <div style={S.container}>
        <div style={S.reportCard}>
          <div style={S.reportHeader}>
            <div>
              <span style={{ fontSize: 12, fontWeight: 700, color: "var(--brand-400)", textTransform: "uppercase" }}>
                Evaluation Debrief
              </span>
              <h2 style={S.reportTitle}>Mock Interview Scorecard</h2>
            </div>
            <div style={S.overallBadgeWrap}>
              <div style={S.scoreCircle}>
                <span style={S.scoreNumber}>{report.overallScore}</span>
                <span style={S.scoreSub}>/ 100</span>
              </div>
              <span className={`badge ${verdict.color}`} style={{ padding: "6px 14px", fontSize: 13, fontWeight: 700 }}>
                {verdict.text}
              </span>
            </div>
          </div>

          <hr style={S.divider} />

          {/* Strengths & Gaps Grid */}
          <div style={S.grid2}>
            <div style={S.metricCard}>
              <div style={S.metricCardHeader}>
                <span style={{ color: "var(--green)", fontSize: 16 }}>✓</span>
                <span style={S.metricCardTitle}>Demonstrated Strengths</span>
              </div>
              <ul style={S.metricList}>
                {report.strengths.map((s, i) => (
                  <li key={i} style={S.metricItem}>
                    <span style={{ color: "var(--green)", marginRight: 8 }}>•</span>
                    <span>{s}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div style={S.metricCard}>
              <div style={S.metricCardHeader}>
                <span style={{ color: "var(--amber)", fontSize: 16 }}>⚠</span>
                <span style={S.metricCardTitle}>Target Improvement Areas</span>
              </div>
              <ul style={S.metricList}>
                {report.gaps.map((g, i) => (
                  <li key={i} style={S.metricItem}>
                    <span style={{ color: "var(--amber)", marginRight: 8 }}>•</span>
                    <span>{g}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Study Suggestions */}
          <div style={{ marginTop: 24 }}>
            <h4 style={S.sectionHeading}>Targeted Revision Recommendations</h4>
            <div style={S.suggestionBox}>
              {report.studySuggestions.map((rec, i) => (
                <div key={i} style={S.recRow}>
                  <div style={S.recIcon}>📖</div>
                  <div style={{ fontSize: 13, color: "var(--text-primary)", lineHeight: 1.5 }}>
                    {rec}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 12, marginTop: 32 }}>
            <button className="btn btn-primary" onClick={start}>
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
      <div style={S.container}>
        <div style={S.setupCard}>
          <div style={{ textAlign: "center", marginBottom: 28 }}>
            <div style={S.heroIcon}>🎙️</div>
            <h2 style={S.heroTitle}>Simulated Technical Interview</h2>
            <p style={S.heroSubtitle}>
              Practice speaking on your repository under simulated pressure. Receive immediate rubric scores,
              depth evaluations, and actionable feedback tailored to your code.
            </p>
            <span className="badge badge-yellow" style={{ fontSize: 11, background: "rgba(234,179,8,0.15)", color: "#eab308", border: "1px solid rgba(234,179,8,0.3)", marginTop: 12, display: "inline-block" }}>
              DEMO MODE
            </span>
          </div>

          {/* Persona selector */}
          <div style={{ marginBottom: 24 }}>
            <label style={S.fieldLabel}>Interviewer Persona</label>
            <div style={S.personaGrid}>
              {PERSONAS.map((p) => {
                const isSelected = selectedPersona === p.id;
                return (
                  <div
                    key={p.id}
                    style={{
                      ...S.personaCard,
                      borderColor: isSelected ? "var(--brand-400)" : "var(--border)",
                      background: isSelected ? "rgba(13,148,136,0.12)" : "var(--surface-2)",
                    }}
                    onClick={() => setSelectedPersona(p.id)}
                  >
                    <div style={{ fontSize: 24, marginBottom: 6 }}>{p.icon}</div>
                    <div style={{ fontWeight: 700, fontSize: 14, color: "var(--text-primary)" }}>{p.name}</div>
                    <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 4 }}>{p.desc}</div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Difficulty selector */}
          <div style={{ marginBottom: 32 }}>
            <label style={S.fieldLabel}>Interview Target Level</label>
            <div style={S.difficultyRow}>
              {DIFFICULTIES.map((d) => {
                const isSelected = selectedDifficulty === d.id;
                return (
                  <button
                    key={d.id}
                    type="button"
                    style={{
                      ...S.difficultyBtn,
                      background: isSelected ? "var(--brand-600)" : "var(--surface-2)",
                      color: isSelected ? "#fff" : "var(--text-secondary)",
                      borderColor: isSelected ? "var(--brand-400)" : "var(--border)",
                    }}
                    onClick={() => setSelectedDifficulty(d.id)}
                  >
                    <span style={{ fontWeight: 600 }}>{d.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "center" }}>
            <button className="btn btn-primary" onClick={start} style={{ padding: "12px 32px", fontSize: 15, fontWeight: 700 }}>
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
    <div style={S.container}>
      <div style={S.activeQuestionCard}>
        {/* Top Info Bar */}
        <div style={S.questionMetaBar}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span className="badge badge-teal">
              Question {question.questionNumber} of {question.totalQuestions}
            </span>
            <span style={{ fontSize: 12, color: "var(--text-muted)", textTransform: "capitalize" }}>
              Focus: <strong>{question.category}</strong>
            </span>
          </div>

          <div style={S.timerPill}>
            <span style={{ color: "var(--brand-400)", fontSize: 12 }}>⏱</span>
            <span style={{ fontFamily: "monospace", fontSize: 13, fontWeight: 600 }}>
              {formatTime(elapsedSec)}
            </span>
          </div>
        </div>

        {/* Question text */}
        <h3 style={S.questionHeading}>{question.questionText}</h3>

        {/* Interview tip */}
        <div style={S.tipNotice}>
          <span style={{ color: "var(--brand-400)", fontSize: 14 }}>💡</span>
          <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
            Tip: Frame your answer with the problem context, tech constraints, key decisions, and runtime trade-offs.
          </span>
        </div>

        {/* Answer textarea */}
        <div style={{ position: "relative", marginTop: 16 }}>
          <textarea
            style={S.textarea}
            rows={8}
            placeholder="Type your response as if speaking in the interview. Explicitly name files, libraries, and design trade-offs..."
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            disabled={!!feedback || submitting}
          />
          <div style={S.wordCounter}>
            {wordCount} {wordCount === 1 ? "word" : "words"}
          </div>
        </div>

        {/* Actions */}
        <div style={S.actionsRow}>
          {!feedback ? (
            <button
              className="btn btn-primary"
              onClick={submit}
              disabled={!answer.trim() || submitting}
            >
              {submitting ? (
                <>
                  <span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />
                  <span>Evaluating answer...</span>
                </>
              ) : (
                <span>Submit Answer for Review</span>
              )}
            </button>
          ) : (
            <button className="btn btn-primary" onClick={next}>
              {question.questionNumber >= question.totalQuestions ? "View Final Scorecard →" : "Next Question →"}
            </button>
          )}
        </div>

        {/* Feedback Section */}
        {feedback && (
          <div style={S.feedbackBox}>
            <div style={S.feedbackHeader}>
              <span style={{ fontSize: 16 }}>🎯</span>
              <span style={{ fontWeight: 700, fontSize: 15, color: "var(--text-primary)" }}>
                Interviewer Assessment
              </span>
            </div>

            {/* Metric Meters */}
            <div style={S.metricGrid}>
              <ScoreMeter label="Clarity" value={feedback.scores.clarity} />
              <ScoreMeter label="Technical Depth" value={feedback.scores.depth} />
              <ScoreMeter label="Code Specificity" value={feedback.scores.specificity} />
              <ScoreMeter label="Confidence" value={feedback.scores.confidence} />
            </div>

            {/* Qualitative Critique */}
            <div style={S.critiqueBlock}>
              <span style={{ fontWeight: 600, fontSize: 13, color: "var(--brand-200)", display: "block", marginBottom: 4 }}>
                Reviewer Notes:
              </span>
              <p style={{ fontSize: 13, lineHeight: 1.6, color: "var(--text-primary)", margin: 0 }}>
                {feedback.feedback}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ScoreMeter({ label, value }: { label: string; value: number }) {
  const getColor = (v: number) => {
    if (v >= 80) return "var(--green)";
    if (v >= 60) return "var(--brand-400)";
    if (v >= 40) return "var(--amber)";
    return "var(--red)";
  };

  const color = getColor(value);

  return (
    <div style={S.meterWrap}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, fontSize: 12 }}>
        <span style={{ color: "var(--text-secondary)", fontWeight: 500 }}>{label}</span>
        <span style={{ color, fontWeight: 700, fontFamily: "monospace" }}>{value}%</span>
      </div>
      <div style={S.meterTrack}>
        <div
          style={{
            ...S.meterFill,
            width: `${Math.min(100, Math.max(0, value))}%`,
            background: color,
          }}
        />
      </div>
    </div>
  );
}

const S = {
  container: {
    maxWidth: 880,
    margin: "0 auto",
  },
  setupCard: {
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: "var(--r-lg)",
    padding: "36px 32px",
    boxShadow: "var(--shadow-md)",
  },
  heroIcon: {
    width: 60,
    height: 60,
    borderRadius: "var(--r-lg)",
    background: "rgba(13,148,136,0.12)",
    border: "1px solid rgba(13,148,136,0.3)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 32,
    margin: "0 auto 16px",
  },
  heroTitle: {
    fontSize: 24,
    fontWeight: 800,
    color: "var(--text-primary)",
    marginBottom: 8,
  },
  heroSubtitle: {
    fontSize: 14,
    color: "var(--text-secondary)",
    maxWidth: 580,
    margin: "0 auto",
    lineHeight: 1.55,
  },
  fieldLabel: {
    display: "block",
    fontSize: 13,
    fontWeight: 700,
    textTransform: "uppercase" as const,
    letterSpacing: 0.5,
    color: "var(--text-muted)",
    marginBottom: 12,
  },
  personaGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: 12,
  },
  personaCard: {
    padding: "16px",
    borderRadius: "var(--r-md)",
    border: "1px solid",
    cursor: "pointer",
    transition: "all 0.18s ease",
  },
  difficultyRow: {
    display: "flex",
    gap: 12,
  },
  difficultyBtn: {
    flex: 1,
    padding: "12px",
    borderRadius: "var(--r-md)",
    border: "1px solid",
    cursor: "pointer",
    fontSize: 13,
    transition: "all 0.18s ease",
  },
  activeQuestionCard: {
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: "var(--r-lg)",
    padding: "28px 32px",
    boxShadow: "var(--shadow-md)",
  },
  questionMetaBar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  timerPill: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    background: "var(--surface-2)",
    border: "1px solid var(--border)",
    padding: "4px 10px",
    borderRadius: "var(--r-full)",
  },
  questionHeading: {
    fontSize: 20,
    fontWeight: 700,
    color: "var(--text-primary)",
    lineHeight: 1.4,
    marginBottom: 12,
  },
  tipNotice: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    background: "rgba(13,148,136,0.08)",
    border: "1px solid rgba(13,148,136,0.2)",
    borderRadius: "var(--r-md)",
    padding: "8px 12px",
  },
  textarea: {
    width: "100%",
    boxSizing: "border-box" as const,
    background: "var(--surface-2)",
    border: "1px solid var(--border)",
    borderRadius: "var(--r-md)",
    padding: "16px",
    color: "var(--text-primary)",
    fontFamily: "var(--font)",
    fontSize: 14,
    lineHeight: 1.6,
    outline: "none",
    resize: "vertical" as const,
  },
  wordCounter: {
    position: "absolute" as const,
    bottom: 12,
    right: 14,
    fontSize: 11,
    color: "var(--text-muted)",
  },
  actionsRow: {
    display: "flex",
    justifyContent: "flex-end",
    marginTop: 16,
  },
  feedbackBox: {
    marginTop: 24,
    paddingTop: 20,
    borderTop: "1px solid var(--border)",
  },
  feedbackHeader: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginBottom: 16,
  },
  metricGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: 16,
    marginBottom: 20,
  },
  meterWrap: {
    background: "var(--surface-2)",
    padding: "12px",
    borderRadius: "var(--r-md)",
    border: "1px solid var(--border)",
  },
  meterTrack: {
    height: 6,
    background: "rgba(255,255,255,0.08)",
    borderRadius: 3,
    overflow: "hidden",
  },
  meterFill: {
    height: "100%",
    borderRadius: 3,
    transition: "width 0.4s ease",
  },
  critiqueBlock: {
    background: "rgba(13,148,136,0.06)",
    border: "1px solid rgba(13,148,136,0.2)",
    borderRadius: "var(--r-md)",
    padding: "14px 16px",
  },
  reportCard: {
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: "var(--r-lg)",
    padding: "36px 32px",
    boxShadow: "var(--shadow-md)",
  },
  reportHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  reportTitle: {
    fontSize: 24,
    fontWeight: 800,
    color: "var(--text-primary)",
    marginTop: 4,
  },
  overallBadgeWrap: {
    display: "flex",
    alignItems: "center",
    gap: 14,
  },
  scoreCircle: {
    display: "flex",
    alignItems: "baseline",
    gap: 4,
  },
  scoreNumber: {
    fontSize: 36,
    fontWeight: 900,
    color: "var(--brand-400)",
    fontFamily: "monospace",
  },
  scoreSub: {
    fontSize: 14,
    color: "var(--text-muted)",
  },
  divider: {
    border: "none",
    borderTop: "1px solid var(--border)",
    margin: "24px 0",
  },
  grid2: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 16,
  },
  metricCard: {
    background: "var(--surface-2)",
    border: "1px solid var(--border)",
    borderRadius: "var(--r-md)",
    padding: "18px",
  },
  metricCardHeader: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginBottom: 12,
  },
  metricCardTitle: {
    fontWeight: 700,
    fontSize: 14,
    color: "var(--text-primary)",
  },
  metricList: {
    listStyle: "none",
    padding: 0,
    margin: 0,
    display: "flex",
    flexDirection: "column" as const,
    gap: 8,
  },
  metricItem: {
    display: "flex",
    fontSize: 13,
    color: "var(--text-secondary)",
    lineHeight: 1.5,
  },
  sectionHeading: {
    fontSize: 15,
    fontWeight: 700,
    color: "var(--text-primary)",
    marginBottom: 12,
  },
  suggestionBox: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 8,
  },
  recRow: {
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
    background: "var(--surface-2)",
    border: "1px solid var(--border)",
    borderRadius: "var(--r-md)",
    padding: "12px 14px",
  },
  recIcon: {
    fontSize: 16,
  },
} as const;