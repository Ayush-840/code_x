"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { isAuthenticated } from "@/lib/api";

export function useAuthRedirect(): "loading" | "authed" | "public" {
  const router = useRouter();
  const [status, setStatus] = useState<"loading" | "authed" | "public">("loading");

  useEffect(() => {
    isAuthenticated().then((authed) => {
      if (authed) {
        setStatus("authed");
      } else {
        router.replace("/login");
        setStatus("public");
      }
    });
  }, [router]);

  return status;
}
