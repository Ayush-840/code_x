"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { isAuthenticated } from "@/lib/api";

export function useAuthRedirect(): "loading" | "authed" | "public" {
  const router = useRouter();
  const [status, setStatus] = useState<"loading" | "authed" | "public">("loading");

  useEffect(() => {
    if (isAuthenticated()) {
      setStatus("authed");
      return;
    }
    router.replace("/login");
    setStatus("public");
  }, [router]);

  return status;
}
