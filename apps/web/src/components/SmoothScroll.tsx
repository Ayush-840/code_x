"use client";

import { useEffect, useState } from "react";
import { ReactLenis } from "lenis/react";

/**
 * Site-wide smooth scroll (UI Revamp Manual §3.1): Lenis wrapped once around
 * the app so scroll-driven work feels physical. Respects prefers-reduced-
 * motion — Lenis does not do this automatically — by disabling smoothing and
 * easing entirely when the user asked for less motion.
 */
export function SmoothScroll({ children }: { children: React.ReactNode }) {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  return (
    <ReactLenis
      root
      options={{
        lerp: reduced ? 1 : 0.1,
        duration: reduced ? 0 : 1.2,
        smoothWheel: !reduced,
      }}
    >
      {children}
    </ReactLenis>
  );
}
