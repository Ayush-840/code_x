# Vibe Coder — Technical Requirements Document
## Fix: "Couldn't Reach the Analysis Service" on Deployed Frontend

Repo analyzed: `github.com/Ayush-840/code_x` • commit `52abb3f` • September 2026

---

## 1. Confirmed Findings

```ts
// apps/web/src/lib/publicApi.ts
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

// apps/web/src/lib/socket.ts
const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "http://localhost:4001";
```

Both client-side network entry points fall back to a `localhost` URL if their respective env var isn't set. Since `NEXT_PUBLIC_*` values are inlined at build time (not read at runtime), a build run without these set in Vercel's project settings ships a bundle where every visitor's browser tries to reach their own machine — indistinguishable, from the resulting error, from the real API being down.

`apps/api/src/app.ts`'s CORS handling was re-verified against the current commit and is correct — origin matching via `config.allowedOrigins`/`config.previewPattern`, credentials enabled. This is a configuration problem, not a code-correctness problem, for the CORS half of the three original hypotheses.

## 2. Immediate Fix (P0)

### 2.1 Verify and set the Vercel env vars (resolves PRD-C01)

In the Vercel dashboard, under the project's Settings → Environment Variables, confirm both exist and point at the real Railway domains:

```
NEXT_PUBLIC_API_URL=https://<your-api-worker-service>.up.railway.app
NEXT_PUBLIC_WS_URL=https://<your-websocket-service>.up.railway.app
```

**Critical**: setting these alone does nothing to an already-built deployment — trigger a new deploy (Vercel dashboard → Deployments → Redeploy, or push any commit) so the build step re-reads them and re-inlines the correct values into the bundle.

### 2.2 Verify the Railway side (resolves PRD-C02)

On the `api-worker` Railway service's env vars, confirm:

```
FRONTEND_URL=https://<your-vercel-production-domain>
```

matches exactly what the browser's address bar shows when visiting the deployed site (including `https://`, no trailing slash) — the CORS `origin` check does an exact match against this value (plus the optional `FRONTEND_PREVIEW_PATTERN` regex for preview URLs).

## 3. Prevent Silent Recurrence (P1)

### 3.1 Fail the build loudly on a missing API URL (resolves PRD-C03)

Replace the silent fallback with a build-time assertion, in both files:

```ts
// apps/web/src/lib/publicApi.ts
const API_URL = process.env.NEXT_PUBLIC_API_URL;
if (!API_URL && process.env.NODE_ENV === "production") {
  throw new Error(
    "NEXT_PUBLIC_API_URL is not set. Set it in your Vercel project's environment variables and redeploy."
  );
}
const resolvedApiUrl = API_URL ?? "http://localhost:4000"; // dev-only fallback
```

(Same pattern for `WS_URL` in `socket.ts`.) The `NODE_ENV === "production"` guard keeps local dev's fallback working unchanged, while a genuinely misconfigured Vercel build now fails immediately and visibly in the build log — "the deploy looks successful but nothing works for any visitor" becomes "the deploy fails, with a message that says exactly what to fix" — a much shorter path from symptom to cause than what this incident actually took to diagnose.

### 3.2 Differentiate the failure in the UI (resolves PRD-C04)

`publicApi.ts`'s catch-all can distinguish the two failure shapes `fetch` actually produces:

```ts
export async function publicPost<T>(path: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${resolvedApiUrl}${path}`, { ... });
  } catch (networkErr) {
    // fetch() throws TypeError for both DNS/connection failure and CORS
    // rejection — it cannot itself tell them apart. Surface the attempted
    // URL so a report or browser console at least shows what was tried.
    throw new ApiError(0, "NETWORK_ERROR", `Could not reach ${resolvedApiUrl} — check the API is running and CORS is configured for this origin.`);
  }
  ...
}
```

This doesn't let JavaScript distinguish CORS-block from DNS-failure (the browser deliberately hides that distinction from scripts, for security reasons) — but it does put the actual attempted URL into the error, so a user or support flow reporting this error surfaces something immediately actionable instead of a generic sentence, without requiring a DevTools session every time.

## 4. Sequencing

| Step | Work | Depends on |
|---|---|---|
| 1 | Verify + fix `NEXT_PUBLIC_API_URL`/`NEXT_PUBLIC_WS_URL` in Vercel, redeploy | None — do first, likely the entire fix |
| 2 | Verify `FRONTEND_URL` on Railway matches exactly | Independent, check in parallel with step 1 |
| 3 | Build-time assertion for both env vars (3.1) | Step 1 confirmed as the actual cause |
| 4 | Surface the attempted URL in the network-error case (3.2) | Independent, can ship any time |

## 5. Acceptance Criteria

- Clicking Analyze on the live Vercel deployment successfully reaches the Railway API — verified via DevTools Network tab showing a request to the real Railway domain, not `localhost`.
- A WebSocket connection (visible as a successful `wss://` upgrade in DevTools, or the analysis-progress UI updating live) succeeds on the deployed site.
- Running `next build` locally with `NEXT_PUBLIC_API_URL` unset and `NODE_ENV=production` fails the build with a clear message, rather than succeeding silently.
- A deliberately wrong `FRONTEND_URL` on Railway produces a distinguishable CORS error in the browser console, separate from a DNS/connection failure.
