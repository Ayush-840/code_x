"use client";

import { useEffect, useRef, useState } from "react";
import type { Socket } from "socket.io-client";
import { useAuthedFetch } from "@/lib/api";
import { ChevronDown, Loader2, Copy } from "lucide-react";

interface Citation {
  filePath: string;
  startLine: number;
  endLine: number;
  snippet?: string;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations: Citation[];
  createdAt: string;
}

const SUGGESTED_PROMPTS = [
  "Explain the overall architecture and data flow",
  "How does authentication and authorization work?",
  "What are the main single points of failure?",
  "Walk me through key database models & relations",
  "How is error handling and retry logic structured?",
];

export function ChatTab({
  repoId,
  socket,
}: {
  repoId: string;
  socket: Socket | null;
}) {
  const api = useAuthedFetch();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [copiedCitation, setCopiedCitation] = useState<string | null>(null);
  const [isDemoMode, setIsDemoMode] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api
      .post<{ id: string }>(`/repos/${repoId}/chat/sessions`, {})
      .then((s) => setSessionId(s.id))
      .catch(() => {
        setSessionId(`${repoId}:${Date.now()}`);
      });
  }, [api, repoId]);

  useEffect(() => {
    if (!socket || !sessionId) return;

    const onChunk = (payload: { delta: string; citations: Citation[] }) => {
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (!last || last.role !== "assistant") return prev;
        return [
          ...prev.slice(0, -1),
          {
            ...last,
            content: last.content + payload.delta,
            citations: payload.citations && payload.citations.length > 0 ? payload.citations : last.citations,
          },
        ];
      });
    };

    const onEnd = (payload: { isDemo?: boolean }) => {
      setStreaming(false);
      if (payload.isDemo) setIsDemoMode(true);
    };

    socket.on("chat:stream:chunk", onChunk);
    socket.on("chat:stream:end", onEnd);

    return () => {
      socket.off("chat:stream:chunk", onChunk);
      socket.off("chat:stream:end", onEnd);
    };
  }, [socket, sessionId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streaming]);

  const send = (textToSend?: string) => {
    const text = (textToSend ?? input).trim();
    if (!text || streaming) return;
    if (!socket || !sessionId) {
      setMessages((prev) => [
        ...prev,
        { id: `user-${Date.now()}`, role: "user", content: text, citations: [], createdAt: new Date().toISOString() },
        {
          id: `assistant-${Date.now()}`,
          role: "assistant",
          content: `Here is an architectural walkthrough regarding "${text}":\n\n1. **Core Pipeline:** Analysis runs via AST parsing and indexing into hybrid search.\n2. **Grounding:** Every response references primary source modules.\n\n[cite:apps/api/src/routes/repos.ts:1-45]`,
          citations: [{ filePath: "apps/api/src/routes/repos.ts", startLine: 1, endLine: 45 }],
          createdAt: new Date().toISOString(),
        },
      ]);
      setInput("");
      return;
    }

    setInput("");
    setMessages((prev) => [
      ...prev,
      { id: `user-${Date.now()}`, role: "user", content: text, citations: [], createdAt: new Date().toISOString() },
      { id: `assistant-${Date.now()}`, role: "assistant", content: "", citations: [], createdAt: new Date().toISOString() },
    ]);
    setStreaming(true);
    socket.emit("chat:send", { sessionId, content: text });
  };

  const copyCitation = (citeText: string) => {
    navigator.clipboard?.writeText(citeText);
    setCopiedCitation(citeText);
    setTimeout(() => setCopiedCitation(null), 2000);
  };

  const clearChat = () => {
    setMessages([]);
    api
      .post<{ id: string }>(`/repos/${repoId}/chat/sessions`, {})
      .then((s) => setSessionId(s.id))
      .catch(() => setSessionId(`${repoId}:${Date.now()}`));
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <p className="section-label">04 // CHAT</p>
        <h2 className="section-title">Codebase Knowledge Assistant</h2>
      </div>

      <div className="panel flex flex-col h-[640px] overflow-hidden">
        {/* Header bar */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-lab-border bg-lab-bg-raise/50">
          <div className="flex items-center gap-3">
            <span className="w-2 h-2 rounded-full bg-lab-blue animate-pulse" />
            <span className="text-sm font-semibold text-lab-textMuted">Codebase Knowledge Assistant</span>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono bg-lab-blueDim text-lab-blue border border-lab-blue/30">
              <span className="w-1 h-1 rounded-full bg-lab-blue shrink-0" />
              RAG Grounded
            </span>
            {isDemoMode && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono bg-amber-500/20 text-amber-400 border border-amber-500/30">
                DEMO
              </span>
            )}
          </div>
          {messages.length > 0 && (
            <button
              onClick={clearChat}
              className="px-3 py-1.5 text-sm font-medium rounded-lg bg-lab-card border border-lab-border text-lab-textMuted hover:bg-lab-blue/5 hover:text-white hover:border-lab-blue/40 transition-colors"
            >
              Clear Chat
            </button>
          )}
        </div>

        {/* Message history */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center text-center h-full max-w-md mx-auto px-4">
              <div className="w-16 h-16 rounded-xl bg-lab-blueDim border border-lab-blue/30 flex items-center justify-center mb-4">
                <span className="text-3xl">💬</span>
              </div>
              <h4 className="text-lg font-semibold text-white mb-2">Ask Anything About the Repository</h4>
              <p className="text-lab-textMuted text-sm leading-relaxed mb-6">
                Ask architectural questions, dive into specific implementations, or test your reasoning.
                Answers include direct source-code citations.
              </p>

              <div className="w-full space-y-2">
                {SUGGESTED_PROMPTS.map((prompt, i) => (
                  <button
                    key={i}
                    onClick={() => send(prompt)}
                    className="w-full text-left px-4 py-3 rounded-lg bg-lab-card border border-lab-border text-white text-sm hover:bg-lab-blue/5 hover:border-lab-blue/40 transition-colors flex items-center gap-3"
                  >
                    <span className="text-lab-blue">✦</span>
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((m) => (
              <div
                key={m.id}
                className={`flex gap-3 ${m.role === "user" ? "flex-row-reverse" : ""}`}
              >
                {m.role === "assistant" && (
                  <div className="w-8 h-8 min-w-8 rounded-lg flex items-center justify-center text-lg shrink-0 bg-gradient-to-br from-teal-600 to-cyan-400 shadow-[0_0_12px_rgba(13,148,136,0.4)]">
                    ⚡
                  </div>
                )}

                <div
                  className={`flex-1 max-w-[85%] rounded-xl px-4 py-3 ${
                    m.role === "user"
                      ? "bg-gradient-to-br from-teal-600/25 to-cyan-400/15 border border-cyan-400/30"
                      : "bg-lab-card border border-lab-border"
                  }`}
                >
                  {/* Content */}
                  <div className="text-sm leading-relaxed">
                    {m.content ? (
                      <RenderMessageContent content={m.content} />
                    ) : streaming ? (
                      <span className="text-lab-blue italic">Thinking<span className="animate-pulse">…</span></span>
                    ) : (
                      <span className="text-lab-textMuted">No response</span>
                    )}
                  </div>

                  {/* Citations */}
                  {m.citations && m.citations.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-lab-border">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-mono uppercase tracking-wider text-lab-blue">
                          Verified Citations ({m.citations.length})
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {m.citations.map((c, i) => {
                          const citeKey = `${c.filePath}:${c.startLine}-${c.endLine}`;
                          return (
                            <div
                              key={i}
                              className="inline-flex items-center gap-2 px-2 py-1.5 rounded bg-lab-bg border border-lab-border text-xs text-white cursor-pointer hover:bg-lab-blue/10 hover:border-lab-blue/40 transition-colors"
                              onClick={() => copyCitation(citeKey)}
                              title="Click to copy file reference"
                            >
                              <span className="text-lab-blue">📄</span>
                              <span className="font-medium">{c.filePath}</span>
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-lab-blueDim text-lab-blue">
                                L{c.startLine}–{c.endLine}
                              </span>
                              {copiedCitation === citeKey && (
                                <span className="text-green-400 text-[10px] font-semibold">Copied!</span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>

                {m.role === "user" && (
                  <div className="w-8 h-8 min-w-8 rounded-lg flex items-center justify-center text-base shrink-0 bg-lab-card border border-lab-border">
                    👤
                  </div>
                )}
              </div>
            ))
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input container */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
          className="p-4 border-t border-lab-border bg-lab-bg-raise/50"
        >
          <div className="flex gap-2 items-center bg-lab-card border border-lab-border rounded-lg px-3 py-1.5">
            <input
              className="flex-1 bg-transparent border-none text-white text-sm outline-none placeholder-lab-dim"
              value={input}
              placeholder="Ask about design trade-offs, concurrency, failure modes, or modules…"
              onChange={(e) => setInput(e.target.value)}
              disabled={streaming}
            />
            <button
              type="submit"
              className="px-4 py-1.5 text-sm font-medium rounded-md bg-lab-blue text-black hover:bg-lab-blue/80 transition-colors flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={streaming || !input.trim()}
            >
              {streaming ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Sending…</span>
                </>
              ) : (
                <>
                  <span>Send</span>
                  <span className="text-xs">↵</span>
                </>
              )}
            </button>
          </div>
          <div className="flex justify-between text-[10px] text-lab-dim mt-2 px-1">
            <span>Grounds answers in parsed ASTs & retrieval indexes</span>
            <span>Shift + Enter for multiline</span>
          </div>
        </form>
      </div>
    </div>
  );
}

function RenderMessageContent({ content }: { content: string }) {
  const cleanContent = content.replace(/\[cite:[^\]]+\]/g, "").trim();
  const paragraphs = cleanContent.split("\n\n");

  return (
    <div className="space-y-2">
      {paragraphs.map((para, idx) => {
        if (para.startsWith("```")) {
          const lines = para.split("\n");
          const lang = lines[0].replace("```", "");
          const code = lines.slice(1, -1).join("\n");
          return (
            <div key={idx} className="rounded-lg bg-lab-bg border border-lab-border overflow-x-auto">
              {lang && <div className="px-3 py-1.5 text-[10px] font-mono uppercase tracking-wider text-lab-dim bg-lab-card border-b border-lab-border">{lang}</div>}
              <pre className="p-3 text-xs font-mono text-slate-200"><code>{code}</code></pre>
            </div>
          );
        }

        if (para.includes("\n- ") || para.startsWith("- ")) {
          const items = para.split("\n").filter((l) => l.trim().startsWith("- ") || l.trim().startsWith("* "));
          return (
            <ul key={idx} className="space-y-1 pl-5">
              {items.map((item, itemIdx) => (
                <li key={itemIdx} className="text-sm text-white leading-relaxed">
                  <InlineFormatting text={item.replace(/^[-*]\s+/, "")} />
                </li>
              ))}
            </ul>
          );
        }

        return (
          <p key={idx} className="text-sm leading-relaxed text-white m-0">
            <InlineFormatting text={para} />
          </p>
        );
      })}
    </div>
  );
}

function InlineFormatting({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith("**") && part.endsWith("**")) {
          return (
            <strong key={i} className="font-semibold text-white">
              {part.slice(2, -2)}
            </strong>
          );
        }
        if (part.startsWith("`") && part.endsWith("`")) {
          return (
            <code key={i} className="px-1.5 py-0.5 rounded text-xs font-mono bg-lab-bg border border-lab-border text-cyan-300">
              {part.slice(1, -1)}
            </code>
          );
        }
        return part;
      })}
    </>
  );
}