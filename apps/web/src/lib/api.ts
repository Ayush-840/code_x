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

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem("vtk");
}

export function setToken(token: string): void {
  window.localStorage.setItem("vtk", token);
}

export function clearTokens(): void {
  window.localStorage.removeItem("vtk");
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API_URL}/v1${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = (body as { error?: { code: string; message: string } }).error ?? {
      code: "UNKNOWN",
      message: "Request failed",
    };
    if (res.status === 401) clearTokens();
    throw new ApiError(res.status, err.code, err.message);
  }
  return (body as { data: T }).data;
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