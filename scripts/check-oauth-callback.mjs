#!/usr/bin/env node
/**
 * Post-deploy health check: GitHub OAuth redirect_uri ↔ registered callback.
 *
 * GitHub shows "The redirect_uri is not associated with this application"
 * when the redirect_uri this API sends in the authorize step does not equal
 * the Callback URL saved on the GitHub App / OAuth App — which silently
 * happens after Railway regenerates the api-worker domain. This script
 * catches that the moment it exists, without needing GitHub auth.
 *
 * What it checks
 *   1. API health endpoint responds 200
 *   2. GET /v1/auth/github 302s to github.com with the expected client_id
 *   3. The authorize redirect_uri equals <API>/v1/auth/github/callback
 *      (or --callback, when the app's registered callback differs from the
 *      API origin, e.g. GITHUB_REDIRECT_URI)
 *   4. Encoding is byte-exact: scheme, host, path, no trailing slash,
 *      nothing lost to double-encoding
 *
 * What it cannot check (GitHub validates redirect_uri only for a logged-in
 * browser session, so unauthenticated curl always sees a 302 to login):
 *   - that the callback is actually saved on the GitHub App
 *   Pass the registered callback with --callback to compare it against
 *   what the deployed API sends — copy it from
 *   github.com → Settings → Developer settings → GitHub Apps (Iv23… ids)
 *   or OAuth Apps (hex ids).
 *
 * Usage:
 *   node scripts/check-oauth-callback.mjs [API_URL]
 *   node scripts/check-oauth-callback.mjs [API_URL] --callback https://…/v1/auth/github/callback
 *
 * Env:  API_URL (or the first positional arg) — default: production api-worker
 * Exit: 0 all checks pass · 1 mismatch/failure
 */
import { URL } from "node:url";

const DEFAULT_API_URL = "https://api-worker-production-a6ab.up.railway.app";
const CLIENT_ID = process.env.GITHUB_CLIENT_ID ?? null;

// ---------------------------------------------------------------------------
// Args: [apiUrl] [--callback <url>]
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2);
let apiUrlArg = null;
let expectedCallback = null;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--callback") {
    expectedCallback = argv[++i] ?? null;
  } else if (!argv[i].startsWith("--")) {
    apiUrlArg = argv[i];
  }
}
const API_URL = (apiUrlArg ?? process.env.API_URL ?? DEFAULT_API_URL).replace(/\/+$/, "");
const CALLBACK_PATH = "/v1/auth/github/callback";

const log = (...a) => console.log(...a);
const indent = (...a) => console.log("   ", ...a);

const checks = [];
const record = (name, ok, detail = "") => checks.push([name, ok, detail]);

// ---------------------------------------------------------------------------
// 1. API reachable
// ---------------------------------------------------------------------------
let apiUp = false;
try {
  const res = await fetch(`${API_URL}/health`, { redirect: "manual" });
  apiUp = res.ok;
  record(
    `GET ${API_URL}/health`,
    apiUp,
    `HTTP ${res.status}`
  );
} catch (e) {
  record(`GET ${API_URL}/health`, false, e.message);
}

// ---------------------------------------------------------------------------
// 2 + 3. Authorize redirect shape
// ---------------------------------------------------------------------------
let authorizeUrl = null;
if (apiUp) {
  try {
    const res = await fetch(`${API_URL}/v1/auth/github`, { redirect: "manual" });
    const location = res.headers.get("location");
    record(
      "GET /v1/auth/github redirects (302)",
      res.status === 302 && Boolean(location),
      `HTTP ${res.status}${location ? "" : " — no Location header"}`
    );

    if (location) {
      authorizeUrl = new URL(location);
      const params = authorizeUrl.searchParams;

      // 2. lands on github.com's authorize endpoint
      record(
        "redirect lands on github.com/login/oauth/authorize",
        authorizeUrl.origin === "https://github.com" &&
          authorizeUrl.pathname === "/login/oauth/authorize",
        `${authorizeUrl.origin}${authorizeUrl.pathname}`
      );

      // client_id — compared only when GITHUB_CLIENT_ID is provided
      const clientId = params.get("client_id");
      if (CLIENT_ID) {
        record(
          "client_id matches GITHUB_CLIENT_ID",
          clientId === CLIENT_ID,
          clientId ? `${clientId.slice(0, 5)}…` : "(absent)"
        );
      } else {
        indent(`client_id: ${clientId ?? "(absent)"} — set GITHUB_CLIENT_ID to compare`);
      }

      // 3. redirect_uri present and equals the expected callback
      const redirectUri = params.get("redirect_uri");
      if (!redirectUri) {
        record(
          "authorize request carries a redirect_uri",
          false,
          "GitHub falls back to the app's registered callback — fine only if that is exactly where the API can receive /v1/auth/github/callback"
        );
      } else {
        const expected = expectedCallback ?? `${API_URL}${CALLBACK_PATH}`;
        const normalize = (u) => u.trim().replace(/\/+$/, "");
        record(
          `redirect_uri == expected callback`,
          normalize(redirectUri) === normalize(expected),
          redirectUri
        );
        if (expectedCallback) {
          indent(`registered callback (from --callback): ${expectedCallback}`);
        }
      }
    }
  } catch (e) {
    record("GET /v1/auth/github", false, e.message);
  }
}

// ---------------------------------------------------------------------------
// 4. Byte-exactness of the redirect_uri encoding
// ---------------------------------------------------------------------------
if (authorizeUrl) {
  const raw = authorizeUrl.searchParams.get("redirect_uri");
  if (raw) {
    // The Location header URL-encodes the param once (":" → %3A, "/" → %2F).
    // Pull it back out of the raw header form so we can see real encoding
    // damage (double-encoding, spaces, bare unicode) rather than URL's
    // silent re-decode.
    const res = await fetch(`${API_URL}/v1/auth/github`, { redirect: "manual" });
    const rawLocation = res.headers.get("location") ?? "";
    const match = rawLocation.match(/[?&]redirect_uri=([^&]+)/);
    const encoded = match ? match[1] : "";
    const roundTrips =
      encoded &&
      decodeURIComponent(encoded) === raw &&
      encoded === encodeURIComponent(raw);
    record(
      "redirect_uri encoding is byte-exact",
      Boolean(roundTrips),
      roundTrips ? `${decodeURIComponent(encoded)}` : `raw form: ${encoded || "(not found)"}`
    );
  }
}

// ---------------------------------------------------------------------------
// Verdict
// ---------------------------------------------------------------------------
log("\n──────── OAuth callback health ────────");
let pass = true;
for (const [name, ok, detail = ""] of checks) {
  log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) pass = false;
}

if (!pass) {
  log("\nFix: the redirect_uri above must equal the Callback URL saved on the");
  log("GitHub App byte-for-byte (https://, no trailing slash, full");
  log("/v1/auth/github/callback path). After any Railway domain change, re-copy");
  log("the new domain into github.com → Settings → Developer settings →");
  log("GitHub Apps and save — or pin it with GITHUB_REDIRECT_URI on api-worker.");
} else if (expectedCallback) {
  log("\n✅ The deployed redirect_uri matches the registered callback you provided.");
  log("   GitHub-side mismatch is ruled out — sign in end-to-end to confirm.");
} else {
  log("\n⚠ The API sends a self-consistent redirect_uri, but this script cannot");
  log("  see the callback saved on the GitHub App (GitHub only validates it for");
  log("  a logged-in browser). Re-run with --callback <url copied from the app's");
  log("  settings> to close that gap.");
}

process.exit(pass ? 0 : 1);
