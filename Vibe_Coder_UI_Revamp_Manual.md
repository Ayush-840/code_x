# Vibe Coder — UI Revamp Instruction Manual
## From "Tailwind Tokens Applied" to "Doesn't Look Like AI Slop"

Target: `apps/web` (already has the Tailwind + "AI Lab OS" token system from the earlier redesign)

---

## 1. Why It Still Reads as Generic

Applying color tokens and fonts (the earlier redesign phase) fixes the *palette*. It doesn't fix the thing that actually reads as "AI-generated" to a trained eye: **everything appears instantly and sits still.** No scroll choreography, no cursor response, no depth, no sense that a specific person designed each transition. Your portfolio doesn't look distinctive because of its color — it looks distinctive because things *move* with intention: the hero reveals in sequence, scroll drives real transformation, the file-tree in `FileSystem.tsx` has hover states with actual weight to them. That's the gap this manual closes.

## 2. Library Landscape (Explored, Not Assumed)

A survey of what's actually current, since this space moves fast and library names/ownership change:

| Library | What it's for | Current status (Sept 2026) | Verdict for this project |
|---|---|---|---|
| **Motion** (formerly Framer Motion) | Declarative React animation — describe the end state, it interpolates | Rebranded and now framework-agnostic (React/JS/Vue); import from `motion/react`, not `framer-motion`. On the v12 line. MIT licensed. | **Use it** — for component-level animation (cards entering, hover states, layout transitions). Your portfolio's `.reveal` class pattern is a hand-rolled version of what Motion does natively and better. |
| **GSAP** + **ScrollTrigger** | Imperative, timeline-driven animation — precise control over sequencing | Fully free as of the Webflow/GreenSock acquisition — every plugin (SplitText, MorphSVG, etc.) is now free, including commercial use. `@gsap/react`'s `useGSAP()` hook makes it coexist cleanly with React. Current v3.15. | **Use it** — for anything scroll-driven (the exact thing your portfolio already uses it for) and text-reveal effects. This is not a "pick one" situation with Motion — using both is officially supported and common; the two solve different problems. |
| **Lenis** | Smooth-scroll library | Actively maintained, the de facto standard for this now (studio-freight → now maintained as `lenis`). Your portfolio already uses it. | **Use it** — it's what makes scroll-driven GSAP work feel physical instead of janky. Non-negotiable if you're doing any ScrollTrigger work. |
| **React Three Fiber + drei** | Declarative Three.js in React | Mature, actively maintained, the standard way to use Three.js in a React app rather than fighting the imperative API directly. Your portfolio's `NeuralField`/`FieldBoundary` use this. | **Use selectively** — see Section 5. Full 3D everywhere is the wrong call for a tool people use repeatedly; a small, purposeful 3D moment is not. |
| **Anime.js** | Lightweight general-purpose animation | Still maintained, smaller footprint than GSAP. | Skip — GSAP + Motion already cover everything this would, and you'd be maintaining a third animation mental model for no real gain. |

**Decision**: GSAP + ScrollTrigger + Lenis for scroll/timeline work (matching your portfolio exactly, so the two sites share a technical identity, not just a palette), Motion for component-level micro-interactions (hover, enter/exit, layout shifts), React Three Fiber for one deliberate 3D moment, not a wraparound aesthetic.

## 3. Setup

```sh
pnpm --filter @vibe-coder/web add motion gsap @gsap/react lenis
pnpm --filter @vibe-coder/web add three @react-three/fiber @react-three/drei
pnpm --filter @vibe-coder/web add -D @types/three
```

### 3.1 Lenis — wrap the whole app once

```tsx
// apps/web/src/components/SmoothScroll.tsx
"use client";
import { ReactLenis } from "lenis/react";

export function SmoothScroll({ children }: { children: React.ReactNode }) {
  return (
    <ReactLenis root options={{ lerp: 0.1, duration: 1.2, smoothWheel: true }}>
      {children}
    </ReactLenis>
  );
}
```

Wrap `{children}` in `layout.tsx` with this. Respect `prefers-reduced-motion` — Lenis doesn't do this automatically:

```tsx
const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
<ReactLenis root options={{ lerp: prefersReduced ? 1 : 0.1, smoothWheel: !prefersReduced }}>
```

### 3.2 GSAP + `useGSAP()` — the correct React integration pattern

```tsx
import { useRef } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

function ArchitectureSection() {
  const containerRef = useRef<HTMLDivElement>(null);

  useGSAP(() => {
    gsap.from(".arch-node", {
      opacity: 0,
      y: 24,
      stagger: 0.08,
      scrollTrigger: { trigger: containerRef.current, start: "top 80%" },
    });
  }, { scope: containerRef }); // auto-cleanup on unmount — the #1 GSAP+React footgun this hook fixes

  return <div ref={containerRef}>...</div>;
}
```

`useGSAP`'s `scope` option auto-reverts all animations on unmount — without it, GSAP timelines leak across React's render lifecycle, which is the single most common cause of "the animation breaks after navigating away and back" bugs.

### 3.3 Motion — component-level

```tsx
import { motion } from "motion/react";  // NOT "framer-motion" — that's the old import path

<motion.div
  initial={{ opacity: 0, y: 12 }}
  animate={{ opacity: 1, y: 0 }}
  whileHover={{ borderColor: "var(--accent)" }}
  transition={{ duration: 0.3, ease: "easeOut" }}
  className="panel"
>
```

## 4. Concrete Application — Screen by Screen

### 4.1 Landing page (`apps/analyze/page.tsx`)

- **Hero text**: GSAP `SplitText` (now free) to reveal the headline character-by-character or word-by-word on load, not a plain fade — this is the single highest-impact, lowest-effort change for "first impression."
- **The paste-input row**: Motion `whileFocus`/`whileTap` micro-states — a focus ring that eases in, a button that compresses slightly on click. Currently these are either CSS-only or absent; both are instantly noticeable as "considered" vs. "default."
- **Background**: a restrained, small-scale version of your portfolio's `NeuralField` — not the full 3D scene, but a lightweight canvas of drifting nodes/connections behind the hero only, capped to a few dozen particles so it never competes with the input for attention. This is the one R3F moment worth spending on (Section 5).

### 4.2 Repo analysis page — tab transitions

- Wrap the active tab's content in Motion's `AnimatePresence` so switching between Architecture/Modules/Code Graph/Chat crossfades and slides slightly, instead of hard-cutting:

```tsx
<AnimatePresence mode="wait">
  <motion.div key={activeTab} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }}>
    {renderActiveTab()}
  </motion.div>
</AnimatePresence>
```

### 4.3 File Graph tab

- The graph nodes already move (D3 force simulation) — the gap is everything *around* it. GSAP-stagger the file list entries in on first load (matching `FileSystem.tsx`'s own reveal pattern), and use Motion's `layout` prop on the detail panel so it resizes smoothly when switching between a short and long explanation instead of snapping.

### 4.4 Mock Interview / Terminal view

- If `TerminalWindow.tsx` gets ported here (per the earlier UI redesign TRD), use GSAP's (free) `TextPlugin` for the typewriter effect on the interviewer's questions appearing — this is a case where GSAP's imperative, precisely-timed character-by-character control is a better fit than Motion's declarative model.

## 5. Where to Stop: the 3D Question

Your portfolio's `CONTEXT.md` states an explicit ratio: 60% clean usable UI / 25% 3D-WebGL / 10% interaction / 5% flourish — and that ratio is right *for a portfolio*, a one-time impression. It is **wrong for `code_x`**, a tool people return to repeatedly to actually get work done. Recommendation:

- **One 3D moment, on the landing page only** (Section 4.1's hero background) — R3F, low particle count, `<Canvas dpr={[1, 1.5]}>` capped, paused via `prefers-reduced-motion` and via an `IntersectionObserver` so it doesn't render when scrolled out of view.
- **No 3D inside the actual product screens** (repo analysis, chat, mock interview) — these need to feel fast and calm on the fiftieth visit, not impressive on the first. A visitor prepping for an interview in twenty minutes should never wait on a WebGL scene to justify itself.
- If you want a second 3D touch later, the File Graph is the *only* other reasonable candidate (an optional 3D toggle on top of the existing 2D force graph, not a replacement) — and only after the 2D version, tab transitions, and hero are done and feel right. Don't parallelize this with the CodeGraph integration work — sequence it after, per the plan below.

## 6. Suggested Order of Work

| Step | Work | Payoff vs. effort |
|---|---|---|
| 1 | Lenis wrap + `prefers-reduced-motion` handling | Small effort, felt on every single scroll interaction site-wide |
| 2 | Hero text reveal (GSAP SplitText) + input micro-states (Motion) | Small effort, highest first-impression impact |
| 3 | Tab-switch crossfade (Motion `AnimatePresence`) | Small effort, removes the single most noticeable "static app" tell |
| 4 | File list / detail panel stagger + layout animation | Medium effort, most visible on the screen people spend the most time in |
| 5 | Hero 3D background (R3F, capped, hero-only) | Larger effort, the one deliberate "wow" moment — do last, once everything else already feels intentional |

Stopping after step 3 alone would already remove most of what currently reads as "AI slop" — a static app with a nice palette. Steps 4–5 are what take it the rest of the way to feeling designed by someone with actual craft, which is exactly what your portfolio already demonstrates you have.
