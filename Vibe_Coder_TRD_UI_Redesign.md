# Vibe Coder — Technical Requirements Document
## UI Redesign: Adopt the "AI Lab OS" Design System from Your Portfolio

Source: `github.com/Ayush-840/ayush-portfolio` (`tailwind.config.js`, `globals.css`, `layout.tsx`, `FileSystem.tsx`, `TerminalWindow.tsx`) • Target: `github.com/Ayush-840/code_x` (`apps/web`)

---

## 1. Foundation Setup (resolves PRD-U01)

### 1.1 Dependencies

```sh
pnpm --filter @vibe-coder/web add -D tailwindcss postcss autoprefixer
pnpm --filter @vibe-coder/web add lucide-react
```

(`lucide-react` — the icon set `FileSystem.tsx` already uses for `Folder`/`FileCode`/`ArrowRight`/`ExternalLink`; reuse rather than introducing a second icon library.)

### 1.2 `apps/web/tailwind.config.js` — copied and adapted

```js
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        lab: {
          bg: "#050508",
          panel: "#0A0A0E",
          card: "#101016",
          border: "#1A1A26",
          borderHover: "#2A2A3E",
          blue: "#00D8FF",
          blueDim: "rgba(0, 216, 255, 0.12)",
          text: "#F2F2F5",
          textMuted: "#8B8B9E",
          dim: "#4A4A5E",
        },
      },
      fontFamily: {
        display: ["var(--font-display)", "Impact", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
```

Identical to the portfolio's config — same token names, so any component copied over (Section 3) needs no class-name translation.

### 1.3 `apps/web/src/app/layout.tsx` — font setup

```tsx
import { Bebas_Neue, JetBrains_Mono, Space_Grotesk } from "next/font/google";

const display = Bebas_Neue({ weight: "400", subsets: ["latin"], variable: "--font-display", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap" });
const sans = Space_Grotesk({ subsets: ["latin"], variable: "--font-sans", display: "swap" });

// <html className={`dark ${display.variable} ${mono.variable} ${sans.variable}`}>
// <body className="bg-[#050508] text-[#F2F2F5] antialiased min-h-screen flex flex-col">
```

### 1.4 `apps/web/src/app/globals.css` — shared utility classes (resolves PRD-U02)

Port these classes verbatim from the portfolio (they're generic, not portfolio-content-specific): `:root` token declarations, `.panel` / `.panel--cyan`, `.eyebrow`, `.section-label`, `.section-title`, `.reveal` / `.reveal.is-visible`, the custom scrollbar rules, and the `prefers-reduced-motion` block. Skip `.loader*`, `.hud*`, `.menu-overlay*` — those back the portfolio-specific boot sequence and full-page nav explicitly out of scope per the PRD.

## 2. File Graph Rebuild (resolves PRD-U03, PRD-U04)

### 2.1 Component structure

Restructure `FileGraph.tsx`/`FileGraphTab.tsx` to follow `FileSystem.tsx`'s layout directly — a 12-column grid, 4/8 split:

```tsx
<div className="panel grid grid-cols-1 md:grid-cols-12 gap-6 p-4 sm:p-6">
  {/* Left: file list, 4 cols */}
  <div className="md:col-span-4 border-r border-lab-border pr-4 space-y-3 font-mono text-xs">
    <div className="flex items-center gap-2 text-lab-textMuted uppercase tracking-wider pb-2 border-b border-lab-border">
      <Folder className="w-4 h-4 text-lab-blue" />
      <span>/{repoFullName}</span>
    </div>
    {/* file rows — same isSelected treatment as FileSystem.tsx's project rows */}
  </div>

  {/* Right: selected file detail, 8 cols */}
  <div className="md:col-span-8 font-mono space-y-6">
    {/* numbered architecture-flow steps — see 2.2 */}
  </div>
</div>
```

File rows reuse `FileSystem.tsx`'s selected/unselected treatment exactly: `bg-lab-blue/15 text-lab-blue border-l-2 border-lab-blue` when active, `text-lab-textMuted hover:bg-lab-card hover:text-white` otherwise.

### 2.2 Mapping file-explanation data to the "architecture flow" presentation

The generation service currently returns a file explanation as free-form prose plus a `qas` list (per the File Graph feature's TRD). `FileSystem.tsx`'s detail panel instead expects a `{ step, desc }[]` array rendered as numbered, arrow-connected stages. Two options:

- **Preferred**: extend the file-explain generation prompt to additionally return a short ordered list — "what this file does, broken into 2–5 steps" (e.g., for an auth route file: "Receive OAuth callback" → "Exchange code for tokens" → "Set session cookies" → "Redirect to app") — a natural fit for how code already has sequential logic, and directly reuses the existing UI pattern with no UI-side compromise.
- **Fallback**: if forcing every file into a step sequence doesn't fit well for all file types (e.g. a types/constants file with no real "flow"), keep the free-form explanation as a fallback rendering and only use the numbered-steps layout when the generation response includes a `flow` array.

```tsx
{selectedFile.flow?.length ? (
  <div className="space-y-2">
    {selectedFile.flow.map((step, idx) => (
      <div key={idx} className="p-3 bg-lab-bg border border-lab-border rounded flex items-start gap-3 hover:border-lab-blue/40 transition-colors">
        <div className="w-6 h-6 rounded bg-lab-blueDim text-lab-blue flex items-center justify-center text-xs font-bold shrink-0">
          0{idx + 1}
        </div>
        <div className="flex-1 text-xs">
          <div className="text-white font-semibold flex items-center gap-2">
            <span>{step.step}</span>
            {idx < selectedFile.flow.length - 1 && <ArrowRight className="w-3 h-3 text-lab-blue" />}
          </div>
          <p className="text-lab-textMuted text-[11px] mt-0.5">{step.desc}</p>
        </div>
      </div>
    ))}
  </div>
) : (
  <p className="text-xs text-lab-textMuted leading-relaxed">{selectedFile.explanation}</p>
)}
```

### 2.3 Metric pills and citations

Reuse the cyan proof-point pill pattern for the file's grounding citations (file path + line range), matching `FileSystem.tsx`'s `metrics` pills exactly:

```tsx
<span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono bg-lab-blueDim text-lab-blue border border-lab-blue/30">
  <span className="w-1 h-1 rounded-full bg-lab-blue shrink-0" />
  {citation.filePath}:{citation.startLine}–{citation.endLine}
</span>
```

### 2.4 Filter chips (resolves PRD-U04)

Directly port `FileSystem.tsx`'s filter-chip pattern, replacing project categories with file categories (by top-level directory, or by "explained" / "not yet explained" status) — same active/inactive class treatment, same count badge.

## 3. Header Treatment Across Tabs (resolves PRD-U05)

Each tab's existing header (currently ad hoc) becomes:

```tsx
<p className="section-label">0{tabIndex} // {TAB_NAME.toUpperCase()}</p>
<h2 className="section-title">{tabTitle}</h2>
```

matching `FileSystem.tsx`'s own `02 // BUILDS` / `Project Filesystem` pattern — apply the same numbering convention across Architecture (01), Modules/Files (02), Questions (03), Chat (04), Mock Interview (05).

## 4. Terminal-Styled Mock Interview (resolves PRD-U06, optional this phase)

`TerminalWindow.tsx` is already a generic, reusable component (takes no project-specific props beyond initial history) — it can be adopted with minimal change:

```tsx
<TerminalWindow bodyClassName="h-96" />
```

Feed the mock-interview Q&A exchange into its `history` state shape (`{ type: "input" | "output" | "system", content }`) instead of the terminal's own demo command responses — the interviewer's question becomes a `system` line, the candidate's answer an `input` line, feedback an `output` line. This is a larger integration than Sections 1–3 and is reasonable to defer to a follow-up pass rather than blocking the rest of this phase.

## 5. Sequencing

| Step | Work | Depends on |
|---|---|---|
| 1 | Tailwind config + fonts + globals.css utilities (1.1–1.4) | None |
| 2 | File Graph rebuild — layout + file list (2.1) | Step 1 |
| 3 | Generation service: add the `flow` array to file-explain output (2.2) | None — can be built in parallel with step 2's UI work |
| 4 | Wire real data into the rebuilt File Graph detail panel (2.2–2.3) | Steps 2 and 3 |
| 5 | Filter chips (2.4) | Step 2 |
| 6 | Header treatment on remaining tabs (Section 3) | Step 1 |
| 7 | Terminal-styled mock interview (Section 4) | Step 1 — independent of everything else, do whenever |

## 6. Acceptance Criteria

- `apps/web` builds and renders using the `lab.*` Tailwind tokens and the three portfolio fonts, with no remaining inline `style={}` objects in the tabs touched by this phase.
- The File Graph tab visually and structurally matches `FileSystem.tsx`'s file-list + detail-panel pattern — same grid split, same selected-row treatment, same numbered-step detail rendering.
- A file explanation with a `flow` array renders as numbered steps; one without falls back cleanly to prose, with no broken layout either way.
- Every tab header follows the `0N // LABEL` + title convention consistently.
