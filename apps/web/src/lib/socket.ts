"use client";

import { useEffect, useRef } from "react";
import { io, type Socket } from "socket.io-client";
import { getToken } from "./api";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "http://localhost:4001";

export function useSocket(): Socket | null {
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    const token = getToken();
    const socket = io(WS_URL, {
      auth: { token },
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