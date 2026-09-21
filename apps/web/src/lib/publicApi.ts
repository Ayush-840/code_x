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

export async function publicPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = (json as { error?: { code: string; message: string } }).error ?? {
      code: "UNKNOWN",
      message: "Request failed",
    };
    throw new ApiError(res.status, err.code, err.message);
  }
  return (json as { data: T }).data;
}

export async function publicGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = (json as { error?: { code: string; message: string } }).error ?? {
      code: "UNKNOWN",
      message: "Request failed",
    };
    throw new ApiError(res.status, err.code, err.message);
  }
  return (json as { data: T }).data;
}
