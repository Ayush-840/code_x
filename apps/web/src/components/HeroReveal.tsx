"use client";

import { useEffect, useRef } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText } from "gsap/SplitText";

gsap.registerPlugin(ScrollTrigger, SplitText, useGSAP);

/**
 * Hero text reveal (UI Revamp Manual §4.1): the headline reveals word-by-word
 * on load via GSAP's (now free) SplitText — the single highest-impact,
 * lowest-effort "designed by a person" signal. Skips entirely under
 * prefers-reduced-motion; `useGSAP`'s scope auto-reverts on unmount so the
 * animation can't leak across navigations.
 */
export function HeroReveal({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLHeadingElement>(null);

  useGSAP(
    () => {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      if (!ref.current) return;

      const split = SplitText.create(ref.current, { type: "words" });
      gsap.from(split.words, {
        opacity: 0,
        y: 18,
        rotateX: -35,
        stagger: 0.06,
        duration: 0.7,
        ease: "power3.out",
      });

      return () => split.revert();
    },
    { scope: ref }
  );

  return <span ref={ref}>{children}</span>;
}
