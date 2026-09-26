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

/**
 * A Q&A list already has its structure in the content (question, answer), so
 * questions render as a divided list that expands in place — no cards, no
 * per-question borders. Difficulty is a small text tag; the answer cites its
 * files in plain monospace text.
 */
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
    <div className="max-w-3xl">
      <h2 className="text-2xl font-display text-white mb-1">Question bank</h2>
      <p className="text-lab-textMuted text-sm mt-2 mb-6">
        {filtered.length === questions.length
          ? `${questions.length} questions an interviewer would ask about this codebase.`
          : `Showing ${filtered.length} of ${questions.length} questions.`}
      </p>

      {/* Filters — inline, no boxed toolbar */}
      <div className="flex flex-wrap gap-2 mb-4">
        <input
          className="flex-1 min-w-[200px] input"
          placeholder="Search questions…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="input"
          value={filterCat}
          onChange={(e) => setFilterCat(e.target.value as Category)}
        >
          <option value="all">All categories</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select
          className="input"
          value={filterDiff}
          onChange={(e) => setFilterDiff(e.target.value as Difficulty)}
        >
          <option value="all">All levels</option>
          <option value="junior">Junior</option>
          <option value="mid">Mid</option>
          <option value="senior">Senior</option>
        </select>
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-lab-textMuted py-8">No questions match those filters.</p>
      ) : (
        <div className="divide-y divide-lab-border">
          {filtered.map((q, i) => {
            const key = q.id ?? `${q.category}-${i}`;
            const isOpen = expanded === key;
            return (
              <div key={key} className="py-4">
                <button
                  className="w-full flex items-start gap-3 text-left"
                  onClick={() => setExpanded(isOpen ? null : key)}
                  aria-expanded={isOpen}
                >
                  <span className="flex-1 font-medium text-white leading-snug">{q.question}</span>
                  <span className="hidden sm:inline text-[11px] font-mono text-lab-dim shrink-0 pt-1">
                    {q.difficulty}
                  </span>
                  <ChevronDown
                    className={`w-4 h-4 shrink-0 text-lab-dim transition-transform ${isOpen ? "rotate-180" : ""}`}
                  />
                </button>

                {isOpen && (
                  <div className="mt-3 space-y-4">
                    {q.modelAnswer && (
                      <p className="text-sm text-lab-textMuted leading-relaxed whitespace-pre-wrap">
                        {q.modelAnswer}
                      </p>
                    )}

                    {q.citations && q.citations.length > 0 && (
                      <p className="text-xs font-mono text-lab-dim">
                        Grounded in{" "}
                        {q.citations.map((c, ci) => (
                          <span key={ci}>
                            {ci > 0 && ", "}
                            <span className="text-lab-blue">{c.filePath}:{c.startLine}–{c.endLine}</span>
                          </span>
                        ))}
                      </p>
                    )}

                    {q.interviewerTip && (
                      <p className="text-sm text-amber-300/90 leading-relaxed">
                        <span className="font-semibold">Interviewer tip: </span>
                        {q.interviewerTip}
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex items-center justify-center h-64 text-lab-textMuted">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-2 border-lab-blue border-t-transparent rounded-full animate-spin" />
        <p>Choosing the questions an interviewer would actually ask…</p>
      </div>
    </div>
  );
}

function EmptyState({ error }: { error?: string }) {
  return (
    <div className="max-w-3xl py-16 text-center">
      <div className="text-4xl mb-2">❓</div>
      <h3 className="text-white font-semibold mb-1">
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
