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
  console.error(err);
  fail(res, 500, "INTERNAL_ERROR", "Unexpected server error");
}