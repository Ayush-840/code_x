"use client";

import { useEffect, useState } from "react";
import { io, type Socket } from "socket.io-client";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "http://localhost:4001";

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
