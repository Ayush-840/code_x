import jwt from "jsonwebtoken";
import "dotenv/config";

export const JWT_SECRET =
  process.env.JWT_SECRET ?? "local-dev-jwt-secret-min-32-chars-long!!";

export interface AuthPayload {
  userId: string;
  githubId?: number;
}

export function verifyToken(token: string | undefined): AuthPayload {
  if (!token) {
    throw new Error("UNAUTHORIZED");
  }
  const payload = jwt.verify(token, JWT_SECRET) as AuthPayload;
  if (!payload.userId) {
    throw new Error("UNAUTHORIZED");
  }
  return payload;
}