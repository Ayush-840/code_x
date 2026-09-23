import type { NextFunction, Request, Response } from "express";
import type { ApiResponse } from "@vibe-coder/shared";
import { randomUUID } from "node:crypto";

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string
  ) {
    super(message);
  }
}

export function ok<T>(res: Response, data: T, status = 200): void {
  const envelope: ApiResponse<T> = {
    ok: true,
    data,
    meta: { requestId: randomUUID(), timestamp: new Date().toISOString() },
  };
  res.status(status).json(envelope);
}

export function fail(
  res: Response,
  status: number,
  code: string,
  message: string,
  details?: unknown[]
): void {
  const envelope: ApiResponse<never> = {
    ok: false,
    error: { code, message, ...(details ? { details } : {}) },
    meta: { requestId: randomUUID(), timestamp: new Date().toISOString() },
  };
  res.status(status).json(envelope);
}

export function notFound(_req: Request, res: Response): void {
  fail(res, 404, "NOT_FOUND", "Resource does not exist");
}

/**
 * Infra outages (DB/Redis unreachable) surface as driver-specific errors with
 * no useful taxonomy. Map the recognizable ones to an honest 503 so clients
 * see "backend down, retry", not a 500 that reads like a bug — and so the
 * frontend can distinguish it from repo-URL problems.
 */
function isInfraUnavailableError(err: unknown): boolean {
  const msg = String((err as Error)?.message ?? "");
  return /ECONNREFUSED|ETIMEDOUT|ECONNRESET|Can't reach database server|P1001|Connection terminated/i.test(
    msg
  );
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof HttpError) {
    fail(res, err.status, err.code, err.message);
    return;
  }
  if (isInfraUnavailableError(err)) {
    console.error("[api] infra unavailable:", (err as Error)?.message);
    fail(
      res,
      503,
      "ANALYSIS_UNAVAILABLE",
      "The analysis backend isn't fully up right now. Your repository URL is fine — please retry in a minute."
    );
    return;
  }
  console.error(err);
  fail(res, 500, "INTERNAL_ERROR", "Unexpected server error");
}
