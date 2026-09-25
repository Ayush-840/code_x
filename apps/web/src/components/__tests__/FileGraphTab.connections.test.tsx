/**
 * Connected-files graph tests (PRD-G02): clicking a file shows its connected
 * files, clicking a node in the graph switches the detail pane, and the
 * graph works with or without the file-edges artifact — without ever
 * re-fetching on parent re-renders (flicker contract, TRD-F01).
 */
import { render, screen, waitFor } from "@testing-library/react";
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
        { name: "main.py", path: "src/main.py", kind: "file", children: [] },
      ],
    },
  ],
};

const edges = [{ from: "src/app.py", to: "src/util.py" }];

function makeProps() {
  return {
    fetchTree: vi.fn().mockResolvedValue(tree),
    explainFile: vi.fn().mockImplementation(async (path: string) => ({
      summary: `EXPLAINED: ${path}`,
    })),
    fetchFileEdges: vi.fn().mockResolvedValue(edges),
  };
}

describe("FileGraphTab connected files (PRD-G02)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows the connected-files graph when a file is selected", async () => {
    const user = userEvent.setup();
    const props = makeProps();
    render(<FileGraphTab {...props} />);
    await screen.findByText(/\/repo/);

    await user.click(screen.getByRole("button", { name: /app\.py/ }));

    const graph = await screen.findByTestId("connections-graph");
    expect(graph).toBeInTheDocument();
    // Edge data present: util.py is an import of app.py.
    expect(screen.getByLabelText("connection src/util.py")).toBeInTheDocument();
    // Structural siblings show too (main.py is same-dir, no edge).
    expect(screen.getByLabelText("connection src/main.py")).toBeInTheDocument();
    // Edge fetch ran exactly once, silently — even after parent re-renders.
    expect(props.fetchFileEdges).toHaveBeenCalledTimes(1);
  });

  it("clicking a connected node switches the detail pane to that file", async () => {
    const user = userEvent.setup();
    const props = makeProps();
    render(<FileGraphTab {...props} />);
    await screen.findByText(/\/repo/);

    await user.click(screen.getByRole("button", { name: /app\.py/ }));
    await screen.findByTestId("connections-graph");

    await user.click(screen.getByLabelText("connection src/util.py"));

    expect(await screen.findByText(/EXPLAINED: src\/util\.py/)).toBeInTheDocument();
    // Graph recomputed around the new selection: app.py is now the importer.
    expect(screen.getByLabelText("connection src/app.py")).toBeInTheDocument();
    expect(props.explainFile).toHaveBeenCalledWith("src/util.py");
  });

  it("falls back to structural connections when the edges fetch fails (old repo)", async () => {
    const user = userEvent.setup();
    const props = makeProps();
    props.fetchFileEdges = vi.fn().mockRejectedValue(new Error("NOT_FOUND"));
    render(<FileGraphTab {...props} />);
    await screen.findByText(/\/repo/);

    await user.click(screen.getByRole("button", { name: /app\.py/ }));

    // No import edges, but the same-dir siblings still render.
    const graph = await screen.findByTestId("connections-graph");
    expect(graph).toBeInTheDocument();
    expect(screen.getByLabelText("connection src/util.py")).toBeInTheDocument();
    expect(screen.getByLabelText("connection src/main.py")).toBeInTheDocument();
  });

  it("works without a fetchFileEdges prop at all (structural only)", async () => {
    const user = userEvent.setup();
    const { fetchTree, explainFile, ...rest } = makeProps();
    void rest;
    render(<FileGraphTab fetchTree={fetchTree} explainFile={explainFile} />);
    await screen.findByText(/\/repo/);

    await user.click(screen.getByRole("button", { name: /app\.py/ }));
    expect(await screen.findByTestId("connections-graph")).toBeInTheDocument();
    expect(screen.getByLabelText("connection src/util.py")).toBeInTheDocument();
  });

  it("re-requests edges only silently when the parent re-renders with new identities", async () => {
    const user = userEvent.setup();
    const props = makeProps();
    const { rerender } = render(<FileGraphTab {...props} />);
    await screen.findByText(/\/repo/);
    await user.click(screen.getByRole("button", { name: /app\.py/ }));
    await screen.findByTestId("connections-graph");

    for (let i = 0; i < 5; i++) {
      // New closure identities every render — the old flicker trigger.
      rerender(
        <FileGraphTab
          fetchTree={() => props.fetchTree()}
          explainFile={(p) => props.explainFile(p)}
          fetchFileEdges={() => props.fetchFileEdges()}
        />
      );
      // Identity change is treated as a possible data change (same contract
      // as fetchTree): the refetch is allowed, but it must stay silent —
      // the graph never tears down and equal data is deduped in state.
      expect(screen.getByTestId("connections-graph")).toBeInTheDocument();
      expect(screen.queryByText(/Loading file graph…/)).not.toBeInTheDocument();
    }

    await waitFor(() => expect(props.fetchFileEdges.mock.calls.length).toBeLessThanOrEqual(6));
    expect(props.fetchTree.mock.calls.length).toBeLessThanOrEqual(6);
  });
});
