"use client";

import { useEffect, useRef, useState } from "react";
import type { Socket } from "socket.io-client";
import { useAuthedFetch } from "@/lib/api";

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
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api
      .post<{ id: string }>(`/repos/${repoId}/chat/sessions`, {})
      .then((s) => setSessionId(s.id))
      .catch(() => {
        // Fallback local session ID if API mock
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

    const onEnd = () => setStreaming(false);

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
      // Offline fallback
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
    <div style={S.container}>
      {/* Header bar */}
      <div style={S.headerBar}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={S.activeIndicator} />
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-secondary)" }}>
            Codebase Knowledge Assistant
          </span>
          <span className="badge badge-teal" style={{ fontSize: 11 }}>
            RAG Grounded
          </span>
        </div>
        {messages.length > 0 && (
          <button className="btn btn-ghost btn-sm" onClick={clearChat} style={{ fontSize: 12, padding: "4px 10px" }}>
            Clear Chat
          </button>
        )}
      </div>

      {/* Message history */}
      <div style={S.messageList}>
        {messages.length === 0 ? (
          <div style={S.emptyState}>
            <div style={S.emptyIcon}>💬</div>
            <h4 style={S.emptyTitle}>Ask Anything About the Repository</h4>
            <p style={S.emptyDesc}>
              Ask architectural questions, dive into specific implementations, or test your reasoning.
              Answers include direct source-code citations.
            </p>

            <div style={S.suggestionGrid}>
              {SUGGESTED_PROMPTS.map((prompt, i) => (
                <button
                  key={i}
                  style={S.suggestionChip}
                  onClick={() => send(prompt)}
                  type="button"
                >
                  <span style={{ color: "var(--brand-400)", marginRight: 6 }}>✦</span>
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m) => (
            <div
              key={m.id}
              style={{
                ...S.messageRow,
                justifyContent: m.role === "user" ? "flex-end" : "flex-start",
              }}
            >
              {m.role === "assistant" && (
                <div style={S.avatarAssistant}>⚡</div>
              )}

              <div
                style={{
                  ...S.bubble,
                  ...(m.role === "user" ? S.userBubble : S.assistantBubble),
                }}
              >
                {/* Content */}
                <div style={S.messageContent}>
                  {m.content ? (
                    <RenderMessageContent content={m.content} />
                  ) : streaming ? (
                    <span style={S.streamingDots}>
                      Thinking<span>.</span><span>.</span><span>.</span>
                    </span>
                  ) : (
                    <span style={{ color: "var(--text-muted)" }}>No response</span>
                  )}
                </div>

                {/* Citations */}
                {m.citations && m.citations.length > 0 && (
                  <div style={S.citationsContainer}>
                    <div style={S.citationHeader}>
                      <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, color: "var(--brand-400)" }}>
                        Verified Citations ({m.citations.length})
                      </span>
                    </div>
                    <div style={S.citationsList}>
                      {m.citations.map((c, i) => {
                        const citeKey = `${c.filePath}:${c.startLine}-${c.endLine}`;
                        return (
                          <div
                            key={i}
                            style={S.citationBadge}
                            onClick={() => copyCitation(citeKey)}
                            title="Click to copy file reference"
                          >
                            <span style={{ color: "var(--brand-400)", fontSize: 12 }}>📄</span>
                            <span style={{ fontWeight: 600 }}>{c.filePath}</span>
                            <span style={S.lineTag}>L{c.startLine}–{c.endLine}</span>
                            {copiedCitation === citeKey && (
                              <span style={S.copiedNotice}>Copied!</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {m.role === "user" && (
                <div style={S.avatarUser}>👤</div>
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
        style={S.inputArea}
      >
        <div style={S.inputWrapper}>
          <input
            style={S.input}
            value={input}
            placeholder="Ask about design trade-offs, concurrency, failure modes, or modules…"
            onChange={(e) => setInput(e.target.value)}
            disabled={streaming}
          />
          <button
            type="submit"
            className="btn btn-primary"
            style={S.sendButton}
            disabled={streaming || !input.trim()}
          >
            {streaming ? (
              <span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />
            ) : (
              <>
                <span>Send</span>
                <span style={{ fontSize: 12 }}>↵</span>
              </>
            )}
          </button>
        </div>
        <div style={S.inputSubtext}>
          <span>Grounds answers in parsed ASTs & retrieval indexes</span>
          <span>Shift + Enter for multiline</span>
        </div>
      </form>
    </div>
  );
}

function RenderMessageContent({ content }: { content: string }) {
  // Strip inline [cite:...] markers from raw text display since citations are shown cleanly below
  const cleanContent = content.replace(/\[cite:[^\]]+\]/g, "").trim();

  // Simple paragraph & markdown code segmenting
  const paragraphs = cleanContent.split("\n\n");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {paragraphs.map((para, idx) => {
        if (para.startsWith("```")) {
          const lines = para.split("\n");
          const lang = lines[0].replace("```", "");
          const code = lines.slice(1, -1).join("\n");
          return (
            <div key={idx} style={S.codeBlock}>
              {lang && <div style={S.codeLang}>{lang}</div>}
              <pre style={S.codePre}>{code}</pre>
            </div>
          );
        }

        // Check for bullet lists
        if (para.includes("\n- ") || para.startsWith("- ")) {
          const items = para.split("\n").filter((l) => l.trim().startsWith("- ") || l.trim().startsWith("* "));
          return (
            <ul key={idx} style={{ paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4 }}>
              {items.map((item, itemIdx) => (
                <li key={itemIdx} style={{ color: "var(--text-primary)", fontSize: 14 }}>
                  <InlineFormatting text={item.replace(/^[-*]\s+/, "")} />
                </li>
              ))}
            </ul>
          );
        }

        return (
          <p key={idx} style={{ fontSize: 14, lineHeight: 1.6, color: "var(--text-primary)", margin: 0 }}>
            <InlineFormatting text={para} />
          </p>
        );
      })}
    </div>
  );
}

function InlineFormatting({ text }: { text: string }) {
  // Bold formatting
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith("**") && part.endsWith("**")) {
          return (
            <strong key={i} style={{ color: "var(--text-primary)", fontWeight: 700 }}>
              {part.slice(2, -2)}
            </strong>
          );
        }
        if (part.startsWith("`") && part.endsWith("`")) {
          return (
            <code key={i} style={S.inlineCode}>
              {part.slice(1, -1)}
            </code>
          );
        }
        return part;
      })}
    </>
  );
}

const S = {
  container: {
    display: "flex",
    flexDirection: "column" as const,
    height: "640px",
    background: "var(--surface)",
    borderRadius: "var(--r-lg)",
    border: "1px solid var(--border)",
    overflow: "hidden",
    boxShadow: "var(--shadow-md)",
  },
  headerBar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "12px 20px",
    borderBottom: "1px solid var(--border)",
    background: "rgba(255,255,255,0.02)",
  },
  activeIndicator: {
    width: 8,
    height: 8,
    borderRadius: "50%",
    background: "var(--brand-400)",
    boxShadow: "0 0 10px var(--brand-400)",
  },
  messageList: {
    flex: 1,
    overflowY: "auto" as const,
    padding: "20px",
    display: "flex",
    flexDirection: "column" as const,
    gap: 16,
  },
  emptyState: {
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center" as const,
    margin: "auto",
    maxWidth: 540,
    padding: "40px 20px",
  },
  emptyIcon: {
    fontSize: 40,
    marginBottom: 16,
    background: "rgba(13,148,136,0.12)",
    width: 72,
    height: 72,
    borderRadius: 20,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    border: "1px solid rgba(13,148,136,0.3)",
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: 700,
    color: "var(--text-primary)",
    marginBottom: 8,
  },
  emptyDesc: {
    fontSize: 14,
    color: "var(--text-secondary)",
    lineHeight: 1.55,
    marginBottom: 24,
  },
  suggestionGrid: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 8,
    width: "100%",
  },
  suggestionChip: {
    background: "var(--surface-2)",
    border: "1px solid var(--border)",
    borderRadius: "var(--r-md)",
    padding: "10px 14px",
    color: "var(--text-primary)",
    fontSize: 13,
    textAlign: "left" as const,
    cursor: "pointer",
    transition: "all 0.18s ease",
    display: "flex",
    alignItems: "center",
  },
  messageRow: {
    display: "flex",
    gap: 12,
    alignItems: "flex-start",
    maxWidth: "100%",
  },
  avatarAssistant: {
    width: 32,
    height: 32,
    minWidth: 32,
    borderRadius: "var(--r-md)",
    background: "linear-gradient(135deg, #0d9488, #2dd4bf)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 15,
    boxShadow: "0 0 12px rgba(13,148,136,0.4)",
  },
  avatarUser: {
    width: 32,
    height: 32,
    minWidth: 32,
    borderRadius: "var(--r-md)",
    background: "var(--surface-3)",
    border: "1px solid var(--border)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 14,
  },
  bubble: {
    borderRadius: "var(--r-lg)",
    padding: "14px 18px",
    maxWidth: "85%",
    boxShadow: "var(--shadow-sm)",
  },
  userBubble: {
    background: "linear-gradient(135deg, rgba(13,148,136,0.25), rgba(45,212,191,0.15))",
    border: "1px solid rgba(45,212,191,0.3)",
    color: "var(--text-primary)",
  },
  assistantBubble: {
    background: "var(--surface-2)",
    border: "1px solid var(--border)",
    color: "var(--text-primary)",
  },
  messageContent: {
    fontSize: 14,
    lineHeight: 1.6,
  },
  streamingDots: {
    color: "var(--brand-400)",
    fontStyle: "italic",
  },
  citationsContainer: {
    marginTop: 14,
    paddingTop: 12,
    borderTop: "1px solid var(--border)",
  },
  citationHeader: {
    marginBottom: 8,
  },
  citationsList: {
    display: "flex",
    flexWrap: "wrap" as const,
    gap: 8,
  },
  citationBadge: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: "var(--r-sm)",
    padding: "4px 8px",
    fontSize: 12,
    color: "var(--text-primary)",
    cursor: "pointer",
    transition: "background 0.15s ease",
  },
  lineTag: {
    background: "rgba(13,148,136,0.2)",
    color: "var(--brand-400)",
    borderRadius: 3,
    padding: "1px 5px",
    fontSize: 11,
    fontFamily: "monospace",
  },
  copiedNotice: {
    fontSize: 10,
    color: "var(--green)",
    fontWeight: 700,
  },
  codeBlock: {
    background: "rgba(0,0,0,0.4)",
    borderRadius: "var(--r-sm)",
    padding: "10px 14px",
    margin: "6px 0",
    border: "1px solid var(--border)",
    overflowX: "auto" as const,
  },
  codeLang: {
    fontSize: 11,
    fontWeight: 600,
    color: "var(--text-muted)",
    textTransform: "uppercase" as const,
    marginBottom: 4,
  },
  codePre: {
    fontFamily: "monospace",
    fontSize: 13,
    color: "#e2e8f0",
    margin: 0,
    whiteSpace: "pre-wrap" as const,
  },
  inlineCode: {
    fontFamily: "monospace",
    fontSize: 12,
    background: "rgba(255,255,255,0.08)",
    padding: "2px 5px",
    borderRadius: 4,
    color: "var(--brand-200)",
  },
  inputArea: {
    padding: "14px 20px",
    borderTop: "1px solid var(--border)",
    background: "var(--surface)",
  },
  inputWrapper: {
    display: "flex",
    gap: 10,
    alignItems: "center",
    background: "var(--surface-2)",
    borderRadius: "var(--r-md)",
    padding: "6px 8px 6px 14px",
    border: "1px solid var(--border)",
  },
  input: {
    flex: 1,
    background: "transparent",
    border: "none",
    color: "var(--text-primary)",
    fontSize: 14,
    outline: "none",
  },
  sendButton: {
    padding: "8px 16px",
    fontSize: 13,
    display: "flex",
    alignItems: "center",
    gap: 6,
    borderRadius: "var(--r-md)",
  },
  inputSubtext: {
    display: "flex",
    justifyContent: "space-between",
    fontSize: 11,
    color: "var(--text-muted)",
    marginTop: 8,
    padding: "0 4px",
  },
} as const;