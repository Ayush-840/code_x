"use client";

import { useEffect, useState } from "react";
import { io, type Socket } from "socket.io-client";

/**
 * Resolves the WebSocket base URL for the shared socket.
 *
 * Same build-time guard as publicApi.ts (PRD-C03): NEXT_PUBLIC_* values are
 * inlined at build time, so a production build without NEXT_PUBLIC_WS_URL set
 * would silently ship `http://localhost:4001` into every visitor's bundle.
 * Fail the build loudly instead; the localhost fallback stays dev-only.
 *
 * Callers MUST pass `process.env.NEXT_PUBLIC_WS_URL` / `process.env.NODE_ENV`
 * as direct static member expressions — Next.js inlines exactly those (and
 * only those) into client bundles, so routing them through an env object
 * defeats inlining and silently reintroduces the localhost fallback.
 */
export function resolveWsUrl(
  rawUrl: string | undefined,
  nodeEnv: string | undefined
): string {
  if (!rawUrl && nodeEnv === "production") {
    throw new Error(
      "NEXT_PUBLIC_WS_URL is not set. Set it in your Vercel project's environment variables and redeploy."
    );
  }
  return rawUrl ?? "http://localhost:4001";
}

const WS_URL = resolveWsUrl(
  process.env.NEXT_PUBLIC_WS_URL,
  process.env.NODE_ENV
);

/**
 * Returns the shared socket with a stable identity: `null` until connected,
 * then the same Socket instance for the lifetime of the page (TRD-F02).
 *
 * The previous ref-based version read `socketRef.current` during render, so
 * consumers saw an object whose identity changed arbitrarily and effects keyed
 * on it re-registered listeners / re-emitted `repo:join` on unrelated renders
 * — the reconnect-churn half of the File Graph flicker incident.
 */
export function useSocket(): Socket | null {
  const [socket, setSocket] = useState<Socket | null>(null);

  useEffect(() => {
    // Cookie-based auth: httpOnly cookies are sent automatically with withCredentials
    const s = io(WS_URL, {
      withCredentials: true,
      transports: ["websocket"],
    });
    setSocket(s);
    return () => {
      s.disconnect();
      setSocket(null);
    };
  }, []);

  return socket;
}
