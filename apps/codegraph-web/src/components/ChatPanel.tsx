'use client';

interface ChatPanelProps {
  question: string;
  setQuestion: (q: string) => void;
  answer: string;
  citedNodes: string[];
  loading: boolean;
  onAsk: () => void;
  onCiteClick: (nodeId: string) => void;
}

function shortLabel(nodeId: string): string {
  // "src/app/page.tsx::Home" → "page.tsx · Home"; Class.method stays intact.
  const [file, symbol = ''] = nodeId.split('::');
  const fileName = file.split('/').pop() ?? file;
  return symbol ? `${fileName} · ${symbol}` : fileName;
}

export function ChatPanel({
  question,
  setQuestion,
  answer,
  citedNodes,
  loading,
  onAsk,
  onCiteClick,
}: ChatPanelProps) {
  return (
    <section className="flex flex-col h-full min-h-0">
      <header className="toolbar px-4 py-2.5 shrink-0">
        <h2 className="text-sm font-semibold text-gray-200">Ask the codebase</h2>
      </header>

      <div className="flex-1 overflow-y-auto p-4 min-h-0 space-y-3">
        {!answer && !loading && (
          <p className="text-sm text-gray-500">
            Ask a question about this repo — answers cite the nodes that informed
            them; click a citation to highlight it in the graph.
          </p>
        )}

        {loading && (
          <div className="flex items-center gap-2 text-sm text-gray-400">
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-yellow-500 border-t-transparent" />
            Searching the graph…
          </div>
        )}

        {!loading && answer && (
          <p className="text-sm leading-relaxed text-gray-300 whitespace-pre-wrap">{answer}</p>
        )}

        {!loading && citedNodes.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Cited nodes</p>
            <div className="flex flex-wrap gap-1.5">
              {citedNodes.map((id) => (
                <button
                  key={id}
                  onClick={() => onCiteClick(id)}
                  title={id}
                  className="text-xs font-mono px-2 py-1 rounded border border-gray-700 bg-gray-800 text-green-300 hover:border-green-500/60 hover:bg-gray-750 transition-colors"
                >
                  {shortLabel(id)}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="p-3 border-t border-gray-800 shrink-0">
        <div className="flex gap-2">
          <input
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) onAsk();
            }}
            placeholder="e.g. where is parsing handled?"
            className="input"
            disabled={loading}
          />
          <button
            onClick={onAsk}
            disabled={loading || !question.trim()}
            className="btn btn-primary shrink-0"
          >
            Ask
          </button>
        </div>
      </div>
    </section>
  );
}
