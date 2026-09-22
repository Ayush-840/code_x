/**
 * E2E (local): anonymous analysis on a real repo, asserting the new
 * File Graph surfaces end-to-end:
 *   1. POST /v1/public/analyze            → analysis starts
 *   2. GET  /v1/public/:id                → READY with a file-tree artifact
 *   3. POST /v1/public/:id/files/explain  → grounded explanation (demo mode ok)
 *   4. repeat explain → cached: true
 *
 * Usage: node scripts/e2e-file-graph-test.mjs
 * Env:   API_URL (default http://localhost:4002), REPO_URL optional
 */
const API_URL = process.env.API_URL ?? "http://localhost:4002";
const REPO_URL = process.env.REPO_URL ?? "https://github.com/vercel/ms";
const TIMEOUT_MS = 240_000;
// Optional bar for large-repo validation runs (e.g. MIN_FILES=1000).
const MIN_FILES = Number(process.env.MIN_FILES ?? 0);

const log = (...a) => console.log(...a);
const checks = [];
const check = (name, ok, extra = "") => {
  checks.push([name, ok, extra]);
  log(`${ok ? "✓" : "✗"} ${name}${extra ? ` ${extra}` : ""}`);
};

async function api(path, init) {
  const res = await fetch(`${API_URL}${path}`, init);
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

// ── 1. start analysis ─────────────────────────────────────
log(`→ POST /v1/public/analyze ${REPO_URL}`);
const start = await api("/v1/public/analyze", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ repoUrl: REPO_URL }),
});
const startData = start.body?.data ?? {};
check("analyze accepted", start.status === 202 || (start.status === 200 && startData.cached), `HTTP ${start.status}`);
if (!startData.id) {
  log(`  body: ${JSON.stringify(start.body).slice(0, 300)}`);
  process.exit(1);
}
const id = startData.id;
log(`  id=${id} status=${startData.status}`);

// ── 2. poll to READY ──────────────────────────────────────
let final = null;
const deadline = Date.now() + TIMEOUT_MS;
while (Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 1500));
  const { status, body } = await api(`/v1/public/${id}`);
  if (!status === 200 && body?.error) {
    log(`  ! status fetch HTTP ${status}: ${JSON.stringify(body.error)}`);
    continue;
  }
  const data = body?.data;
  if (data?.status === "READY" || data?.status === "FAILED") {
    final = data;
    break;
  }
}
check("analysis reached READY", final?.status === "READY", final ? `status=${final.status}` : "(timeout)");

// ── 3. file-tree artifact present and populated ───────────
const treeArtifact = final?.artifacts?.find((a) => a.artifactType === "file-tree");
check("file-tree artifact exists", Boolean(treeArtifact));
const tree = treeArtifact?.content;
check(
  "file-tree has files",
  Boolean(tree?.children?.length),
  tree ? `${JSON.stringify(tree).length} bytes` : ""
);

// Count files in the tree and compare against modules' aggregate fileCount.
let treeFileCount = 0;
if (tree) {
  const walk = (n) => {
    if (n.kind === "file") treeFileCount += 1;
    for (const c of n.children ?? []) walk(c);
  };
  walk(tree);
}
const moduleFileCount = (final?.modules ?? []).reduce((s, m) => s + (m.fileCount ?? 0), 0);
check(
  "tree file count matches module aggregates",
  treeFileCount > 0 && treeFileCount === moduleFileCount,
  `tree=${treeFileCount} modules=${moduleFileCount}`
);
if (MIN_FILES > 0) {
  check(
    `large repo: tree has ≥ ${MIN_FILES} files`,
    treeFileCount >= MIN_FILES,
    `tree=${treeFileCount}`
  );
}

// ── 4. files/explain: first call generates, second is cached ──
// Pick a real file path from the tree (prefer a source file).
function pickFile(node) {
  const src = (node.children ?? []).find(
    (c) => c.kind === "file" && /\.(py|ts|tsx|js|jsx|rb|go|rs)$/.test(c.name)
  );
  if (src) return src.path;
  for (const c of node.children ?? []) {
    if (c.kind === "dir") {
      const found = pickFile(c);
      if (found) return found;
    }
  }
  return null;
}
const filePath = tree ? pickFile(tree) : null;
check("picked a file from the tree", Boolean(filePath), filePath ?? "");

if (filePath) {
  const explain = await api(`/v1/public/${id}/files/explain`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: filePath }),
  });
  const exp = explain.body?.data ?? {};
  check("explain generated", explain.status === 200, `HTTP ${explain.status} cached=${exp.cached} demo=${exp.isDemo}`);
  check("explain has summary", typeof exp.summary === "string" && exp.summary.length > 0);
  check("explain grounded in the requested file", exp.filePath === filePath || (exp.citations ?? []).some((c) => c.filePath === filePath));
  check("explain has citations", (exp.citations ?? []).length > 0);

  const again = await api(`/v1/public/${id}/files/explain`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: filePath }),
  });
  check("second explain is a cache hit", again.body?.data?.cached === true, `HTTP ${again.status}`);
}

log("\n──────── RESULT ────────");
let pass = true;
for (const [name, ok, extra] of checks) {
  if (!ok) pass = false;
}
log(`${pass ? "✅ E2E PASS" : "❌ E2E FAIL"} (${checks.filter((c) => c[1]).length}/${checks.length} checks)`);
process.exit(pass ? 0 : 1);
