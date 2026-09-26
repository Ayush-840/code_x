#!/usr/bin/env node
/**
 * Post-deploy smoke test: CORS + cookie flags on the deployed API/websocket.
 *
 * Catches env-var drift that silently breaks the deployed site:
 *   - FRONTEND_URL missing a Vercel domain        → requests CORS-blocked
 *   - FRONTEND_PREVIEW_PATTERN dropped/mistyped   → per-deploy `code-<hash>` URLs blocked
 *   - COOKIE_CROSS_SITE not `true`                → auth cookies dropped by the browser
 *   - disallowed origins suddenly CORS-allowed    → security regression
 *
 * What it checks
 *   1. API /health responds 200
 *   2. CORS preflight from each allowed origin → 204 + allow-origin echo + credentials
 *   3. Actual request from an allowed origin carries access-control-allow-origin
 *   4. Disallowed origin gets NO access-control headers (and no 5xx)
 *   5. GET /v1/auth/github sets oauth_state with HttpOnly; Secure; SameSite=None
 *      (fails if SameSite=Lax or Secure missing — the COOKIE_CROSS_SITE drift)
 *   6. Optional --ws: websocket /health + Socket.IO polling preflight from allowed origin
 *
 * Usage:
 *   node scripts/check-prod-cors.mjs [API_URL] [--origin <url>]... [--ws <ws_url>]
 *
 * Origins default to FRONTEND_URL (first entry) read from .env; pass --origin
 * (repeatable) to test extra per-deploy `code-<hash>` URLs explicitly.
 *
 * Env:  API_URL / WS_URL (or positional args)
 * Exit: 0 all checks pass · 1 any failure
 */
import { readFileSync, existsSync } from "node:fs";

// ---------------------------------------------------------------------------
// Args + .env defaults
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2);
let apiUrlArg = null;
let wsUrlArg = null;
const extraOrigins = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--ws") wsUrlArg = argv[++i] ?? null;
  else if (argv[i] === "--origin") extraOrigins.push(argv[++i]);
  else if (!argv[i].startsWith("--")) apiUrlArg = argv[i];
}

function readEnvVar(name) {
  for (const p of [".env", "../../.env"]) {
    if (!existsSync(p)) continue;
    const m = readFileSync(p, "utf8").match(new RegExp(`^${name}=["']?([^"'\\n\\r]*)`, "m"));
    if (m && m[1].trim()) return m[1].trim();
  }
  return null;
}

const DEFAULT_API_URL = "https://api-worker-production-a6ab.up.railway.app";
const DEFAULT_WS_URL = "https://websocket-production-0a61.up.railway.app";
const API_URL = (apiUrlArg ?? process.env.API_URL ?? DEFAULT_API_URL).replace(/\/+$/, "");
const WS_URL = (wsUrlArg ?? process.env.WS_URL ?? DEFAULT_WS_URL).replace(/\/+$/, "");

// Allowed origins to probe: --origin extras, plus .env FRONTEND_URL entries —
// but only when probing a local API. A local .env lists localhost origins,
// which a deployed API correctly rejects; using them against prod produces
// false failures. For deployed APIs pass the real Vercel origins via --origin.
const isLocalApi = /^https?:\/\/localhost(:\d+)?$/.test(API_URL);
const envFrontend = isLocalApi ? readEnvVar("FRONTEND_URL") : null;
const origins = [
  ...(envFrontend ? envFrontend.split(",").map((o) => o.trim()).filter(Boolean) : []),
  ...extraOrigins,
];
const EVIL = "https://cors-probe-disallowed.example";

const log = (...a) => console.log(...a);
const indent = (...a) => console.log("   ", ...a);

const checks = [];
const record = (name, ok, detail = "") => checks.push([name, ok, detail]);
let anyFail = false;
const judge = (name, ok, detail = "") => {
  record(name, ok, detail);
  if (!ok) anyFail = true;
};

function corsHeaders(res) {
  const h = {};
  for (const [k, v] of res.headers) if (k.toLowerCase().startsWith("access-control")) h[k.toLowerCase()] = v;
  return h;
}

// ---------------------------------------------------------------------------
// 1. API reachable
// ---------------------------------------------------------------------------
let apiUp = false;
try {
  const res = await fetch(`${API_URL}/health`, { redirect: "manual" });
  apiUp = res.ok;
  judge(`GET ${API_URL}/health`, apiUp, `HTTP ${res.status}`);
} catch (e) {
  judge(`GET ${API_URL}/health`, false, e.message);
}

// ---------------------------------------------------------------------------
// 2 + 3 + 4. CORS behavior
// ---------------------------------------------------------------------------
async function preflight(origin) {
  return fetch(`${API_URL}/v1/repos`, {
    method: "OPTIONS",
    headers: { Origin: origin, "Access-Control-Request-Method": "GET" },
  });
}

if (apiUp && origins.length > 0) {
  for (const origin of origins) {
    try {
      const res = await preflight(origin);
      const h = corsHeaders(res);
      const ok =
        res.status === 204 &&
        h["access-control-allow-origin"] === origin &&
        h["access-control-allow-credentials"] === "true";
      judge(
        `preflight from ${origin}`,
        ok,
        ok ? "204 + origin echo + credentials" : `HTTP ${res.status}, allow-origin=${h["access-control-allow-origin"] ?? "(none)"}`
      );

      // 3. Actual (non-preflight) request — this is what the browser's fetch sees
      const res2 = await fetch(`${API_URL}/v1/repos`, { headers: { Origin: origin } });
      const h2 = corsHeaders(res2);
      judge(
        `actual request from ${origin} carries CORS headers`,
        h2["access-control-allow-origin"] === origin,
        `HTTP ${res2.status}, allow-origin=${h2["access-control-allow-origin"] ?? "(none)"}`
      );
    } catch (e) {
      judge(`preflight from ${origin}`, false, e.message);
    }
  }
} else if (apiUp) {
  indent("no origins to probe — pass --origin or set FRONTEND_URL in .env");
}

if (apiUp) {
  // 4. Disallowed origin: headers must be absent (scanner traffic gets a normal
  // response without CORS headers, so the browser blocks it client-side)
  try {
    const res = await preflight(EVIL);
    const h = corsHeaders(res);
    judge(
      `disallowed origin (${EVIL}) gets no CORS headers`,
      !h["access-control-allow-origin"] && res.status < 500,
      `HTTP ${res.status}, allow-origin=${h["access-control-allow-origin"] ?? "(none)"}`
    );
  } catch (e) {
    judge(`disallowed origin probe`, false, e.message);
  }
}

// ---------------------------------------------------------------------------
// 5. Cookie flags (COOKIE_CROSS_SITE drift) + authorize redirect shape
// ---------------------------------------------------------------------------
if (apiUp) {
  try {
    const res = await fetch(`${API_URL}/v1/auth/github`, { redirect: "manual" });
    const setCookie = res.headers.get("set-cookie") ?? "";
    const location = res.headers.get("location") ?? "";

    const hasOauthState = setCookie.includes("oauth_state=");
    judge("authorize step sets oauth_state cookie", hasOauthState, hasOauthState ? "" : "no set-cookie");

    if (hasOauthState) {
      const flags = setCookie.toLowerCase();
      judge("oauth_state is HttpOnly", flags.includes("httponly"), "");
      // Cross-site Vercel → Railway needs SameSite=None; Secure. If the live
      // service was deployed with COOKIE_CROSS_SITE unset/absent, cookies come
      // back SameSite=Lax and the browser silently drops them after the OAuth
      // redirect — "works locally, signed out in prod". Localhost → localhost
      // is same-site, so Lax is correct there and COOKIE_CROSS_SITE is
      // intentionally unset; only deployed APIs must be cross-site.
      const crossSite = flags.includes("samesite=none") && flags.includes("secure");
      if (isLocalApi) {
        judge(
          "oauth_state cookie sane for local dev (SameSite=Lax, not None)",
          flags.includes("samesite=lax"),
          flags.includes("samesite=lax") ? "" : "unexpected — local .env should not set COOKIE_CROSS_SITE=true"
        );
      } else {
        judge(
          "oauth_state is cross-site (SameSite=None; Secure)",
          crossSite,
          crossSite ? "" : "browser will drop this cookie after the GitHub redirect — set COOKIE_CROSS_SITE=true"
        );
      }
    }

    const loc = new URL(location);
    judge(
      "authorize redirect_uri present and points at this API",
      Boolean(loc.searchParams.get("redirect_uri")),
      loc.searchParams.get("redirect_uri") ?? "(absent)"
    );
  } catch (e) {
    judge("cookie/authorize probe", false, e.message);
  }
}

// ---------------------------------------------------------------------------
// 6. Optional websocket probe
// ---------------------------------------------------------------------------
if (wsUrlArg || process.env.WS_URL || (apiUp && WS_URL)) {
  let wsUp = false;
  try {
    const res = await fetch(`${WS_URL}/health`);
    wsUp = res.ok;
    judge(`GET ${WS_URL}/health`, wsUp, `HTTP ${res.status}`);
  } catch (e) {
    judge(`GET ${WS_URL}/health`, false, e.message);
  }
  if (wsUp && origins.length > 0) {
    try {
      const res = await fetch(
        `${WS_URL}/socket.io/?EIO=4&transport=polling`,
        { method: "OPTIONS", headers: { Origin: origins[0], "Access-Control-Request-Method": "GET" } }
      );
      const h = corsHeaders(res);
      judge(
        `websocket preflight from ${origins[0]}`,
        res.status === 204 && h["access-control-allow-origin"] === origins[0],
        `HTTP ${res.status}, allow-origin=${h["access-control-allow-origin"] ?? "(none)"}`
      );
    } catch (e) {
      judge("websocket preflight", false, e.message);
    }
  }
}

// ---------------------------------------------------------------------------
// Verdict
// ---------------------------------------------------------------------------
log("\n──────── CORS + cookie smoke ────────");
for (const [name, ok, detail = ""] of checks) log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);

if (anyFail) {
  log("\nFix hints: FRONTEND_URL must list every visitor-facing Vercel domain");
  log("(comma-separated, exact, https://, no trailing slash) on BOTH api-worker");
  log("and websocket. FRONTEND_PREVIEW_PATTERN must allow per-deploy code-<hash>");
  log("URLs on both too. COOKIE_CROSS_SITE=true on api-worker. Full matrix:");
  log("VIBE_CODER_ENV_MATRIX.md");
}
process.exit(anyFail ? 1 : 0);
