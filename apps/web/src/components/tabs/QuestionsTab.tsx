"use client";

import { useEffect, useState } from "react";
import { useAuthedFetch } from "@/lib/api";

type Category = "architecture" | "security" | "performance" | "testing" | "data" | "api" | "devops" | "all";
type Difficulty = "junior" | "mid" | "senior" | "all";
type QuestionType = "exploratory" | "adversarial" | "debugging" | "trade-off";

interface Question {
  id?: string;
  category: string;
  difficulty: string;
  type?: QuestionType;
  question: string;
  modelAnswer?: string;
  citations?: { filePath: string; startLine: number; endLine: number }[];
  interviewerTip?: string;
}

interface QuestionsContent {
  categories?: string[];
  questions?: Question[];
}

const CATEGORY_ICON: Record<string, string> = {
  architecture: "🏗️", security: "🔒", performance: "⚡", testing: "🧪",
  data: "🗄️", api: "🔌", devops: "🚀", default: "❓",
};
const TYPE_COLOR: Record<string, string> = {
  exploratory: "badge-blue", adversarial: "badge-red",
  debugging: "badge-amber", "trade-off": "badge-teal",
};
const DIFF_COLOR: Record<string, string> = {
  junior: "badge-green", mid: "badge-amber", senior: "badge-red",
};

export function QuestionsTab({ repoId }: { repoId: string }) {
  const api = useAuthedFetch();
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterCat, setFilterCat] = useState<Category>("all");
  const [filterDiff, setFilterDiff] = useState<Difficulty>("all");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    setLoading(true);
    api.get<QuestionsContent | Question[]>(`/repos/${repoId}/questions`)
      .then((res) => {
        if (Array.isArray(res)) { setQuestions(res); return; }
        const c = res as QuestionsContent;
        setQuestions(c.questions ?? []);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [api, repoId]);

  if (loading) return <LoadingState />;
  if (error) return <EmptyState error={error} />;
  if (questions.length === 0) return <EmptyState />;

  const categories = Array.from(new Set(questions.map((q) => q.category)));
  const filtered = questions.filter((q) => {
    if (filterCat !== "all" && q.category !== filterCat) return false;
    if (filterDiff !== "all" && q.difficulty !== filterDiff) return false;
    if (search && !q.question.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <div>
      {/* Filters */}
      <div style={S.filters}>
        <input
          className="input"
          placeholder="🔍  Search questions…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ flex: 1, minWidth: 200, padding: "8px 12px" }}
        />
        <select
          className="input"
          value={filterCat}
          onChange={(e) => setFilterCat(e.target.value as Category)}
          style={{ width: 160 }}
        >
          <option value="all">All categories</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select
          className="input"
          value={filterDiff}
          onChange={(e) => setFilterDiff(e.target.value as Difficulty)}
          style={{ width: 140 }}
        >
          <option value="all">All levels</option>
          <option value="junior">Junior</option>
          <option value="mid">Mid</option>
          <option value="senior">Senior</option>
        </select>
      </div>

      <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 16 }}>
        Showing {filtered.length} of {questions.length} questions
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {filtered.map((q, i) => {
          const key = q.id ?? `${q.category}-${i}`;
          const isOpen = expanded === key;
          const catIcon = CATEGORY_ICON[q.category] ?? CATEGORY_ICON.default;
          return (
            <div key={key} className="card" style={{ padding: 0, overflow: "hidden" }}>
              <button style={S.qBtn} onClick={() => setExpanded(isOpen ? null : key)}>
                <span style={{ fontSize: 20 }}>{catIcon}</span>
                <div style={{ flex: 1, textAlign: "left" }}>
                  <p style={{ fontSize: 15, fontWeight: 600, color: "var(--text-primary)", lineHeight: 1.4 }}>
                    {q.question}
                  </p>
                </div>
                <div style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
                  {q.type && <span className={`badge ${TYPE_COLOR[q.type] ?? "badge-gray"}`}>{q.type}</span>}
                  <span className={`badge ${DIFF_COLOR[q.difficulty] ?? "badge-gray"}`}>{q.difficulty}</span>
                  <span style={{ color: "var(--text-muted)", fontSize: 16, transform: isOpen ? "rotate(180deg)" : "none", transition: "transform .2s" }}>⌄</span>
                </div>
              </button>

              {isOpen && q.modelAnswer && (
                <div style={S.answer}>
                  <div style={S.answerLabel}>Model answer</div>
                  <p style={S.answerText}>{q.modelAnswer}</p>

                  {q.citations && q.citations.length > 0 && (
                    <div style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {q.citations.map((c, ci) => (
                        <span key={ci} className="citation">
                          📍 {c.filePath}:{c.startLine}-{c.endLine}
                        </span>
                      ))}
                    </div>
                  )}

                  {q.interviewerTip && (
                    <div style={S.tip}>
                      <span style={{ fontWeight: 600, color: "#fbbf24" }}>💡 Interviewer tip: </span>
                      {q.interviewerTip}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function LoadingState() {
  return (
    <div style={{ textAlign: "center", padding: "60px 24px" }}>
      <div className="spinner" style={{ margin: "0 auto 16px" }} />
      <p style={{ color: "var(--text-muted)" }}>Loading question bank…</p>
    </div>
  );
}

function EmptyState({ error }: { error?: string }) {
  return (
    <div className="empty-state">
      <div className="empty-icon">❓</div>
      <h3>Question bank not ready</h3>
      <p>{error ? `Error: ${error}` : "Run analysis to auto-generate interview questions."}</p>
    </div>
  );
}

const S = {
  filters: { display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" as const },
  qBtn: {
    width: "100%",
    background: "none",
    border: "none",
    padding: "14px 18px",
    display: "flex",
    alignItems: "flex-start",
    gap: 12,
    cursor: "pointer",
    textAlign: "left" as const,
  },
  answer: {
    padding: "14px 18px 18px",
    borderTop: "1px solid var(--border)",
    background: "var(--surface-2)",
  },
  answerLabel: {
    fontSize: 11, fontWeight: 700, letterSpacing: ".06em",
    textTransform: "uppercase" as const,
    color: "var(--text-muted)", marginBottom: 8,
  },
  answerText: { fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.7 },
  tip: {
    marginTop: 12,
    background: "rgba(245,158,11,.08)",
    border: "1px solid rgba(245,158,11,.2)",
    borderRadius: 8,
    padding: "10px 14px",
    fontSize: 13,
    color: "#fde68a",
  },
} as const;