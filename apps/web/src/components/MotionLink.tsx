"use client";

import { motion } from "motion/react";

/**
 * CTA micro-states (UI Revamp Manual §4.1): the paste-input/CTA row should
 * respond to the cursor — focus rings ease in, buttons compress slightly on
 * click. Small, consistent Motion states that read as "considered" instead
 * of "default". `prefers-reduced-motion` is honored by Motion automatically
 * (transform animations are disabled), so no extra wiring is needed.
 */
export function MotionLink({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <motion.a
      href={href}
      className={className}
      whileHover={{ scale: 1.03 }}
      whileTap={{ scale: 0.97 }}
      transition={{ duration: 0.18, ease: "easeOut" }}
    >
      {children}
    </motion.a>
  );
}
