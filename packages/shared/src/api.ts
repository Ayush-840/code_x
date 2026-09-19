export interface ApiEnvelope<T> {
  ok: true;
  data: T;
  meta: { requestId: string; timestamp: string };
}

export interface ApiError {
  ok: false;
  error: { code: string; message: string; details?: unknown[] };
  meta: { requestId: string; timestamp: string };
}

export type ApiResponse<T> = ApiEnvelope<T> | ApiError;
