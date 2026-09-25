"use client";

import { useMemo } from "react";
import type { ConnectionKind, Connections } from "@/lib/fileConnections";

/**
 * Connected-files panel for the File Graph tab (PRD-G02): the selected file
 * at the center, its connected files around it, colored by relationship.
 *
 * Deliberately effect-free: layout is a pure function of `connections`
 * (deterministic rings — no d3-force simulation, no ResizeObserver), so
 * re-renders can never tick, reflow, or flash (the flicker lessons in
 * TRD-F01/F02).
 */

const KIND_COLOR: Record<ConnectionKind, string> = {
  import: "#3b82f6",
  "imported-by": "#a78bfa",
  test: "#f59e0b",
  sibling: "#64748b",
  related: "#22c55e",
};

const KIND_LABEL: Record<ConnectionKind, string> = {
  import: "imports",
  "imported-by": "imported by",
  test: "test pair",
  sibling: "same dir",
  related: "same name",
};

const VIEW_W = 760;
const VIEW_H = 340;
const CX = VIEW_W / 2;
const CY = VIEW_H / 2;
const RING1 = 96;
const RING2 = 156;
const RING1_CAP = 12;

function truncate(label: string, max = 18): string {
  return label.length > max ? `${label.slice(0, max - 1)}…` : label;
}

export interface FileConnectionsGraphProps {
  connections: Connections;
  onSelect: (path: string) => void;
}

export function FileConnectionsGraph({ connections, onSelect }: FileConnectionsGraphProps) {
  const { selected, nodes, links } = connections;

  const layout = useMemo(() => {
    const ring1 = nodes.slice(0, RING1_CAP);
    const ring2 = nodes.slice(RING1_CAP);
    const place = (count: number, radius: number, offset: number) =>
      Array.from({ length: count }, (_, i) => {
        const angle = -Math.PI / 2 + (2 * Math.PI * (i + offset)) / count;
        return { x: CX + radius * Math.cos(angle), y: CY + radius * Math.sin(angle) };
      });
    const pos1 = place(ring1.length, RING1, 0);
    // Offset ring2 between ring1 spokes so labels never stack radially.
    const pos2 = place(ring2.length, RING2, ring1.length > 0 ? 0.5 : 0);
    const byPath = new Map<string, { x: number; y: number }>();
    ring1.forEach((n, i) => byPath.set(n.path, pos1[i]));
    ring2.forEach((n, i) => byPath.set(n.path, pos2[i]));
    return byPath;
  }, [nodes]);

  const presentKinds = useMemo(() => {
    const set = new Set<ConnectionKind>(links.map((l) => l.relation));
    return (["import", "imported-by", "test", "sibling", "related"] as ConnectionKind[]).filter(
      (k) => set.has(k)
    );
  }, [links]);

  if (nodes.length === 0) {
    return (
      <p className="text-[11px] text-lab-textMuted py-4 text-center" data-testid="connections-empty">
        No connected files found for this file.
      </p>
    );
  }

  const centerName = selected.split("/").pop() ?? selected;

  return (
    <div>
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        className="w-full h-auto"
        role="img"
        aria-label={`Connected files graph for ${selected}`}
        data-testid="connections-graph"
      >
        <defs>
          <marker
            id="fcg-arrow-import"
            viewBox="0 0 10 10"
            refX="10"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto"
          >
            <path d="M0,0 L10,5 L0,10 z" fill={KIND_COLOR.import} />
          </marker>
          <marker
            id="fcg-arrow-imported-by"
            viewBox="0 0 10 10"
            refX="10"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto"
          >
            <path d="M0,0 L10,5 L0,10 z" fill={KIND_COLOR["imported-by"]} />
          </marker>
        </defs>

        {/* Edges: arrows for import direction, dashes for structural links. */}
        {links.map((link) => {
          const pos = layout.get(link.target);
          if (!pos) return null;
          const color = KIND_COLOR[link.relation];
          const structural = link.relation === "sibling" || link.relation === "related";
          // "import" = center imports target (arrow points out);
          // "imported-by" = target imports center (arrow points in).
          const pointsIn = link.relation === "imported-by";
          const marker =
            link.relation === "import"
              ? "url(#fcg-arrow-import)"
              : pointsIn
                ? "url(#fcg-arrow-imported-by)"
                : undefined;
          return (
            <line
              key={`${link.source}->${link.target}`}
              x1={pointsIn ? pos.x : CX}
              y1={pointsIn ? pos.y : CY}
              x2={pointsIn ? CX : pos.x}
              y2={pointsIn ? CY : pos.y}
              stroke={color}
              strokeWidth={structural ? 1 : 1.6}
              strokeDasharray={structural ? "3 4" : undefined}
              opacity={structural ? 0.45 : 0.75}
              markerEnd={marker}
            />
          );
        })}

        {/* Center: selected file. */}
        <g data-testid="connections-center">
          <circle cx={CX} cy={CY} r={13} fill="#111827" stroke={KIND_COLOR.import} strokeWidth={2.5} />
          <text
            x={CX}
            y={CY + 30}
            textAnchor="middle"
            fontSize={12}
            fontWeight={700}
            fill="#e2e8f0"
            fontFamily="ui-monospace, monospace"
          >
            {truncate(centerName, 24)}
          </text>
        </g>

        {/* Ring nodes: click to navigate to that file. */}
        {nodes.map((node) => {
          const pos = layout.get(node.path);
          if (!pos) return null;
          const color = KIND_COLOR[node.relation];
          return (
            <g
              key={node.path}
              role="button"
              aria-label={`connection ${node.path}`}
              data-testid="connection-node"
              data-path={node.path}
              onClick={() => onSelect(node.path)}
              style={{ cursor: "pointer" }}
            >
              <title>{`${node.path} — ${KIND_LABEL[node.relation]}`}</title>
              <circle cx={pos.x} cy={pos.y} r={7.5} fill="#0b1220" stroke={color} strokeWidth={2} />
              <text
                x={pos.x}
                y={pos.y + 21}
                textAnchor="middle"
                fontSize={10}
                fill={color}
                fontFamily="ui-monospace, monospace"
              >
                {truncate(node.name)}
              </text>
            </g>
          );
        })}
      </svg>

      {/* Legend — only kinds actually present. */}
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 pt-1">
        {presentKinds.map((kind) => (
          <span key={kind} className="inline-flex items-center gap-1.5 text-[10px] text-lab-textMuted">
            <span
              className="inline-block w-2 h-2 rounded-full"
              style={{ backgroundColor: KIND_COLOR[kind] }}
            />
            {KIND_LABEL[kind]}
          </span>
        ))}
      </div>
    </div>
  );
}
