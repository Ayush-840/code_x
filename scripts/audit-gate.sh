#!/usr/bin/env bash
# Dependency-audit gate: catch deploy-blocking dependency states at push time
# instead of discovering them when Railway refuses the build.
#
# Policy derived from the 2026-09-23 incident (evidence, not guesswork):
#   - Railway BLOCKED the build for next@14.2.3: a DIRECT production dep with a
#     patched release in the same major line (14.2.35).
#   - Railway TOLERATED, in the same lockfile: transitive deps with same-major
#     fixes (postcss@8.4.31, lodash-es@4.17.23) and advisories needing a major
#     upgrade (next@14.2.35, fixes only in >=15.x).
#
# So this gate FAILS when a high/critical advisory affects a DIRECT prod dep
# and has a same-major patch:
#   - If refreshing the lockfile within declared ranges fixes it -> stale
#     lockfile; the refreshed pnpm-lock.yaml is left on disk to commit.
#   - Otherwise the package.json pin must be bumped (suggestions printed).
# Everything else (transitive in-major fixes, major upgrades) passes with a
# warning and a suggested fix.
#
# Usage: pnpm audit:gate   (or: bash scripts/audit-gate.sh)
set -euo pipefail
cd "$(dirname "$0")/.."

LOCKFILE="pnpm-lock.yaml"
BACKUP="${LOCKFILE}.audit-gate.bak"

cleanup() { rm -f "$BACKUP"; }
trap cleanup EXIT

# Classify audit findings.
#   argv[1] = `pnpm audit --prod --json` output
#   argv[2] = `pnpm -r ls --depth 0 --prod --json` output (direct deps)
# Note: on pnpm 8 audit findings[].paths is empty, so "direct dep" detection
# comes from the workspace listing, not from audit paths.
classify() {
  node -e '
    const [auditRaw, lsRaw] = process.argv.slice(1);
    const out = { blockable: [], warnable: [] };
    try {
      const direct = new Set();
      for (const pkg of JSON.parse(lsRaw)) {
        for (const name of Object.keys(pkg.dependencies || {})) direct.add(name);
      }
      const audit = JSON.parse(auditRaw);
      for (const a of Object.values(audit.advisories || {})) {
        if (!["high", "critical"].includes(a.severity)) continue;
        const literals =
          String(a.patched_versions || "").match(/\d+\.\d+\.\d+(?:-[\w.]+)?/g) || [];
        const maxPatchedMajor = literals.reduce(
          (m, v) => Math.max(m, parseInt(v, 10)), 0
        );
        const entry = {
          id: a.github_advisory_id,
          module: a.module_name,
          severity: a.severity,
          url: a.url,
        };
        let sameMajorFix = false;
        for (const f of a.findings || []) {
          if (!entry.installed) entry.installed = f.version;
          if (maxPatchedMajor > 0 && parseInt(f.version, 10) === maxPatchedMajor) {
            sameMajorFix = true;
            entry.patched = literals.join(", ");
          }
        }
        if (!entry.installed) entry.installed = "?";
        if (sameMajorFix && direct.has(a.module_name)) out.blockable.push(entry);
        else out.warnable.push(entry);
      }
    } catch {}
    process.stdout.write(JSON.stringify(out));
  ' "$1" "$2"
}

collect() { # -> "AUDIT_JSON\x1fLS_JSON" (unit separator keeps both intact)
  local audit ls
  audit="$(pnpm audit --prod --json 2>/dev/null || true)"
  ls="$(pnpm -r ls --depth 0 --prod --json 2>/dev/null || echo '[]')"
  printf '%s\x1f%s' "$audit" "$ls"
}

field() { # $1 = combined payload, $2 = "audit"|"ls"
  node -e '
    const [audit, ls] = process.argv[1].split("\x1f");
    process.stdout.write(process.argv[2] === "audit" ? audit : ls);
  ' "$1" "$2"
}

arr_len() { node -e 'process.stdout.write(String(JSON.parse(process.argv[1]).length))' "$1"; }

print_list() { # $1 = json array
  node -e '
    for (const a of JSON.parse(process.argv[1])) {
      console.error(`  [${a.severity.toUpperCase()}] ${a.module}@${a.installed} — ${a.id}`);
      if (a.patched) console.error(`      same-major fix: ${a.patched}  (${a.url})`);
      else console.error(`      fix requires major upgrade  (${a.url})`);
    }
  ' "$1" >&2
}

echo "[audit-gate] auditing production dependencies (high+ severity)..."
PAYLOAD="$(collect)"
RESULT="$(classify "$(field "$PAYLOAD" audit)" "$(field "$PAYLOAD" ls)")"
BLOCKABLE="$(node -e 'process.stdout.write(JSON.stringify(JSON.parse(process.argv[1]).blockable))' "$RESULT")"
WARNABLE="$(node -e 'process.stdout.write(JSON.stringify(JSON.parse(process.argv[1]).warnable))' "$RESULT")"

if [ "$(arr_len "$BLOCKABLE")" = "0" ]; then
  echo "[audit-gate] no deploy-blocking advisories (direct deps with same-major fixes)."
  if [ "$(arr_len "$WARNABLE")" != "0" ]; then
    echo "[audit-gate] PASS (with warnings) — tolerated by Railway today, but track:"
    print_list "$WARNABLE"
  else
    echo "[audit-gate] PASS — no high/critical advisories in production deps."
  fi
  exit 0
fi

echo "[audit-gate] direct prod deps with same-major fixes available"
echo "[audit-gate] (the class that got our deploys BLOCKED):"
print_list "$BLOCKABLE"

# Free fix first: refresh the lockfile within the declared ranges.
cp "$LOCKFILE" "$BACKUP"
STILL_BLOCKED="unknown"
if pnpm install --lockfile-only --ignore-scripts >/dev/null 2>&1; then
  AFTER_PAYLOAD="$(collect)"
  AFTER="$(classify "$(field "$AFTER_PAYLOAD" audit)" "$(field "$AFTER_PAYLOAD" ls)")"
  STILL_BLOCKED="$(node -e '
    process.stdout.write(String(JSON.parse(process.argv[1]).blockable.length > 0));
  ' "$AFTER")"
fi

if [ "$STILL_BLOCKED" = "false" ]; then
  echo
  echo "[audit-gate] FAIL — stale lockfile. A refresh within your declared"
  echo "[audit-gate] version ranges clears the advisories above; this is what"
  echo "[audit-gate] makes Railway block the build."
  echo "[audit-gate] Fix: commit the refreshed pnpm-lock.yaml (left on disk):"
  git --no-pager diff --stat -- "$LOCKFILE" >&2 || true
  exit 1
fi

mv "$BACKUP" "$LOCKFILE"
echo
echo "[audit-gate] FAIL — vulnerable versions are pinned in package.json;"
echo "[audit-gate] a lockfile refresh cannot fix them, and Railway WILL"
echo "[audit-gate] block the build. Fix: bump the pins to the patched"
echo "[audit-gate] versions listed above (pnpm add pkg@^<fixed>)."
exit 1
