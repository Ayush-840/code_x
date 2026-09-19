import jwt from "jsonwebtoken";
import { createHash } from "node:crypto";
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { existsSync } from "node:fs";

// Load .env — try CWD first, then walk up to workspace root
const rootEnv = resolve(process.cwd(), ".env");
const workspaceRoot = resolve(process.cwd(), "../../.env");
for (const p of [rootEnv, workspaceRoot]) {
  if (existsSync(p)) {
    loadEnv({ path: p });
    break;
  }
}

export const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  console.error("[FATAL] Missing JWT_SECRET environment variable");
  process.exit(1);
}

export interface AuthPayload {
  userId: string;
  githubId?: number;
}

export function verifyToken(token: string | undefined): AuthPayload {
  if (!token) {
    throw new Error("UNAUTHORIZED");
  }
  const payload = jwt.verify(token, JWT_SECRET!) as AuthPayload;
  if (!payload.userId) {
    throw new Error("UNAUTHORIZED");
  }
  return payload;
}

export function extractTokenFromCookie(
  cookieHeader: string | undefined
): string | undefined {
  if (!cookieHeader) return undefined;
  const cookies = cookieHeader.split(";").map((c) => c.trim());
  for (const cookie of cookies) {
    const [name, ...rest] = cookie.split("=");
    if (name === "access_token") {
      return rest.join("=");
    }
  }
  return undefined;
}
