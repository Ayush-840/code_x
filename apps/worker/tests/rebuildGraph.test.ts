import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { mkdir, writeFile, stat } from "node:fs/promises";
import { join } from "node:path";

/**
 * Worker-side contract for the lazy graph rebuild (the other half of the API
 * test in apps/api/tests/codegraphRebuild.test.ts): the API answers 202 and
 * enqueues a `rebuild-graph` job — this test proves the job handler actually
 * produces the thing the API waits for:
 *
 *   clone → collect the repo's .py files → POST them to codegraph /parse
 *   → write the `codegraph` artifact (the API's completed-rebuild marker).
 *
 * `rebuildGraph` runs against the real filesystem (mkdtemp + a file walk) and
 * the real global fetch, so the fake `clone` materializes a small repo on
 * disk and fetch is stubbed at the global boundary — everything between
 * (git clone call, .py filtering, artifact write, temp-dir cleanup) runs for
 * real. Prisma and ioredis are mocked at the module boundary because
 * analyzeRepo.ts constructs both at import time and no Postgres/Redis is
 * needed to prove this contract.
 */

// Shared mutable state for the hoisted mocks below (vi.mock factories are
// hoisted above imports and may only touch vi.hoisted()-created values).
const state = vi.hoisted(() => ({
  // What the fake `git clone` checks out into the temp dir, path → content.
  files: {} as Record<string, string>,
  // Every temp dir handed to clone, so tests can assert rm() cleaned up.
  cloneDirs: [] as string[],
}));

vi.mock("simple-git", () => ({
  simpleGit: vi.fn(() => ({
    clone: vi.fn(async (_url: string, dir: string, _opts: string[]) => {
      state.cloneDirs.push(dir);
      for (const [rel, content] of Object.entries(state.files)) {
        await mkdir(join(dir, rel, ".."), { recursive: true });
        await writeFile(join(dir, rel), content);
      }
    }),
  })),
}));

vi.mock("@vibe-coder/database", () => ({
  // analyzeRepo.ts does `new PrismaClient()` at import time and passes the
  // instance into createArtifact — remember the instance so tests can assert
  // the artifact was written through the real client handle.
  PrismaClient: class PrismaClient {
    static lastInstance: unknown;
    constructor() {
      PrismaClient.lastInstance = this;
    }
  },
}));

vi.mock("@vibe-coder/database/artifacts", () => ({
  createArtifact: vi.fn(async (_prisma: unknown, input: Record<string, unknown>) => ({
    id: "artifact-1",
    ...input,
  })),
}));

vi.mock("ioredis", () => ({
  // Only the constructor runs at import time (progressPublisher); no
  // commands are issued on the rebuild path.
  Redis: class {},
}));

// config-ish constant read at import time — set BEFORE dynamically importing
// the module under test so the fetch URL assertion is deterministic.
const CODEGRAPH_URL = "http://codegraph.test";
process.env.CODEGRAPH_SERVICE_URL = CODEGRAPH_URL;

const REPO_ID = "repo-1";
const FULL_NAME = "acme/widgets";

const MAIN_PY = "def run():\n    return helper()\n";
const UTILS_PY = "def helper():\n    return 42\n";

/** A small polyglot checkout: two Python files the parser should see, plus noise it must not ship. */
const DEFAULT_FILES: Record<string, string> = {
  "main.py": MAIN_PY,
  "pkg/utils.py": UTILS_PY,
  "README.md": "# widgets",
  "script.js": "console.log('not python');",
};

/** RebuildGraph module, imported after the env var is set (see above). */
let mod: typeof import("../src/jobs/analyzeRepo");
let createArtifact: ReturnType<typeof vi.fn>;
let fetchMock: ReturnType<typeof vi.fn>;

function stubParseResponse(res: { ok: boolean; status?: number; json?: unknown; text?: string }) {
  fetchMock = vi.fn(async () => ({
    ok: res.ok,
    status: res.status,
    json: async () => res.json,
    text: async () => res.text ?? "",
  }));
  vi.stubGlobal("fetch", fetchMock);
}

describe("rebuildGraph (the rebuild-graph job handler)", () => {
  beforeAll(async () => {
    mod = await import("../src/jobs/analyzeRepo");
    ({ createArtifact } = await import("@vibe-coder/database/artifacts"));
  });

  beforeEach(() => {
    state.files = { ...DEFAULT_FILES };
    state.cloneDirs = [];
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("clones, ships only the .py files to /parse, and writes the codegraph artifact", async () => {
    stubParseResponse({ ok: true, json: { nodes: 3, edges: 2 } });

    await mod.rebuildGraph({ repoId: REPO_ID, fullName: FULL_NAME });

    // Cloned the right repo, shallow (same args the full pipeline uses).
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${CODEGRAPH_URL}/parse`);
    expect(init.method).toBe("POST");

    const body = JSON.parse(String(init.body)) as { repo_id: string; files: { path: string; content: string }[] };
    expect(body.repo_id).toBe(REPO_ID);
    // Only the Python sources are shipped — README/js are dropped — and
    // their contents ride along (the parse service reads files, not a FS).
    expect(body.files).toEqual([
      { path: "main.py", content: MAIN_PY },
      { path: "pkg/utils.py", content: UTILS_PY },
    ]);

    // The whole point of the job: the `codegraph` artifact the API's
    // maybeScheduleGraphRebuild looks for as the completed-rebuild marker,
    // written through the module's own prisma client with the parse counts.
    const { PrismaClient } = await import("@vibe-coder/database");
    expect(createArtifact).toHaveBeenCalledTimes(1);
    expect(createArtifact.mock.calls[0][0]).toBe(PrismaClient.lastInstance);
    expect(createArtifact.mock.calls[0][1]).toEqual({
      repoId: REPO_ID,
      artifactType: "codegraph",
      content: { nodes: 3, edges: 2 },
    });

    // The temp checkout is cleaned up even on success.
    await expect(stat(state.cloneDirs[0])).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does NOT write the codegraph artifact when the parse service fails", async () => {
    stubParseResponse({ ok: false, status: 500, text: "boom" });

    await expect(mod.rebuildGraph({ repoId: REPO_ID, fullName: FULL_NAME })).rejects.toThrow(
      /codegraph parse failed \(HTTP 500\)/
    );

    // A failed rebuild must leave no marker: the API's "completed rebuild →
    // honest 404" logic keys off this artifact's existence.
    expect(createArtifact).not.toHaveBeenCalled();

    // …and the clone still gets cleaned up on the failure path (finally).
    await expect(stat(state.cloneDirs[0])).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("still asks the service for a repo with zero Python files (it owns the empty-graph verdict)", async () => {
    // A Java-only repo must not silently skip the artifact write: the worker
    // POSTs an empty file list and lets the service respond; only its answer
    // decides whether the completed-rebuild marker (→ honest 404 later) lands.
    state.files = { "README.md": "# no python here", "Main.java": "class Main {}" };
    stubParseResponse({ ok: true, json: { nodes: 0, edges: 0 } });

    await mod.rebuildGraph({ repoId: REPO_ID, fullName: FULL_NAME });

    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body)) as { files: unknown[] };
    expect(body.files).toEqual([]);
    expect(createArtifact).toHaveBeenCalledWith(
      expect.anything(),
      { repoId: REPO_ID, artifactType: "codegraph", content: { nodes: 0, edges: 0 } }
    );
  });
});
