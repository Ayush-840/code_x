import { useMemo } from "react";
import { API_URL, ApiError } from "./publicApi";

// Re-exported so consumers (e.g. the login page's OAuth entry point) use this
// single guarded resolution instead of re-deriving a silent localhost fallback.
export { API_URL };

// Single shared error type across public + authed flows, so `instanceof`
// checks work regardless of which module threw.
export { ApiError };

/**
 * Check if the user is authenticated by calling /v1/auth/me.
 * This is the only reliable way to check auth state with httpOnly cookies.
 */
export async function isAuthenticated(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  try {
    const res = await fetch(`${API_URL}/v1/auth/me`, {
      credentials: "include",
    });
    return res.ok;
  } catch {
    return false;
  }
}

// Exported for tests (and any caller needing the raw authed request).
export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/v1${path}`, {
      ...init,
      credentials: "include", // send cookies
      headers: {
        "Content-Type": "application/json",
        ...init.headers,
      },
    });
  } catch {
    // Same PRD-C04 handling as publicApi.ts: fetch() cannot distinguish
    // DNS/connection failure from CORS rejection, so surface the attempted
    // URL to make error reports immediately actionable.
    throw new ApiError(
      0,
      "NETWORK_ERROR",
      `Could not reach ${API_URL} — check the API is running and CORS is configured for this origin.`
    );
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = (body as { error?: { code: string; message: string } }).error ?? {
      code: "UNKNOWN",
      message: "Request failed",
    };
    throw new ApiError(res.status, err.code, err.message);
  }
  return (body as { data: T }).data;
}

export async function refreshTokens(): Promise<boolean> {
  try {
    await request("/auth/refresh", { method: "POST" });
    return true;
  } catch {
    return false;
  }
}

export async function logout(): Promise<void> {
  try {
    await request("/auth/logout", { method: "DELETE" });
  } catch {
    // ignore errors on logout
  }
  if (typeof window !== "undefined") {
    window.location.href = "/login";
  }
}

export function useAuthedFetch() {
  // Memoized so the returned client keeps a stable identity across renders
  // (TRD-F02): effects and memoized callbacks that depend on it must not
  // re-fire on every parent render — that re-firing was the File Graph
  // flicker amplifier.
  return useMemo(
    () => ({
      get: <T,>(path: string) => request<T>(path),
      post: <T,>(path: string, body?: unknown) =>
        request<T>(path, { method: "POST", body: JSON.stringify(body ?? {}) }),
      patch: <T,>(path: string, body?: unknown) =>
        request<T>(path, { method: "PATCH", body: JSON.stringify(body ?? {}) }),
      del: <T,>(path: string) => request<T>(path, { method: "DELETE" }),
    }),
    []
  );
}
