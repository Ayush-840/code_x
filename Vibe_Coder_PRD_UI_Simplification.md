# Vibe Coder — Product Requirements Document
## UI Simplification: Human-Written, Not Template-Generated

Repo analyzed: `github.com/Ayush-840/code_x` • commit `490bd61` • September 2026

---

## 1. Purpose of This Document

The last two rounds pushed in the wrong direction for what's actually wanted here. Adding GSAP/Motion flourishes didn't fix "looks AI-generated" — it's a different flavor of the same problem. Checking the actual tab code surfaced the real, specific pattern: every tab repeats `01 // LABEL` eyebrow text + a uniformly bordered `.panel` card around every block of content. That specific combination — numbered micro-labels, all-caps tracked text, a card around everything — is now one of the most recognizable "generated technical SaaS" templates, independent of animation. This PRD scopes a real simplification pass to fix that, explicitly excluding the one part of the UI that's already right.

## 2. Explicitly Out of Scope — Do Not Touch

- `FileGraph.tsx`, `FileGraphTab.tsx`, `CodeGraphTab.tsx`, `FileConnectionsGraph.tsx` — the file graph and code graph visualizations. Confirmed good, stays exactly as-is.

## 3. Current State (What's Actually Generic)

- Every tab (`ArchitectureTab`, `ModulesTab`, `QuestionsTab`, `ChatTab`, `DeploymentTab`, `MockInterviewTab`) opens with the identical `section-label` (`0N // NAME`) + `section-title` pair, then wraps every subsequent block of content in an identical `.panel` card with an all-caps `text-sm text-lab-textMuted uppercase tracking-wider` micro-label above it.
- `HeroReveal.tsx` (GSAP word-stagger) and `MotionLink.tsx` (Motion hover-scale) are the two most template-recognizable animation patterns in wide use.
- `SmoothScroll.tsx` (Lenis) wraps the entire app for a tool that has no scroll-driven content justifying custom scroll physics.
- Motion-library usage is otherwise actually contained (only in the graph components, which are out of scope, plus the three files above) — this is a layout/typography problem more than an animation-overuse problem.

## 4. Goals

- Every non-graph screen reads as plainly, confidently designed — strong typography and real hierarchy doing the work, not decorative labeling conventions.
- No repeated eyebrow/label/card formula applied uniformly regardless of content — each screen's layout follows what its content actually needs.
- Remove the motion-library layer entirely from non-graph surfaces; plain CSS transitions only, and only where they clarify a state change (loading, hover, focus) rather than perform an entrance.
- "Human-written" applies to the code too: delete components whose only job was decoration (`HeroReveal`, `MotionLink`) rather than leaving unused complexity behind.

## 5. Non-Goals

- Any change to `FileGraph`/`FileGraphTab`/`CodeGraphTab`/`FileConnectionsGraph` — Section 2.
- Any change to the underlying color tokens (`lab.bg`, `lab.blue`, etc.) or fonts — the palette isn't the problem; how it's applied uniformly is.
- A full rewrite of data-fetching or business logic in any of these components — this is a presentation-layer pass.

## 6. Requirements

### 6.1 P0 — Remove the Template Tell

| ID | Requirement | Why it's P0 |
|---|---|---|
| PRD-S01 | Replace the `0N // LABEL` eyebrow + `.panel`-per-block pattern with plain heading hierarchy and content that isn't uniformly boxed. | This is the actual, specific thing making every screen look the same regardless of what it's showing — the core finding of this review. |
| PRD-S02 | Delete `HeroReveal.tsx` and `MotionLink.tsx`; replace their usage in `page.tsx` with plain elements and CSS transitions. | Per the prior turn's direction — these are the clearest animation-pattern tells, and dead decorative components are the opposite of "human-written." |
| PRD-S03 | Remove `SmoothScroll`/Lenis from the root layout unless a specific, real scroll-driven interaction is identified that needs it. | Custom scroll physics with nothing scroll-driven to justify it is complexity added for its own sake. |

### 6.2 P1 — Let Content Vary

| ID | Requirement | Why it matters |
|---|---|---|
| PRD-S04 | Each tab's layout should reflect what it's actually showing — a Q&A list doesn't need the same shape as an architecture summary, which doesn't need the same shape as a chat thread. | Uniform treatment regardless of content is exactly what makes a UI feel assembled from a template rather than considered per-screen. |
| PRD-S05 | Where a bordered container is still useful (e.g. grouping genuinely related items), it should be an intentional choice for that specific case, not a default wrapper applied to every paragraph. | Restraint in when to use a visual device is what makes its use elsewhere feel deliberate. |

## 7. Success Metrics

- Looking at `ArchitectureTab` and `ChatTab` side by side, they should not look like two instances of the same template with different words in it.
- No `0N // LABEL` eyebrow pattern remains anywhere outside the graph components.
- `HeroReveal.tsx` and `MotionLink.tsx` no longer exist in the repo.
- The landing page loads with no JS-driven entrance animation — content is simply present.

## 8. Risks & Open Questions

- This is fundamentally a design-judgment pass, not a mechanical refactor — the TRD gives a concrete worked example (`ArchitectureTab`) and a checklist for the rest, but each tab still needs an actual look at its specific content to decide its own layout, not a second formula applied uniformly in place of the first one.
- Worth deciding up front whether `MermaidDiagram.tsx` (the architecture diagram renderer, distinct from the file/code graph) counts as "graph" for preservation purposes — recommendation: it's in scope for restyling (remove any glow/theme excess it may have) but not a rebuild, since it's a diagram render, not hand-laid-out UI.
