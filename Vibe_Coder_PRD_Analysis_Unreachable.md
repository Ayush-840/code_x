# Vibe Coder — Product Requirements Document
## Fix: "Couldn't Reach the Analysis Service" on Deployed Frontend

Repo analyzed: `github.com/Ayush-840/code_x` • commit `52abb3f` • September 2026

---

## 1. Purpose of This Document

Clicking Analyze on the deployed Vercel frontend fails immediately with "Couldn't reach the analysis service." Traced to the exact code path this message comes from — it only fires when the browser's `fetch()` call itself fails, before any response is received, which narrows the cause to one of three specific, testable things rather than a vague connectivity issue.

## 2. Current State (Confirmed)

- `apps/web/src/lib/publicApi.ts` builds every API request against `process.env.NEXT_PUBLIC_API_URL`, falling back to `http://localhost:4000` if that variable isn't set.
- `NEXT_PUBLIC_*` variables are inlined into the client bundle at **build time** — if this wasn't set in Vercel's project settings when the last build ran, every visitor's browser now has `localhost:4000` compiled directly into it, which resolves to their own machine, not the Railway API.
- `vercel.json` was intentionally removed in an earlier phase of this project (to let Vercel auto-detect the Next.js build), which means this and other `NEXT_PUBLIC_*` values now depend entirely on being set manually in the Vercel dashboard — nothing in the repo enforces or checks this.
- The API's CORS configuration (`apps/api/src/app.ts`) was re-checked and is still correctly implemented from earlier work — if the cause turns out to be CORS rather than the URL, the fix is an env var value on Railway, not a code change.

## 3. Goals

- Restore working analysis on the deployed frontend.
- Make the specific cause distinguishable from the browser, rather than three different failures all producing the exact same generic message.
- Prevent a missing `NEXT_PUBLIC_API_URL` from silently shipping a `localhost` URL to production ever again.

## 4. Non-Goals

- Rewriting the CORS or auth logic — both were verified correct in this investigation; this is a configuration and error-messaging fix, not an architecture change.

## 5. Requirements

### 5.1 P0 — Restore the Connection

| ID | Requirement | Why it's P0 |
|---|---|---|
| PRD-C01 | `NEXT_PUBLIC_API_URL` must be confirmed set to the real Railway API domain in Vercel's project settings, and the frontend redeployed after confirming it. | This is the leading hypothesis and, if correct, is the entire fix — a build-time env var, so simply setting it without triggering a new build won't take effect. |
| PRD-C02 | If the URL is correct, `FRONTEND_URL` on the Railway API service must be confirmed to exactly match the deployed Vercel domain. | Second most likely cause — the CORS code is correct, but only if it's given the right origin to allow. |

### 5.2 P1 — Prevent Silent Recurrence

| ID | Requirement | Why it matters |
|---|---|---|
| PRD-C03 | A missing `NEXT_PUBLIC_API_URL` at build time should fail the build loudly, rather than silently falling back to `localhost:4000` and shipping that to every visitor. | The current fallback is a reasonable convenience for local dev, but it's the exact thing that makes a misconfigured production deploy indistinguishable from a genuinely broken backend. |
| PRD-C04 | The generic "Couldn't reach the analysis service" message should be distinguishable, at least in the browser console or a debug detail, between "request never left the browser" (DNS/connection failure) and "request was blocked" (CORS). | `fetch()` reports both as the same generic error to application code — but they have different fixes, and right now diagnosing which one occurred requires opening DevTools manually every time. |

## 6. Success Metrics

- Clicking Analyze on the live Vercel URL successfully reaches the Railway API and returns a real response (success or a structured error), not the generic connectivity message.
- Running a Vercel build with `NEXT_PUBLIC_API_URL` deliberately unset fails the build, rather than producing a working-looking deploy that's silently broken for every visitor.

## 7. Risks & Open Questions

- If Railway's API service is on a free/sleep-eligible tier, it may need a moment to wake on the first request after inactivity — worth ruling out as a slow-response (not a hard failure) contributor, distinct from the two configuration causes above.
- Once PRD-C01/C02 are confirmed and fixed, it's worth re-testing the full anonymous-analyze flow end to end on the deployed site, not just the initial POST — the WebSocket connection (`apps/web/src/lib/socket.ts`, also recently changed) depends on the same category of URL/CORS configuration and could have the identical failure mode for a different env var (`NEXT_PUBLIC_WS_URL`).
