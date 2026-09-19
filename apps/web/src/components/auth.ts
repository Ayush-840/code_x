"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getToken } from "@/lib/api";

export function useAuthRedirect(): "loading" | "authed" | "public" {
  const router = useRouter();
  const [status, setStatus] = useState<"loading" | "authed" | "public">("loading");

  useEffect(() => {
    const token = getToken();
    if (token) {
      setStatus("authed");
      return;
    }
    router.replace("/login");
    setStatus("public");
  }, [router]);

  return status;
}