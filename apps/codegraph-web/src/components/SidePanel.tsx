'use client';

import type { GraphNode } from '@/lib/types';

interface SidePanelProps {
  selectedNode: GraphNode | null;
  explanation: string;
}

const TYPE_LABELS: Record<string, string> = {
  module: 'Module',
  class: 'Class',
  function: 'Function',
};

/** Minimal renderer for the backend's markdown-ish explanation text:
 * code fences, bullets, `inline code` and **bold**. */
function ExplanationBody({ text }: { text: string }) {
  if (!text) return null;
  const blocks = text.split(/```/);
  return (
    <div className="space-y-2 text-sm leading-relaxed text-gray-300">
      {blocks.map((block, i) => {
        if (i % 2 === 1) {
          // fenced code block — first line may be a language tag
          const code = block.replace(/^(python|py|ts|tsx|js)?\n/, '');
          return (
            <pre
              key={i}
              className="bg-gray-950 border border-gray-800 rounded-md p-3 overflow-x-auto text-xs font-mono text-green-300"
            >
              {code}
            </pre>
          );
        }
        return (
          <div key={i} className="space-y-1">
            {block
              .split('\n')
              .filter((line) => line.trim().length > 0)
              .map((line, j) => (
                <p key={j} className={line.trimStart().startsWith('-') ? 'pl-3' : ''}>
                  {inlineFormat(line)}
                </p>
              ))}
          </div>
        );
      })}
    </div>
  );
}

function inlineFormat(line: string) {
  // Split on **bold** and `code` tokens, preserving separators.
  const parts = line.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={i} className="text-gray-100">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code key={i} className="bg-gray-800 rounded px-1 py-0.5 text-xs font-mono text-yellow-300">
          {part.slice(1, -1)}
        </code>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

export function SidePanel({ selectedNode, explanation }: SidePanelProps) {
  return (
    <section className="flex flex-col h-full min-h-0">
      <header className="toolbar px-4 py-2.5 flex items-center justify-between shrink-0">
        <h2 className="text-sm font-semibold text-gray-200">Inspector</h2>
        {selectedNode && (
          <span
            className={`text-xs font-medium px-2 py-0.5 rounded-full border ${
              selectedNode.type === 'module'
                ? 'border-blue-500/50 text-blue-300'
                : selectedNode.type === 'class'
                ? 'border-purple-500/50 text-purple-300'
                : 'border-green-500/50 text-green-300'
            }`}
          >
            {TYPE_LABELS[selectedNode.type] ?? selectedNode.type}
          </span>
        )}
      </header>

      <div className="flex-1 overflow-y-auto p-4 min-h-0">
        {!selectedNode ? (
          <p className="text-sm text-gray-500">
            Click a node in the graph to inspect it — its docstring, signature and
            connections show up here.
          </p>
        ) : (
          <div className="space-y-3">
            <div>
              <h3 className="font-mono text-base font-semibold text-gray-100 break-all">
                {selectedNode.name}
              </h3>
              <p className="text-xs text-gray-500 mt-0.5">
                {selectedNode.file}
                {selectedNode.line_start ? `:${selectedNode.line_start}` : ''}
                {selectedNode.line_end && selectedNode.line_end !== selectedNode.line_start
                  ? `–${selectedNode.line_end}`
                  : ''}
              </p>
            </div>

            {explanation ? (
              <ExplanationBody text={explanation} />
            ) : (
              <p className="text-sm text-gray-500">Loading explanation…</p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
