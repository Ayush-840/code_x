#!/usr/bin/env node
/**
 * Startup smoke test: verify every subpath export of every workspace package
 * actually resolves to a file on disk.
 *
 * Why: docker/Dockerfile.api-worker cherry-picked files out of
 * packages/database (prisma/, generated/, migrations.js) and silently dropped
 * artifacts.js — yet package.json's exports map advertised
 * "@vibe-coder/database/artifacts". The api and worker dist bundles required
 * it at boot, every deploy since 2026-09-25 crashed with MODULE_NOT_FOUND, and
 * the stale previous deployment kept serving with outdated config.
 *
 * This script runs at container boot (before services start) in the deployed
 * images. It exits non-zero on the first missing export so the deployment
 * fails loudly instead of crashing at request time.
 *
 * Usage: node scripts/smoke-exports.cjs [workspaceRoot]
 *   workspaceRoot defaults to the repo root (the script's parent's parent).
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(process.argv[2] ?? path.join(__dirname, ".."));

const missing = [];
let checked = 0;

function fail(msg) {
  process.stderr.write(`[smoke-exports] FAIL: ${msg}\n`);
  process.exit(1);
}

/**
 * Resolve an export target ("./generated/index.js", "." or a conditions
 * object with "default"/"types" keys) against the package directory.
 * Returns the absolute path when it exists on disk, null otherwise.
 */
function resolveTarget(pkgDir, target) {
  if (typeof target === "string") {
    if (target === ".") {
      const idx = path.join(pkgDir, "index.js");
      return fs.existsSync(idx) ? idx : null;
    }
    const abs = path.resolve(pkgDir, target);
    return fs.existsSync(abs) ? abs : null;
  }
  if (target && typeof target === "object") {
    if (typeof target.default === "string") {
      const r = resolveTarget(pkgDir, target.default);
      if (r) return r;
    }
    for (const [cond, val] of Object.entries(target)) {
      // "types" is deliberately NOT a runtime fallback: a .d.ts never
      // satisfies a require() at boot, so accepting it would mask a missing
      // runtime file (exactly how artifacts.d.ts-only copies would slip by).
      if (cond === "default" || cond === "types") continue;
      if (typeof val === "string") {
        const r = resolveTarget(pkgDir, val);
        if (r) return r;
      }
    }
  }
  return null;
}

/** Yield each direct child directory of `dir` that has a package.json. */
function* listPackages(dir) {
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!name.isDirectory()) continue;
    const pkgJson = path.join(dir, name.name, "package.json");
    if (fs.existsSync(pkgJson)) yield path.join(dir, name.name);
  }
}

// ---- 1. Workspace packages: every subpath export must resolve --------------

for (const pkgDir of listPackages(path.join(root, "packages"))) {
  const rel = path.relative(root, pkgDir);
  const pkgJsonPath = path.join(pkgDir, "package.json");
  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8"));
  } catch (e) {
    fail(`cannot parse ${pkgJsonPath}: ${e.message}`);
  }
  if (!pkg.exports && !pkg.main) continue; // nothing resolvable to check

  const targets = [];
  if (typeof pkg.exports === "string") {
    targets.push([".", pkg.exports]);
  } else if (pkg.exports && typeof pkg.exports === "object") {
    for (const [subpath, target] of Object.entries(pkg.exports)) {
      targets.push([subpath, target]);
    }
  } else if (pkg.main) {
    targets.push([".", pkg.main]);
  }

  for (const [subpath, target] of targets) {
    const resolved = resolveTarget(pkgDir, target);
    if (resolved) {
      checked++;
    } else {
      const name = pkg.name ?? rel;
      missing.push(`${name}${subpath === "." ? "" : subpath} (-> ${JSON.stringify(target)})`);
    }
  }
}

// ---- 2. Apps: each deployed app's entrypoint must exist --------------------
// Catches "the build ran but dist was never copied into the image".

const appEntrypoints = [
  ["apps/api", "dist/index.js"],
  ["apps/worker", "dist/index.js"],
  ["apps/websocket", "dist/index.js"],
];

for (const [app, entry] of appEntrypoints) {
  const pkgJsonPath = path.join(root, app, "package.json");
  if (!fs.existsSync(pkgJsonPath)) continue; // app not part of this image
  const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8"));
  const entryAbs = path.resolve(root, app, pkg.main ?? entry);
  if (fs.existsSync(entryAbs)) {
    checked++;
  } else {
    missing.push(`${pkg.name ?? app} entrypoint ${path.relative(root, entryAbs)}`);
  }
}

// ---- 3. Python: every service package must at least compile ----------------
// Catches a missing __init__.py or a syntax error before uvicorn boots.

const pythonPkgs = [
  "packages/analysis/src/analysis",
  "packages/retrieval/src/retrieval",
  "packages/generation/src/generation",
  "packages/mock-interview/src/mock_interview",
  "packages/codegraph-api/src/codegraph_api",
  "packages/codegraph-parser/src/codegraph_parser",
];

const pythonProbe = spawnSync("python3", ["--version"], { encoding: "utf8" });
const hasPython = !pythonProbe.error;

if (hasPython) {
  for (const dir of pythonPkgs) {
    const abs = path.join(root, dir);
    if (!fs.existsSync(abs)) {
      missing.push(`python package ${dir}`);
      continue;
    }
    const r = spawnSync("python3", ["-m", "compileall", "-q", abs], { encoding: "utf8" });
    if (r.error || r.status !== 0) {
      missing.push(`python package ${dir} (compileall failed: ${(r.stderr || r.error?.message || "").trim().slice(0, 200)})`);
    } else {
      checked++;
    }
  }
}
// No python3 in this image (Node alpine images): python packages are not
// shipped here, so their checks don't apply.

// ---- Report ----------------------------------------------------------------

if (missing.length > 0) {
  process.stderr.write("[smoke-exports] Missing subpath exports / entrypoints:\n");
  for (const m of missing) {
    process.stderr.write(`[smoke-exports]   - ${m}\n`);
  }
  process.exit(1);
}

process.stdout.write(`[smoke-exports] OK — ${checked} exports/entrypoints/packages verified\n`);
