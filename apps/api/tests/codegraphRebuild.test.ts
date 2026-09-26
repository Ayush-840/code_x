import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { Server } from "node:http";
import express from "express";
import jwt from "jsonwebtoken";

/**
 * End-to-end regression for the lazy graph rebuild (the "self-heal" flow):
 *
 *   graph missing → API answers 202 GRAPH_GENERATING + schedules a rebuild
 *   → (rebuild completes upstream) → the same endpoint serves the graph.
 *
 * The real Express app runs over real HTTP (the health/oauth test pattern),
 * with the codegraph service faked by a local upstream whose /graph route
 * starts 400ing (no graph) and flips to 200 once the "rebuild" completes —
 * exactly the contract fetchGraph() in routes/codegraph.ts proxies against.
 * Prisma and BullMQ are mocked at the module boundary so no Postgres/Redis
 * is needed; the route logic under test (404→202 mapping, marker-artifact
 * dedup, enqueue) runs for real.
 */

// Hoisted flag shared with the fake upstream: does a graph exist yet?
const upstream = { hasGraph: false };
// How many rebuild-marker artifacts have been "written" (createArtifact calls).
let markersWritten = 0;

vi.mock("@vibe-coder/database/artifacts", () => ({
  createArtifact: vi.fn(async (_prisma: unknown, input: { artifactType: string }) => {
    if (input.artifactType === "codegraph-rebuild") markersWritten += 1;
    return { id: `artifact-${markersWritten}`, ...input };
  }),
}));

vi.mock("../src/db", () => ({
  prisma: {
    repository: {
      // resolveRepoId: the repo exists and is owned by the JWT's subject.
      findFirst: vi.fn(async () => ({ id: "repo-1", userId: "user-1", fullName: "me/demo" })),
    },
    publicAnalysis: {
      // resolveRepoId's anonymous fallback (only reached for foreign repos).
      findFirst: vi.fn(async () => null),
      // resolvePublicAnalysis: a live public analysis over repo-1.
      findUnique: vi.fn(async () => ({
        id: "1f0e0e5e-6a7b-4c8d-9e0f-1a2b3c4d5e6f",
        repoId: "repo-1",
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        repo: { id: "repo-1", fullName: "me/demo" },
      })),
    },
    artifact: {
      // maybeScheduleGraphRebuild: no codegraph artifact and no fresh marker
      // until createArtifact writes one — markersWritten drives the answer.
      findMany: vi.fn(async () => {
        if (markersWritten === 0) return [];
        return [
          {
            artifactType: "codegraph-rebuild",
            generatedAt: new Date(),
            content: {},
          },
        ];
      }),
    },
  },
}));

vi.mock("../src/redis", () => ({
  connection: {},
  analysisQueue: { add: vi.fn(async () => ({ id: "job-1" })) },
}));

const REPO_ID = "repo-1";
const PUBLIC_ANALYSIS_ID = "1f0e0e5e-6a7b-4c8d-9e0f-1a2b3c4d5e6f";

function fakeCodegraphApp() {
  const app = express();
  app.use(express.json());
  app.get("/graph", (req, res) => {
    if (req.query.repo_id !== REPO_ID) {
      res.status(400).json({ detail: "repo_id required" });
      return;
    }
    if (!upstream.hasGraph) {
      // The Python service answers 400 when no graph exists for the repo —
      // the signal the route maps to the lazy-rebuild flow.
      res.status(400).json({ detail: "no graph for repo" });
      return;
    }
    res.json({
      nodes: [
        { id: "src/main.py::run", type: "function", file: "src/main.py", name: "run", line_start: 1, line_end: 10 },
      ],
      edges: [],
    });
  });
  app.post("/explain", (_req, res) => res.json({ explanation: "it runs", neighbors: [] }));
  app.post("/chat", (_req, res) => res.json({ answer: "run() in src/main.py", cited_nodes: ["src/main.py::run"] }));
  return app;
}

describe("codegraph lazy rebuild (missing graph → 202 → recovers)", () => {
  let app: ReturnType<typeof express.Application.prototype.listen>;
  let baseUrl: string;
  let token: string;

  beforeAll(async () => {
    // Boot the fake codegraph upstream first so we can point config at it.
    const upstreamServer = fakeCodegraphApp().listen(0);
    const upstreamPort = (upstreamServer.address() as { port: number }).port;
    process.env.CODEGRAPH_SERVICE_URL = `http://localhost:${upstreamPort}`;

    // config.ts reads CODEGRAPH_SERVICE_URL at import time — import the app
    // only after the env var is set (dynamic import on purpose).
    const { createApp } = await import("../src/app");
    const realApp = createApp();
    app = realApp.listen(0);
    const port = (app.address() as { port: number }).port;
    baseUrl = `http://localhost:${port}`;

    token = jwt.sign({ sub: "user-1", githubId: 1 }, process.env.JWT_SECRET as string, {
      expiresIn: "15m",
    });
    return () => upstreamServer.close();
  });

  afterAll(() => {
    app?.close();
  });

  beforeEach(() => {
    upstream.hasGraph = false;
    markersWritten = 0;
    // Clear call history (not implementations) — the queue spy accumulates
    // calls across tests otherwise, since the mocked module is shared.
    vi.clearAllMocks();
  });

  it("answers 202 GRAPH_GENERATING and schedules a rebuild when no graph exists (authed)", async () => {
    const { analysisQueue } = await import("../src/redis");

    const res = await fetch(`${baseUrl}/v1/repos/${REPO_ID}/graph`, {
      headers: { cookie: `access_token=${token}` },
    });
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("GRAPH_GENERATING");

    // The rebuild was actually scheduled: marker artifact + queue job.
    expect(markersWritten).toBe(1);
    expect(analysisQueue.add).toHaveBeenCalledTimes(1);
    expect(analysisQueue.add).toHaveBeenCalledWith(
      "rebuild-graph",
      { repoId: REPO_ID, fullName: "me/demo" },
      expect.objectContaining({ jobId: expect.stringContaining(`rebuild-graph:${REPO_ID}:`) })
    );
  });

  it("keeps answering 202 without re-enqueuing while the rebuild window marker is fresh", async () => {
    const { analysisQueue } = await import("../src/redis");

    // First request schedules the rebuild (writes the marker).
    await fetch(`${baseUrl}/v1/repos/${REPO_ID}/graph`, {
      headers: { cookie: `access_token=${token}` },
    });
    expect(markersWritten).toBe(1);

    // Rebuild still not done — the fresh marker must dedup the enqueue.
    const res = await fetch(`${baseUrl}/v1/repos/${REPO_ID}/graph`, {
      headers: { cookie: `access_token=${token}` },
    });
    expect(res.status).toBe(202);
    expect(markersWritten).toBe(1);
    expect(analysisQueue.add).toHaveBeenCalledTimes(1);
  });

  it("serves the graph once the rebuild has produced one (the tab recovers)", async () => {
    // Simulate the worker finishing the rebuild: the upstream now has a graph.
    upstream.hasGraph = true;

    const res = await fetch(`${baseUrl}/v1/repos/${REPO_ID}/graph`, {
      headers: { cookie: `access_token=${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.nodes).toHaveLength(1);
    expect(body.data.nodes[0].id).toBe("src/main.py::run");
  });

  it("reports a genuinely graph-less repo as 404 once a completed rebuild proved there is nothing to parse", async () => {
    // A completed rebuild leaves a permanent `codegraph` artifact; after that,
    // a still-missing graph is an honest 404, not another 202 loop.
    upstream.hasGraph = false;
    markersWritten = 0;
    const { prisma } = await import("../src/db");
    (prisma.artifact.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { artifactType: "codegraph", generatedAt: new Date(), content: {} },
    ]);

    const res = await fetch(`${baseUrl}/v1/repos/${REPO_ID}/graph`, {
      headers: { cookie: `access_token=${token}` },
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("NO_GRAPH");
  });

  it("does the same self-heal for the anonymous public flow", async () => {
    const { analysisQueue } = await import("../src/redis");

    const missing = await fetch(`${baseUrl}/v1/public/${PUBLIC_ANALYSIS_ID}/codegraph`);
    expect(missing.status).toBe(202);
    expect((await missing.json()).error.code).toBe("GRAPH_GENERATING");
    expect(markersWritten).toBe(1);
    expect(analysisQueue.add).toHaveBeenCalledWith(
      "rebuild-graph",
      { repoId: REPO_ID, fullName: "me/demo" },
      expect.anything()
    );

    // Rebuild lands → the visitor's next poll gets the graph, no auth needed.
    upstream.hasGraph = true;
    const ready = await fetch(`${baseUrl}/v1/public/${PUBLIC_ANALYSIS_ID}/codegraph`);
    expect(ready.status).toBe(200);
    const body = await ready.json();
    expect(body.ok).toBe(true);
    expect(body.data.edges).toEqual([]);
  });
});
