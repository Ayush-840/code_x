/**
 * CodeGraphTab rebuild recovery (the client half of the lazy-rebuild e2e).
 *
 * The API-side test (apps/api/tests/codegraphRebuild.test.ts) proves the
 * backend: missing graph → 202 GRAPH_GENERATING + rebuild enqueue → graph.
 * This test proves the tab's half of the contract: on a 202 it shows the
 * dedicated generating state (not a red error, not a bare "Loading…"), keeps
 * polling on its front-loaded schedule, and renders the graph once the
 * rebuild lands — the "spinning forever with no message" regression.
 */
import { render, screen, act } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { CodeGraphTab } from "@/components/CodeGraphTab";
import type { CodeGraphData } from "@/components/CodeGraphTab";

// react-force-graph-2d is canvas/window-bound and loaded via next/dynamic —
// stand in a passive stub so the graph surface renders in jsdom.
vi.mock("react-force-graph-2d", () => ({
  default: function FakeForceGraph() {
    return <div data-testid="force-graph" />;
  },
}));

// The tab measures its wrapper with ResizeObserver (absent in jsdom).
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(window as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;

const GRAPH: CodeGraphData = {
  nodes: [
    { id: "src/main.py::run", type: "function", file: "src/main.py", name: "run", line_start: 1, line_end: 10 },
  ],
  edges: [],
};

function generating202(): Error {
  // Same shape the API clients throw for a 202 ok:false GRAPH_GENERATING
  // envelope — the tab branches on `status === 202`.
  return Object.assign(new Error("Code graph is being generated"), { status: 202 });
}

describe("CodeGraphTab rebuild recovery (202 → poll → recovers)", () => {
  beforeEach(() => {
    // Fake ONLY the timer APIs the poll schedule uses — the default set also
    // fakes queueMicrotask/rAF, which stalls next/dynamic's import resolution
    // and React's async rendering (both tests hung on it).
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows the generating state (not an error) while the rebuild runs, then renders the graph when it lands", async () => {
    // First fetch: 202 (rebuild scheduled). Later fetches (the poll): graph ready.
    const fetchGraph = vi.fn().mockRejectedValueOnce(generating202()).mockResolvedValue(GRAPH);
    const explainNode = vi.fn().mockResolvedValue({ explanation: "" });
    const ask = vi.fn().mockResolvedValue({ answer: "", cited_nodes: [] });

    render(<CodeGraphTab fetchGraph={fetchGraph} explainNode={explainNode} ask={ask} />);

    // The 202 surfaced as the generating state…
    await act(async () => {});
    expect(screen.getByText(/code graph is being generated/i)).toBeInTheDocument();
    expect(screen.getByText(/checking again in a few seconds \(1\)/i)).toBeInTheDocument();
    // …with no error banner and no bare "Loading graph…" placeholder.
    expect(screen.queryByText(/failed|error|unavailable/i)).not.toBeInTheDocument();
    expect(screen.queryByText("Loading graph…")).not.toBeInTheDocument();

    // First poll fires at 2s (front-loaded schedule) and finds the graph.
    await act(async () => {
      vi.advanceTimersByTime(2100);
    });

    // The graph rendered (via the stubbed force-graph) and the generating
    // state is gone. Sync queries — findBy*/waitFor schedule fake timers and
    // would hang under vi.useFakeTimers.
    expect(screen.getByTestId("force-graph")).toBeInTheDocument();
    expect(screen.getByText(/1 nodes · 0 edges/i)).toBeInTheDocument();
    expect(screen.queryByText(/code graph is being generated/i)).not.toBeInTheDocument();
    expect(fetchGraph).toHaveBeenCalledTimes(2);
  });

  it("gives up with an honest error after the poll budget is exhausted (202 every time)", async () => {
    const fetchGraph = vi.fn().mockRejectedValue(generating202());

    render(<CodeGraphTab fetchGraph={fetchGraph} explainNode={vi.fn()} ask={vi.fn()} />);
    await act(async () => {});

    // Burn through the front-loaded schedule up to MAX_POLLS.
    for (let i = 0; i < 61; i++) {
      await act(async () => {
        vi.advanceTimersByTime(8100);
      });
    }

    // The exhausted-202 budget surfaces the honest error (sync query).
    expect(screen.getByText(/taking unusually long to generate/i)).toBeInTheDocument();
    expect(screen.queryByText(/code graph is being generated — first build/i)).not.toBeInTheDocument();
  });
});
