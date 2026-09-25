/**
 * Connected-files computation tests (PRD-G02): import edges first, structural
 * fallbacks when no edges exist, dedup, caps, path normalization.
 */
import { describe, expect, it } from "vitest";
import { computeConnections, type FileEdge } from "@/lib/fileConnections";

const tree = {
  name: "repo",
  path: "",
  kind: "dir" as const,
  children: [
    {
      name: "src",
      path: "src",
      kind: "dir" as const,
      children: [
        { name: "app.py", path: "src/app.py", kind: "file" as const, children: [] },
        { name: "util.py", path: "src/util.py", kind: "file" as const, children: [] },
        { name: "api.ts", path: "src/api.ts", kind: "file" as const, children: [] },
        { name: "api.test.ts", path: "src/api.test.ts", kind: "file" as const, children: [] },
        { name: "types.ts", path: "src/types.ts", kind: "file" as const, children: [] },
      ],
    },
    {
      name: "tests",
      path: "tests",
      kind: "dir" as const,
      children: [{ name: "api.ts", path: "tests/api.ts", kind: "file" as const, children: [] }],
    },
    { name: "util.py", path: "util.py", kind: "file" as const, children: [] },
  ],
};

describe("computeConnections", () => {
  it("reports imports and imported-by from real edges", () => {
    const edges: FileEdge[] = [{ from: "src/app.py", to: "src/util.py" }];
    const out = computeConnections(tree, "/src/app.py", edges);
    const util = out.nodes.find((n) => n.path === "src/util.py");
    expect(util?.relation).toBe("import");

    const back = computeConnections(tree, "src/util.py", edges);
    expect(back.nodes.find((n) => n.path === "src/app.py")?.relation).toBe("imported-by");
  });

  it("falls back to siblings when no edges exist", () => {
    const out = computeConnections(tree, "src/app.py");
    const paths = out.nodes.map((n) => n.path);
    expect(paths).toContain("src/util.py");
    expect(paths).toContain("src/api.ts");
    // README-like files in other dirs are not siblings.
    expect(paths).not.toContain("util.py");
    for (const n of out.nodes) expect(n.relation).toBe("sibling");
  });

  it("pairs tests with sources regardless of convention", () => {
    const fromTest = computeConnections(tree, "src/api.test.ts");
    expect(fromTest.nodes.find((n) => n.path === "src/api.ts")?.relation).toBe("test");

    const pyTree = {
      name: "r",
      path: "",
      kind: "dir" as const,
      children: [
        { name: "app", path: "app", kind: "dir" as const, children: [
          { name: "util.py", path: "app/util.py", kind: "file" as const, children: [] },
          { name: "test_util.py", path: "app/test_util.py", kind: "file" as const, children: [] },
        ] },
      ],
    };
    const out = computeConnections(pyTree, "app/util.py");
    expect(out.nodes.find((n) => n.path === "app/test_util.py")?.relation).toBe("test");
  });

  it("matches same-basename files across directories as related", () => {
    const out = computeConnections(tree, "src/api.ts");
    const related = out.nodes.filter((n) => n.relation === "related");
    expect(related.map((n) => n.path)).toContain("tests/api.ts");
    // The test pair still wins priority over the same-dir sibling.
    expect(out.nodes[0].relation).toBe("test");
  });

  it("dedupes a path picked by multiple rules, strongest relation first", () => {
    const edges: FileEdge[] = [{ from: "src/app.py", to: "src/util.py" }];
    const out = computeConnections(tree, "src/app.py", edges);
    const matches = out.nodes.filter((n) => n.path === "src/util.py");
    expect(matches).toHaveLength(1);
    expect(matches[0].relation).toBe("import");
  });

  it("caps very large neighborhoods and always links back to the selection", () => {
    const wideTree = {
      name: "r",
      path: "",
      kind: "dir" as const,
      children: [
        {
          name: "d",
          path: "d",
          kind: "dir" as const,
          children: Array.from({ length: 60 }, (_, i) => ({
            name: `f${i}.ts`,
            path: `d/f${i}.ts`,
            kind: "file" as const,
            children: [],
          })),
        },
      ],
    };
    const out = computeConnections(wideTree, "d/f0.ts");
    expect(out.nodes.length).toBeLessThanOrEqual(24);
    expect(out.links).toHaveLength(out.nodes.length);
    for (const l of out.links) expect(l.source).toBe("d/f0.ts");
  });

  it("ignores edges pointing at unknown files", () => {
    const edges: FileEdge[] = [{ from: "src/app.py", to: "missing/gone.ts" }];
    const out = computeConnections(tree, "src/app.py", edges);
    expect(out.nodes.map((n) => n.path)).not.toContain("missing/gone.ts");
  });
});
