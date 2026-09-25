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
  // The API signs session JWTs with the standard `sub` claim; only test
  // helpers used `userId`. Requiring `userId` rejected every real session
  // token, so the websocket handshake failed with UNAUTHORIZED for all
  // production users — `repo:join` never landed and analysis progress never
  // arrived. Accept both spellings.
  const payload = jwt.verify(token, JWT_SECRET!) as {
    sub?: string;
    userId?: string;
    githubId?: number;
  };
  const userId = payload.userId ?? payload.sub;
  if (!userId) {
    throw new Error("UNAUTHORIZED");
  }
  return { userId, githubId: payload.githubId };
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
