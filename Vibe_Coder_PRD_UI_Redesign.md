# Vibe Coder — Product Requirements Document
## UI Redesign: Adopt the "AI Lab OS" Design System from Your Portfolio

Source design reference: `github.com/Ayush-840/ayush-portfolio` • Target: `github.com/Ayush-840/code_x`

---

## 1. Purpose of This Document

Your portfolio already has a deliberate, well-documented design identity — `CONTEXT.md` explicitly states it: black/charcoal background, white type, small electric-blue accents, no cyberpunk cliché, no glassmorphism, a real content-vs-decoration ratio (60% usable UI / 25% visualization / 10% interaction / 5% flourish). `code_x`'s frontend currently has none of this — no Tailwind, no shared tokens, no fonts beyond system defaults, raw inline `style={}` objects per component. This PRD defines bringing `code_x` into the same visual family as your portfolio, so the two read as work from the same person, not two unrelated projects.

## 2. Current State

- `apps/web/package.json` has zero design-system dependencies — no Tailwind, no font packages, no icon library.
- Every existing tab component (`ArchitectureTab`, `ModulesTab`, etc.) uses ad hoc inline styles.
- The File Graph prototype built earlier in this project used a different, one-off palette (ink + amber) invented for that single mockup — not connected to your portfolio's actual, already-shipped design system.
- Your portfolio's `tailwind.config.js` and `globals.css` already define a complete, working token system (`lab.bg`, `lab.panel`, `lab.blue`, etc.), three Google Fonts wired up via `next/font`, and a library of reusable utility classes (`.panel`, `.eyebrow`, `.section-label`, `.reveal`) — all directly reusable, not just referenceable.

## 3. Goals

- `code_x`'s frontend uses the same color tokens, type scale, and fonts as your portfolio — Bebas Neue for display headlines, JetBrains Mono for technical/label text, Space Grotesk for body copy, on the same near-black background with the same electric-cyan accent.
- The File Graph tab is rebuilt around your portfolio's already-proven "Project Filesystem" pattern (file-list sidebar + detail panel with numbered architecture steps) instead of the earlier one-off prototype's D3 force-graph + amber palette.
- Shared UI conventions — eyebrow labels, section headers, panel/card treatment, reveal-on-scroll — are extracted once and reused across every tab, not reinvented per screen.
- The result is recognizably part of the same "lab" identity as your portfolio without being a literal re-skin of portfolio content that doesn't apply to a different product.

## 4. Non-Goals

- Porting the 3D/WebGL neural-network visualization, the boot loader, or the full-screen menu overlay wholesale — those are portfolio-specific flourishes tied to a personal site's first-impression moment. `code_x` is a tool people return to and use repeatedly; it should feel calmer and faster, not re-run an entry animation every visit.
- Rebuilding `code_x`'s existing functional flows (anonymous analyze, auth, mock interview) — this phase is a visual/component treatment on top of what already works, not a rearchitecture.
- Matching every portfolio component 1:1 — only the ones that map to a real `code_x` need (Section 6) are in scope.

## 5. Design System Source of Truth

Reuse directly, not reinterpret:

| Token | Value | Use |
|---|---|---|
| `--bg` | `#050508` | App background |
| `--bg-panel` | `#0A0A0E` | Panel/card background |
| `--bg-raise` | `#101016` | Elevated surfaces (nested cards, code blocks) |
| `--border` / `--border-hov` | `#1A1A26` / `#2A2A3E` | Default and hover panel borders |
| `--text` / `--muted` / `--dim` | `#F2F2F5` / `#8B8B9E` / `#4A4A5E` | Primary, secondary, tertiary text |
| `--accent` | `#00D8FF` | The one accent — active states, links, key data points |
| `--accent-dim` / `--accent-glow` | `rgba(0,216,255,0.12)` / `rgba(0,216,255,0.35)` | Backgrounds and hover glows for accent elements |

Fonts: **Bebas Neue** (`--font-display`) for large headings, **JetBrains Mono** (`--font-mono`) for labels/eyebrows/technical values/citations, **Space Grotesk** (`--font-sans`) for body text — identical setup to `layout.tsx` in the portfolio.

## 6. Requirements

### 6.1 P0 — Foundation

| ID | Requirement | Why it's P0 |
|---|---|---|
| PRD-U01 | `apps/web` has Tailwind configured with the token table above, and the three fonts loaded via `next/font/google`, matching the portfolio's setup. | Nothing else in this document can be built consistently without this existing first. |
| PRD-U02 | The shared utility classes your portfolio already relies on (`.panel`, `.eyebrow`, `.section-label`, `.section-title`, `.reveal`) are ported into `code_x`'s `globals.css` and used by every tab, not reinvented per component. | This is what makes screens feel like one system instead of a redesign done piecemeal, tab by tab. |

### 6.2 P1 — Rebuild the File Graph Around the Proven Pattern

| ID | Requirement | Why it matters |
|---|---|---|
| PRD-U03 | The File Graph tab adopts the "Project Filesystem" layout: a `/repo/path`-styled sidebar file list on the left, a detail panel on the right showing the selected file's explanation as numbered architecture-flow steps (rather than free paragraphs), with cyan proof-point pills for key facts. | This pattern is already built, already looks good, and is a closer fit for "explain this file's role in the system" than a force-directed graph is — the graph was a reasonable first idea, but this is a better one you'd already shipped elsewhere. |
| PRD-U04 | File-type/module filter chips (mirroring the portfolio's category filter chips) let a visitor narrow the file list — e.g. by directory or by whether a file has been explained yet. | Directly reuses a working interaction pattern rather than inventing a new one for large-repo navigation. |

### 6.3 P2 — Extend the Identity

| ID | Requirement | Why it matters |
|---|---|---|
| PRD-U05 | Every tab (Architecture, Modules, Questions, Chat, Mock Interview) gets an eyebrow + section-label/section-title header, consistent with how every portfolio section is introduced. | Small, cheap, and it's the detail that makes a UI feel considered rather than assembled. |
| PRD-U06 | Consider a terminal-styled view for the mock-interview transcript, using the portfolio's `TerminalWindow` component as a direct starting point. | You've already built a working, styled terminal component — a Q&A transcript is a very natural fit for it, more so than a generic chat-bubble UI. |

## 7. Success Metrics

- Someone who's seen your portfolio recognizes `code_x` as built by the same person within the first few seconds, without being told.
- The File Graph tab's information density and clarity is judged (by you, informally) as better than the earlier amber-palette prototype, not just differently colored.
- No inline `style={}` objects remain in the tabs touched by this phase — everything routes through the shared tokens/classes.

## 8. Risks & Open Questions

- The portfolio's boot loader and full-page menu overlay are explicitly out of scope (Section 4) — worth being deliberate about this if there's any temptation to port them anyway, since a returning `code_x` user re-sitting through a boot animation on every visit would actively hurt the product, unlike a portfolio's one-time visitor.
- `code_x`'s existing `Artifact`-based data (module explanations, questions) will need light reshaping to fit the "numbered architecture-flow steps" presentation the Project Filesystem pattern expects — this is a content-mapping task worth scoping explicitly in the TRD, not assumed to be a drop-in fit.
