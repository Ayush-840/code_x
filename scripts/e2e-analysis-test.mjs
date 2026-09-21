/**
 * E2E: anonymous repo analysis over production, verifying that
 * `analysis:progress` websocket events stream to a connected client.
 *
 * Usage: node scripts/e2e-analysis-test.mjs
 * Env:   API_URL, WS_URL optional; JWT_SECRET optional (else pulled from Railway CLI)
 */
import { execSync } from "node:child_process";
import { createRequire } from "node:module";

const API_URL = process.env.API_URL ?? "https://api-worker-production-a6ab.up.railway.app";
const WS_URL = process.env.WS_URL ?? "https://websocket-production-0a61.up.railway.app";
const OVERALL_TIMEOUT_MS = 300_000;

const requireFromWeb = createRequire(new URL("../apps/websocket/package.json", import.meta.url));
const requireFromWebApp = createRequire(new URL("../apps/web/package.json", import.meta.url));
const jwt = requireFromWeb("jsonwebtoken");
const { io } = requireFromWebApp("socket.io-client");

const log = (...a) => console.log(...a);
const ts = () => new Date().toISOString().slice(11, 23);

// ---------------------------------------------------------------------------
// 1. JWT for the websocket auth middleware (job rooms are keyed by jobId only,
//    so any valid userId works). Secret stays in memory; never printed.
// ---------------------------------------------------------------------------
function getJwtSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  log("→ fetching JWT_SECRET from Railway (websocket service)…");
  const raw = execSync("railway variables --service websocket --json", {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const vars = JSON.parse(raw);
  if (!vars.JWT_SECRET) throw new Error("JWT_SECRET not found in Railway websocket variables");
  return vars.JWT_SECRET;
}

const token = jwt.sign({ userId: "e2e-test-user" }, getJwtSecret(), { expiresIn: "10m" });
log(`✓ test JWT signed (userId=e2e-test-user, expires in 10m)`);

// ---------------------------------------------------------------------------
// 2. Connect socket BEFORE kicking off the job so we lose as few events as possible
// ---------------------------------------------------------------------------
const events = [];
let socketConnected = false;
let socketError = null;

const socket = io(WS_URL, {
  transports: ["websocket"],
  auth: { token },
  reconnectionAttempts: 3,
  timeout: 15_000,
});

socket.on("connect", () => {
  socketConnected = true;
  log(`✓ socket connected  id=${socket.id}  transport=${socket.io.engine.transport.name}`);
});
socket.on("connect_error", (err) => {
  socketError = err.message;
  log(`✗ socket connect_error: ${err.message}`);
});
socket.on("disconnect", (reason) => log(`! socket disconnected: ${reason}`));
socket.on("analysis:progress", (p) => {
  events.push({ at: ts(), ...p });
  log(`  📡 ${ts()}  analysis:progress  stage=${p.stage}  ${String(p.progress).padStart(3)}%  — ${p.message}`);
});

await new Promise((resolve) => socket.once("connect", resolve));
if (!socketConnected) {
  console.error(`FATAL: socket never connected (${socketError ?? "timeout"})`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 3. Kick off the analysis (try candidates until one is not cache-served)
// ---------------------------------------------------------------------------
const CANDIDATES = [
  "https://github.com/vercel/ms",
  "https://github.com/sindresorhus/query-string",
  "https://github.com/jonschlinkert/is-odd",
];

let analysisId = null;
let repoFullName = null;
for (const repoUrl of CANDIDATES) {
  log(`\n→ POST ${API_URL}/v1/public/analyze  ${repoUrl}`);
  const res = await fetch(`${API_URL}/v1/public/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ repoUrl }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    log(`  ✗ HTTP ${res.status}: ${JSON.stringify(body.error ?? body)}`);
    if (res.status === 429) {
      console.error("GitHub/API rate limited — aborting test.");
      process.exit(1);
    }
    continue;
  }
  const data = body.data ?? body;
  analysisId = data.id;
  repoFullName = repoUrl.replace("https://github.com/", "");
  log(`  ✓ HTTP ${res.status}  id=${analysisId}  status=${data.status}  cached=${data.cached}`);
  if (!data.cached) break;
  log("  (cached result — trying another repo so we get live progress events)");
}
if (!analysisId) {
  console.error("FATAL: could not start an analysis (all candidates failed/cached).");
  socket.disconnect();
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 4. Poll REST status; join the job room as soon as jobId is visible
// ---------------------------------------------------------------------------
let joinedJobId = null;
const deadline = Date.now() + OVERALL_TIMEOUT_MS;
let final = null;

log(`\n→ polling GET ${API_URL}/v1/public/${analysisId} (joining job room when jobId appears)…`);
while (Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 1000));
  let data;
  try {
    const res = await fetch(`${API_URL}/v1/public/${analysisId}`);
    if (!res.ok) {
      log(`  ! status HTTP ${res.status}`);
      continue;
    }
    data = (await res.json()).data ?? {};
  } catch (e) {
    log(`  ! status fetch failed: ${e.message}`);
    continue;
  }

  const jobId = data.job?.id;
  if (jobId && !joinedJobId) {
    joinedJobId = jobId;
    socket.emit("repo:join", { jobId, repoId: data.job?.repoId });
    log(`  ✓ joined room job:${jobId} (via repo:join)`);
  }
  if (data.job && data.job.stage) {
    // light heartbeat so the wait is visible
    process.stdout.write(`    rest: ${data.status} ${data.job.stage} ${data.job.progress}%\r`);
  }
  if (data.status === "READY" || data.status === "FAILED") {
    final = data;
    break;
  }
}
console.log();
socket.disconnect();

// ---------------------------------------------------------------------------
// 5. Verdict
// ---------------------------------------------------------------------------
log("\n──────── RESULT ────────");
log(`repo analyzed:      ${repoFullName}`);
log(`analysis id:        ${analysisId}`);
log(`job id:             ${joinedJobId ?? "(never seen)"}`);
log(`socket connected:   ${socketConnected}`);
log(`progress events:    ${events.length}`);
for (const e of events) {
  log(`   [${e.at}] ${e.stage} ${e.progress}% — ${e.message}`);
}

const checks = [];
checks.push(["socket connected & authenticated", socketConnected && !socketError]);
checks.push(["job room joined", Boolean(joinedJobId)]);
checks.push(["≥1 analysis:progress event received", events.length > 0]);
checks.push(
  [
    "events addressed to the job payload (repoId present)",
    events.every((e) => typeof e.repoId === "string" && e.repoId.length > 0),
  ],
);
const doneEvent = events.find((e) => e.stage === "DONE");
checks.push(["DONE (100%) event streamed", Boolean(doneEvent)]);
checks.push([
  "final REST status READY",
  final?.status === "READY",
  final ? `(status=${final.status})` : "(timed out)",
]);
checks.push([
  "modules parsed",
  (final?.modules?.length ?? 0) > 0,
  `${final?.modules?.length ?? 0} modules`,
]);
checks.push([
  "artifacts generated",
  (final?.artifacts?.length ?? 0) > 0,
  `${final?.artifacts?.length ?? 0} artifacts (${(final?.artifacts ?? []).map((a) => a.artifactType).join(", ")})`,
]);

let pass = true;
for (const [name, ok, extra = ""] of checks) {
  log(`${ok ? "✓" : "✗"} ${name} ${extra}`);
  if (!ok) pass = false;
}
log(`\n${pass ? "✅ E2E PASS" : "❌ E2E FAIL"}`);
process.exit(pass ? 0 : 1);
