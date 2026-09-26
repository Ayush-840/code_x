"use client";

import { useEffect, useState } from "react";
import { useAuthedFetch } from "@/lib/api";
import { ChevronDown } from "lucide-react";

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
  exploratory: "bg-blue-500/20 text-blue-400 border-blue-500/30", adversarial: "bg-red-500/20 text-red-400 border-red-500/30",
  debugging: "bg-amber-500/20 text-amber-400 border-amber-500/30", "trade-off": "bg-teal-500/20 text-teal-400 border-teal-500/30",
};
const DIFF_COLOR: Record<string, string> = {
  junior: "bg-green-500/20 text-green-400 border-green-500/30", mid: "bg-amber-500/20 text-amber-400 border-amber-500/30", senior: "bg-red-500/20 text-red-400 border-red-500/30",
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
    <div className="space-y-6">
      {/* Header */}
      <div>
        <p className="section-label">03 // QUESTIONS</p>
        <h2 className="section-title">Interview Question Bank</h2>
      </div>

      {/* Filters */}
      <div className="panel p-4 flex flex-wrap gap-3">
        <input
          className="flex-1 min-w-[200px] px-3 py-2 rounded-lg bg-lab-card border border-lab-border text-white placeholder-lab-dim text-sm font-mono focus:outline-none focus:ring-2 focus:ring-lab-blue/40 focus:border-transparent"
          placeholder="Search questions…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="px-3 py-2 rounded-lg bg-lab-card border border-lab-border text-white text-sm font-mono focus:outline-none focus:ring-2 focus:ring-lab-blue/40 focus:border-transparent"
          value={filterCat}
          onChange={(e) => setFilterCat(e.target.value as Category)}
        >
          <option value="all">All categories</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select
          className="px-3 py-2 rounded-lg bg-lab-card border border-lab-border text-white text-sm font-mono focus:outline-none focus:ring-2 focus:ring-lab-blue/40 focus:border-transparent"
          value={filterDiff}
          onChange={(e) => setFilterDiff(e.target.value as Difficulty)}
        >
          <option value="all">All levels</option>
          <option value="junior">Junior</option>
          <option value="mid">Mid</option>
          <option value="senior">Senior</option>
        </select>
      </div>

      <p className="text-sm text-lab-textMuted">
        {filtered.length === questions.length
          ? `${questions.length} question${questions.length !== 1 ? "s" : ""} — filter or search to narrow them down`
          : `Showing ${filtered.length} of ${questions.length} questions`}
      </p>

      <div className="panel space-y-3">
        {filtered.map((q, i) => {
          const key = q.id ?? `${q.category}-${i}`;
          const isOpen = expanded === key;
          const catIcon = CATEGORY_ICON[q.category] ?? CATEGORY_ICON.default;
          return (
            <div key={key} className="bg-lab-card border border-lab-border rounded-lg overflow-hidden">
              <button
                className="w-full flex items-start gap-3 px-4 py-4 text-left hover:bg-lab-blue/5 transition-colors"
                onClick={() => setExpanded(isOpen ? null : key)}
              >
                <span className="text-2xl shrink-0 mt-0.5">{catIcon}</span>
                <div className="flex-1 text-left">
                  <p className="font-semibold text-white text-base leading-snug">{q.question}</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {q.type && (
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono border ${TYPE_COLOR[q.type] ?? "bg-gray-500/20 text-gray-400 border-gray-500/30"}`}>
                      {q.type}
                    </span>
                  )}
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono border ${DIFF_COLOR[q.difficulty] ?? "bg-gray-500/20 text-gray-400 border-gray-500/30"}`}>
                    {q.difficulty}
                  </span>
                  <ChevronDown
                    className={`w-5 h-5 text-lab-textMuted transition-transform shrink-0 ${isOpen ? "rotate-180" : ""}`}
                  />
                </div>
              </button>

              {isOpen && q.modelAnswer && (
                <div className="border-t border-lab-border px-4 pb-4 pt-4 space-y-4">
                  <p className="text-xs font-mono uppercase tracking-wider text-lab-textMuted mb-2">Model answer</p>
                  <p className="text-sm text-lab-textMuted leading-relaxed whitespace-pre-wrap">{q.modelAnswer}</p>

                  {q.citations && q.citations.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      <span className="text-[10px] text-lab-dim uppercase tracking-wider self-center">Grounded in:</span>
                      {q.citations.map((c, ci) => (
                        <span key={ci} className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono bg-lab-blueDim text-lab-blue border border-lab-blue/30">
                          <span className="w-1 h-1 rounded-full bg-lab-blue shrink-0" />
                          {c.filePath}:{c.startLine}–{c.endLine}
                        </span>
                      ))}
                    </div>
                  )}

                  {q.interviewerTip && (
                    <div className="px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20">
                      <p className="text-sm text-amber-300 leading-relaxed">
                        <span className="font-semibold">💡 Interviewer tip: </span>
                        {q.interviewerTip}
                      </p>
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
    <div className="panel flex items-center justify-center h-64">
      <div className="flex flex-col items-center gap-3 text-lab-textMuted">
        <div className="w-8 h-8 border-2 border-lab-blue border-t-transparent rounded-full animate-spin" />
        <p>Choosing the questions an interviewer would actually ask…</p>
      </div>
    </div>
  );
}

function EmptyState({ error }: { error?: string }) {
  return (
    <div className="panel text-center py-12">
      <div className="text-4xl mb-2">❓</div>
      <h3 className="text-lab-text font-semibold mb-1">
        {error ? "We hit a snag loading the question bank" : "Question bank not ready yet"}
      </h3>
      <p className="text-lab-textMuted text-sm max-w-md mx-auto">
        {error
          ? `${error} — a refresh usually does it. If not, re-run the analysis.`
          : "Once the analysis finishes, we'll build you a question bank grounded in this exact codebase — with model answers and interviewer tips."}
      </p>
    </div>
  );
}