import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config";
import { HttpError } from "./errors";

export interface AuthedRequest extends Request {
  userId?: string;
  githubId?: number;
}

export function requireAuth(
  req: AuthedRequest,
  _res: Response,
  next: NextFunction
): void {
  // Read token from httpOnly cookie (set during OAuth callback)
  const token = req.cookies?.access_token;
  if (!token) {
    throw new HttpError(401, "UNAUTHORIZED", "Missing or invalid authentication token");
  }
  try {
    const payload = jwt.verify(token, config.jwtSecret) as {
      sub: string;
      githubId: number;
    };
    req.userId = payload.sub;
    req.githubId = payload.githubId;
    next();
  } catch (e) {
    if (e instanceof jwt.TokenExpiredError) {
      throw new HttpError(401, "TOKEN_EXPIRED", "JWT has expired; refresh required");
    }
    throw new HttpError(401, "UNAUTHORIZED", "Missing or invalid authentication token");
  }
}
