/**
 * Resolves the API base URL for the anonymous public flow.
 *
 * NEXT_PUBLIC_* vars are inlined at build time: a Vercel build run without
 * NEXT_PUBLIC_API_URL set would silently ship `http://localhost:4000` into the
 * bundle, where every visitor's browser resolves it to their own machine —
 * indistinguishable, from the resulting error, from the API being down
 * (PRD-C03). Fail loudly instead; the localhost fallback remains dev-only.
 *
 * Callers MUST pass `process.env.NEXT_PUBLIC_API_URL` / `process.env.NODE_ENV`
 * as direct static member expressions — Next.js inlines exactly those (and
 * only those) into client bundles, so routing them through an env object
 * defeats inlining and silently reintroduces the localhost fallback.
 */
export function resolveApiUrl(
  rawUrl: string | undefined,
  nodeEnv: string | undefined
): string {
  if (!rawUrl && nodeEnv === "production") {
    throw new Error(
      "NEXT_PUBLIC_API_URL is not set. Set it in your Vercel project's environment variables and redeploy."
    );
  }
  return rawUrl ?? "http://localhost:4000";
}

/**
 * The guarded API base URL — exported so other modules (lib/api.ts, the login
 * page's OAuth entry point) reuse this single resolution instead of each
 * re-deriving their own silent localhost fallback (PRD-C03).
 */
export const API_URL = resolveApiUrl(
  process.env.NEXT_PUBLIC_API_URL,
  process.env.NODE_ENV
);

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function request<T>(path: string, init: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, init);
  } catch {
    // fetch() throws TypeError for both DNS/connection failure and CORS
    // rejection — scripts cannot tell them apart (the browser hides that
    // distinction deliberately). Surface the attempted URL so an error report
    // is immediately actionable instead of a generic sentence (PRD-C04).
    throw new ApiError(
      0,
      "NETWORK_ERROR",
      `Could not reach ${API_URL} — check the API is running and CORS is configured for this origin.`
    );
  }
  const json = await res.json().catch(() => ({}));
  // 202 GRAPH_GENERATING ships an ok:false envelope with a 2xx status: HTTP
  // "accepted, not ready". Branching only on !res.ok silently resolved the
  // promise with data:undefined and the CodeGraph tab spun forever with no
  // message. Surface non-ok envelopes as errors regardless of status so the
  // caller's 202-polling branch can run.
  if (!res.ok || json.ok === false) {
    const err = (json as { error?: { code: string; message: string } }).error ?? {
      code: "UNKNOWN",
      message: "Request failed",
    };
    throw new ApiError(res.status, err.code, err.message);
  }
  return (json as { data: T }).data;
}

export async function publicPost<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function publicGet<T>(path: string): Promise<T> {
  return request<T>(path, {});
}
