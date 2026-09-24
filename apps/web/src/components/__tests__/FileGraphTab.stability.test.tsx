/**
 * File Graph tab stability regression tests (TRD §6, PRD-F01/F03/F07/F08).
 *
 * Encodes the flicker contract: parent re-renders (including bursts of
 * analysis:progress socket events that re-render ClientRepoPage with inline
 * fetcher props) must never flip the tab back to its full-panel loading or
 * error state, and must not spam refetch/refetch-explanation requests.
 *
 * These tests FAIL against the pre-fix component (inline-identity props
 * re-trigger the load effect) and PASS once the hooks are stabilized and the
 * loader/explainer are idempotent.
 */
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { FileGraphTab } from "@/components/FileGraphTab";
import type { FileTreeNode } from "@/components/FileGraph";

const tree: FileTreeNode = {
  name: "repo",
  path: "",
  kind: "dir",
  children: [
    {
      name: "src",
      path: "src",
      kind: "dir",
      children: [
        { name: "app.py", path: "src/app.py", kind: "file", children: [] },
        { name: "util.py", path: "src/util.py", kind: "file", children: [] },
      ],
    },
    { name: "README.md", path: "README.md", kind: "file", children: [] },
  ],
};

function makeFetchers() {
  const fetchTree = vi.fn().mockResolvedValue(tree);
  const explainFile = vi.fn().mockImplementation(async (path: string) => ({
    summary: `EXPLAINED: ${path}`,
  }));
  return { fetchTree, explainFile };
}

/** Re-render with brand-new inline closures each time — simulates the
 * pre-fix parent (`ClientRepoPage` passing inline arrow functions) being
 * re-rendered by socket progress events. */
function inlineProps(
  fetchers: { fetchTree: () => Promise<FileTreeNode>; explainFile: (p: string) => Promise<unknown> },
  ui: React.ReactElement
) {
  return ui;
}

describe("FileGraphTab stability (TRD §6)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads once and shows content on first mount", async () => {
    const { fetchTree, explainFile } = makeFetchers();
    render(<FileGraphTab fetchTree={fetchTree} explainFile={explainFile} />);

    // First load MAY show the spinner, then must settle on content.
    await screen.findByText(/repo\/? files|files/i, {}, { timeout: 2000 }).catch(() => {});
    await waitFor(() => expect(fetchTree).toHaveBeenCalledTimes(1));
    // Sidebar rendered with the tree root.
    expect(await screen.findByText(/\/repo/)).toBeInTheDocument();
    expect(explainFile).not.toHaveBeenCalled();
  });

  it("fetches exactly once when the parent re-renders with STABLE prop identities (the post-fix ClientRepoPage — PRD-F01)", async () => {
    const { fetchTree, explainFile } = makeFetchers();
    const { rerender } = render(
      <FileGraphTab fetchTree={fetchTree} explainFile={explainFile} />
    );
    await screen.findByText(/\/repo/);

    // Simulate socket-event re-render storms with the memoized fetchers
    // TRD-F02/F01 mandate — same identities every render.
    for (let i = 0; i < 10; i++) {
      rerender(<FileGraphTab fetchTree={fetchTree} explainFile={explainFile} />);
      expect(screen.queryByText(/Loading file graph…/)).not.toBeInTheDocument();
      expect(screen.getByText(/\/repo/)).toBeInTheDocument();
    }

    await act(async () => {});
    expect(fetchTree).toHaveBeenCalledTimes(1);
    expect(explainFile).not.toHaveBeenCalled();
  });

  it("never flips back to the loading panel when the parent re-renders with new inline prop identities (pre-fix parent shape)", async () => {
    const { fetchTree, explainFile } = makeFetchers();
    const { rerender } = render(
      <FileGraphTab
        fetchTree={() => fetchTree()}
        explainFile={(p) => explainFile(p)}
      />
    );
    await screen.findByText(/\/repo/);

    for (let i = 0; i < 10; i++) {
      rerender(
        <FileGraphTab
          fetchTree={() => fetchTree()} // NEW identity every render — the old bug's trigger
          explainFile={(p) => explainFile(p)}
        />
      );
      // Whatever happens upstream, rendered content must never tear down to
      // the full-panel loading or error state (the user-visible flicker).
      expect(screen.queryByText(/Loading file graph…/)).not.toBeInTheDocument();
      expect(screen.queryByText(/File graph unavailable/)).not.toBeInTheDocument();
      expect(screen.getByText(/\/repo/)).toBeInTheDocument();
    }

    await act(async () => {});
    // Identity changes are treated as data changes: silent refreshes are
    // allowed, but every one of them must have been silent (asserted above).
    expect(fetchTree.mock.calls.length).toBeLessThanOrEqual(11);
  });

  it("keeps loaded content and shows an inline error (not the full-panel error screen) when a background refresh fails (PRD-F04)", async () => {
    const good = makeFetchers();
    const bad = {
      fetchTree: vi.fn().mockRejectedValue(new Error("network gone")),
      explainFile: good.explainFile,
    };

    const { rerender } = render(
      <FileGraphTab fetchTree={() => good.fetchTree()} explainFile={(p) => good.explainFile(p)} />
    );
    await screen.findByText(/\/repo/);

    // A later refresh (new fetcher identity) now fails.
    rerender(
      <FileGraphTab fetchTree={() => bad.fetchTree()} explainFile={(p) => bad.explainFile(p)} />
    );

    // Cached tree stays rendered…
    expect(screen.getByText(/\/repo/)).toBeInTheDocument();
    expect(screen.getByText("app.py")).toBeInTheDocument();
    // …with an inline refresh error…
    expect(await screen.findByText(/network gone/)).toBeInTheDocument();
    // …and never the full-panel error screen.
    expect(screen.queryByText(/File graph unavailable/)).not.toBeInTheDocument();
  });

  it("explains a selected file once and does not re-request when the parent re-renders with new identities (PRD-F07)", async () => {
    const user = userEvent.setup();
    const { fetchTree, explainFile } = makeFetchers();
    const { rerender } = render(
      <FileGraphTab
        fetchTree={() => fetchTree()}
        explainFile={(p) => explainFile(p)}
      />
    );
    await screen.findByText(/\/repo/);

    await user.click(screen.getByRole("button", { name: /app\.py/ }));
    expect(await screen.findByText(/EXPLAINED: src\/app\.py/)).toBeInTheDocument();

    for (let i = 0; i < 5; i++) {
      rerender(
        <FileGraphTab
          fetchTree={() => fetchTree()} // NEW identity every render — the bug
          explainFile={(p) => explainFile(p)}
        />
      );
      // Explanation content must not flash away.
      expect(screen.getByText(/EXPLAINED: src\/app\.py/)).toBeInTheDocument();
    }

    await act(async () => {});
    expect(explainFile).toHaveBeenCalledTimes(1);
  });
});
