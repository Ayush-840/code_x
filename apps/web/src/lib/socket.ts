"use client";

import { useEffect, useRef } from "react";
import { io, type Socket } from "socket.io-client";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "http://localhost:4001";

export function useSocket(): Socket | null {
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    // Cookie-based auth: httpOnly cookies are sent automatically with withCredentials
    const socket = io(WS_URL, {
      withCredentials: true,
      transports: ["websocket"],
    });
    socketRef.current = socket;
    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

  return socketRef.current;
}
