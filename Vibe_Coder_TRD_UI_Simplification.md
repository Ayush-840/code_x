# Vibe Coder — Technical Requirements Document
## UI Simplification: Human-Written, Not Template-Generated

Repo analyzed: `github.com/Ayush-840/code_x` • commit `490bd61` • September 2026
**Out of scope, unchanged**: `FileGraph.tsx`, `FileGraphTab.tsx`, `CodeGraphTab.tsx`, `FileConnectionsGraph.tsx`

---

## 1. The Pattern, Named Precisely

Every tab currently follows this exact formula, regardless of what it's displaying:

```
section-label ("0N // NAME")
section-title
  .panel
    uppercase tracking-wider micro-label
    content
  .panel
    uppercase tracking-wider micro-label
    content
  ...(repeat per section)
```

This is the actual, nameable thing to remove — not "too much design," but *the same shape applied to every screen independent of its content*. A summary paragraph, a tag list, a grid of components, and a code snippet are all wrapped in the identical bordered card with the identical micro-label treatment above it. That sameness is what reads as generated.

## 2. Worked Example: `ArchitectureTab.tsx`

### Before (current)

```tsx
<div>
  <p className="section-label">01 // ARCHITECTURE</p>
  <h2 className="section-title">Architecture Overview</h2>
</div>

{arch.summary && (
  <div className="panel">
    <p className="text-sm text-lab-textMuted uppercase tracking-wider mb-3">Summary</p>
    <p className="text-lab-text text-base leading-relaxed">{arch.summary}</p>
  </div>
)}

{arch.stack && (
  <div className="panel">
    <p className="text-sm text-lab-textMuted uppercase tracking-wider mb-3">Technology Stack</p>
    <div className="flex flex-wrap gap-2">
      {/* pill badges */}
    </div>
  </div>
)}

{arch.components && (
  <div className="panel">
    <p className="text-sm text-lab-textMuted uppercase tracking-wider mb-3">Components</p>
    <div className="grid ...">{/* bordered cards */}</div>
  </div>
)}

{arch.entryPoints && (
  <div className="panel">
    <p className="text-sm text-lab-textMuted uppercase tracking-wider mb-3">Entry Points</p>
    {/* code pills */}
  </div>
)}
```

### After

```tsx
<div className="max-w-3xl">
  <h2 className="text-2xl font-display text-white mb-1">Architecture</h2>
  {arch.summary && (
    <p className="text-lab-textMuted leading-relaxed mt-3 mb-8">{arch.summary}</p>
  )}

  {arch.stack && (
    <div className="mb-8">
      <h3 className="text-sm font-semibold text-white mb-2">Stack</h3>
      <p className="text-sm text-lab-textMuted">
        {stackItems.join(" · ")}
      </p>
    </div>
  )}

  {arch.components && arch.components.length > 0 && (
    <div className="mb-8">
      <h3 className="text-sm font-semibold text-white mb-3">Components</h3>
      <div className="divide-y divide-lab-border">
        {arch.components.map((c) => (
          <div key={c.name} className="py-3">
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-sm text-white">{c.name}</span>
              <span className="text-xs text-lab-textMuted">{c.role}</span>
            </div>
            {c.dependsOn?.length > 0 && (
              <p className="text-xs text-lab-dim mt-1 font-mono">
                depends on {c.dependsOn.join(", ")}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  )}

  {arch.entryPoints && arch.entryPoints.length > 0 && (
    <div>
      <h3 className="text-sm font-semibold text-white mb-2">Entry points</h3>
      <ul className="text-sm font-mono text-lab-textMuted space-y-1">
        {entryPointLabels.map((label, i) => <li key={i}>{label}</li>)}
      </ul>
    </div>
  )}
</div>
```

What changed and why:
- No eyebrow/section-label numbering — one real `<h2>`, sized and weighted to actually look like a heading, not a decorative micro-label above a bigger one.
- No `.panel` card around every section — sections are separated by spacing and a plain `<h3>`, not a border. A border is now reserved for the one place it's earned (the divided list of components, where a rule between items genuinely aids scanning).
- Tech stack collapses from a row of bordered pill badges to plain text joined by `·` — the information is identical, the presentation stops performing "look how many badges I can render."
- Component cards lose their individual borders and hover-glow — a `divide-y` list reads as calmer and is honestly easier to scan than a grid of boxes.
- Entry points lose the code-pill treatment in favor of a plain monospace list — monospace already signals "this is a path/identifier"; the pill border was decorative on top of a signal that already existed.

## 3. Checklist for the Remaining Tabs

Apply the same judgment (not the same literal markup) to each:

| Tab | What to look at specifically |
|---|---|
| `ModulesTab.tsx` | If it currently uses the same `.panel`-per-module pattern, prefer a list (like the Components section above) over a grid of cards — modules are naturally sequential/hierarchical, not a card-grid of equal-weight tiles. |
| `QuestionsTab.tsx` | A Q&A list has natural structure already (question, answer) — a numbered or plain-divided list beats individual bordered cards per question. |
| `ChatTab.tsx` | Chat bubbles are one of the few places a bordered/shaded container per-message is actually functionally justified (distinguishing speakers) — this tab likely needs the least change. Check it doesn't also have a `section-label`/`section-title` header pair above the thread that the other tabs don't need repeated here. |
| `DeploymentTab.tsx` | Likely the most eyebrow/panel-heavy given it was built directly from the deployment-detection feature spec — apply the same summary-then-list treatment as Architecture. |
| `MockInterviewTab.tsx` | If a terminal-style view was adopted here per the earlier UI redesign TRD, that's a case where a bordered "window" container is genuinely appropriate (it's supposed to look like a terminal) — don't strip that; it's one of the few justified uses of a contained box. |
| `MermaidDiagram.tsx` | In scope for restyling only — remove any glow/border theming that doesn't match the simplified surrounding page; not a layout rebuild, it's a diagram renderer. |

## 4. Removing the Decorative Components

### 4.1 Delete `HeroReveal.tsx` and `MotionLink.tsx`

```tsx
// apps/web/src/app/page.tsx — before
import { HeroReveal } from "@/components/HeroReveal";
import { MotionLink } from "@/components/MotionLink";
...
<HeroReveal><h1>...</h1></HeroReveal>
...
<MotionLink href="/login" className="btn btn-primary btn-lg">Get started</MotionLink>

// after
<h1 className="hero-title">...</h1>
...
<a href="/login" className="btn btn-primary btn-lg">Get started</a>
```

```css
/* globals.css — replace both components' worth of behavior with two rules */
.hero-title { animation: fade-in 0.4s ease-out; }
.btn { transition: border-color 0.15s ease, color 0.15s ease; }
.btn:hover { border-color: var(--lab-blue); }
@keyframes fade-in { from { opacity: 0; } to { opacity: 1; } }
```

Then delete the two component files and their imports elsewhere.

### 4.2 Remove `SmoothScroll` from the root layout

```tsx
// apps/web/src/app/layout.tsx — before
<SmoothScroll>{children}</SmoothScroll>

// after
{children}
```

Delete `SmoothScroll.tsx` and its `lenis`/`lenis/react` dependency from `package.json` unless a specific future feature needs scroll-driven behavior — reintroducing it later, scoped to just that feature, is cheap; carrying unused scroll-physics complexity site-wide is not free (it's one more thing every page's behavior depends on).

## 5. Sequencing

| Step | Work | Depends on |
|---|---|---|
| 1 | Delete `HeroReveal`, `MotionLink`, `SmoothScroll` + their usages (Section 4) | None — mechanical, do first |
| 2 | Rebuild `ArchitectureTab` per Section 2 | Step 1 |
| 3 | Apply the same judgment to `ModulesTab`, `QuestionsTab`, `DeploymentTab` (Section 3) | Step 2, as a reference pattern |
| 4 | Review `ChatTab`, `MockInterviewTab` — likely minimal changes, verify per Section 3's notes | Independent, can happen any time |
| 5 | Restyle `MermaidDiagram.tsx` | Independent |

## 6. Acceptance Criteria

- `grep -r "section-label" apps/web/src/components` returns no results outside the graph components.
- `HeroReveal.tsx`, `MotionLink.tsx`, `SmoothScroll.tsx` no longer exist in the repo.
- `motion`, `gsap`, `@gsap/react`, `lenis` are removed from `apps/web/package.json` unless still used by the (out-of-scope) graph components — verify what those actually import before removing anything from `package.json` wholesale.
- Looking at `ArchitectureTab` and `QuestionsTab` side by side, their layouts are visibly different from each other, driven by their actual content rather than a shared template.
