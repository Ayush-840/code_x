const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function isAuthenticated(): boolean {
  if (typeof window === "undefined") return false;
  // httpOnly cookies are sent automatically; we can't read them directly.
  // Instead, try a lightweight request to check.
  return document.cookie.includes("access_token=");
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_URL}/v1${path}`, {
    ...init,
    credentials: "include", // send cookies
    headers: {
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
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
  return {
    get: <T,>(path: string) => request<T>(path),
    post: <T,>(path: string, body?: unknown) =>
      request<T>(path, { method: "POST", body: JSON.stringify(body ?? {}) }),
    patch: <T,>(path: string, body?: unknown) =>
      request<T>(path, { method: "PATCH", body: JSON.stringify(body ?? {}) }),
    del: <T,>(path: string) => request<T>(path, { method: "DELETE" }),
  };
}
