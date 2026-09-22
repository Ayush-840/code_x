"use client";

import { useEffect, useId, useRef, useState } from "react";
import mermaid from "mermaid";

/**
 * Renders Mermaid diagram syntax into an SVG, themed to match the app's
 * design tokens (replaces the old raw-text <pre> rendering — PRD-G03).
 */
export function MermaidDiagram({ chart }: { chart: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  // useId gives SSR-safe, collision-free ids; mermaid requires a valid id.
  const rawId = useId();
  const renderId = `mermaid-${rawId.replace(/[^a-zA-Z0-9]/g, "")}`;

  useEffect(() => {
    let cancelled = false;

    mermaid.initialize({
      startOnLoad: false,
      theme: "base",
      securityLevel: "strict",
      themeVariables: {
        primaryColor: "#1e2330",
        primaryBorderColor: "#14b8a6",
        primaryTextColor: "#f0f4ff",
        lineColor: "#475569",
        secondaryColor: "#181c24",
        tertiaryColor: "#111318",
        fontFamily: "JetBrains Mono, monospace",
        fontSize: "12px",
      },
    });

    mermaid
      .render(renderId, chart)
      .then(({ svg }) => {
        if (!cancelled && containerRef.current) {
          containerRef.current.innerHTML = svg;
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Diagram failed to render");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [chart, renderId]);

  if (error) {
    // Graceful fallback: show the raw syntax rather than a broken diagram.
    return (
      <div>
        <div className="empty-state" style={{ padding: "16px", marginBottom: 12 }}>
          <p style={{ color: "var(--text-muted)", fontSize: 13 }}>
            Diagram couldn't be rendered — showing the raw definition.
          </p>
        </div>
        <pre className="code-block" style={{ fontSize: 12 }}>{chart}</pre>
      </div>
    );
  }

  return <div ref={containerRef} className="mermaid-container" aria-label="Architecture diagram" />;
}
