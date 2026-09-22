/**
 * File Graph large-repo metrics: builds synthetic file trees of increasing
 * scale (up to 10k files), runs the component's own buildGraph() on them, and
 * reports visible-node counts + timings. Mirrors the PRD-G05 acceptance bar:
 * the first paint must stay bounded no matter the repo size.
 *
 * Usage: node scripts/filegraph-metrics.mjs
 */
import { performance } from "node:perf_hooks";
import { createRequire } from "node:module";

// TypeScript is hoisted into the web app's node_modules — resolve from there.
const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const ts = require("typescript");

import { readFileSync } from "node:fs";

const srcPath = new URL("../apps/web/src/components/FileGraph.tsx", import.meta.url);
const src = readFileSync(srcPath, "utf8");

const js = ts.transpileModule(src, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
    jsx: ts.JsxEmit.None,
  },
}).outputText;

// Strip React/D3 imports and the component body; we only need the pure
// helpers (countFiles, buildGraph, fileColor) before the React component.
const cut = js.indexOf("function FileGraph(");
const helpers = js
  .slice(0, cut)
  // The export block for FileGraph/FileGraphTab sits before its declaration.
  .replace(/exports\.FileGraph = FileGraph;/g, "")
  .replace(/exports\.FileGraphTab = FileGraphTab;/g, "")
  .replace(/exports\.renderExplanation = void 0;/g, "")
  .replace(/exports\.countFiles = countFiles;/g, "exports.countFiles = countFiles;")
  .replace(/exports\.buildGraph = buildGraph;/g, "exports.buildGraph = buildGraph;")
  .replace(/exports\.fileColor = fileColor;/g, "exports.fileColor = fileColor;");

const module_ = { exports: {} };
new Function("exports", "require", "module", helpers)(module_.exports, () => ({}), module_);
const { buildGraph, countFiles } = module_.exports;
if (typeof buildGraph !== "function") {
  console.error("FATAL: could not extract buildGraph from FileGraph.tsx");
  process.exit(1);
}

/* ── Synthetic tree generators ───────────────────────────── */

let pathCounter = 0;
function makeTree(dirCount, filesPerDir, depth = 1, prefix = "") {
  // Flat fan: `dirCount` dirs each with `filesPerDir` files (depth-1 children).
  if (depth === 1) {
    const children = Array.from({ length: dirCount }, (_, i) => {
      const name = `dir${i}`;
      return {
        name,
        path: prefix ? `${prefix}/${name}` : name,
        kind: "dir",
        children: Array.from({ length: filesPerDir }, (_, j) => {
          const fname = `file${j}.ts`;
          return {
            name: fname,
            path: `${prefix ? prefix + "/" : ""}${name}/${fname}`,
            kind: "file",
            children: [],
          };
        }),
      };
    });
    return { name: "/", path: "", kind: "dir", children };
  }
  return null;
}

function makeNestedTree(dirsPerLevel, filesPerDir, levels, prefix = "") {
  const children = [];
  for (let i = 0; i < dirsPerLevel; i++) {
    const name = `lvl${levels}_d${i}`;
    const path = prefix ? `${prefix}/${name}` : name;
    if (levels === 1) {
      children.push({
        name,
        path,
        kind: "dir",
        children: Array.from({ length: filesPerDir }, (_, j) => ({
          name: `f${j}.ts`,
          path: `${path}/f${j}.ts`,
          kind: "file",
          children: [],
        })),
      });
    } else {
      children.push(makeNestedTree(dirsPerLevel, filesPerDir, levels - 1, path));
      children[children.length - 1].name = name;
    }
  }
  return { name: "/", path: "", kind: "dir", children };
}

function shuffleDeep(tree, rng) {
  // No-op placeholder; trees are already varied by index.
  return tree;
}

/* ── Scenarios ───────────────────────────────────────────── */

const scenarios = [
  { name: "1k files: 10 dirs x 100 files (flat fan)", tree: makeTree(10, 100) },
  { name: "2k files: 20 dirs x 100 files (flat fan)", tree: makeTree(20, 100) },
  { name: "5k files: 50 dirs x 100 files (flat fan)", tree: makeTree(50, 100) },
  { name: "10k files: 100 dirs x 100 files (flat fan)", tree: makeTree(100, 100) },
  {
    name: "1.2k files: 4^3 dirs x 20 files (deep nesting)",
    tree: makeNestedTree(4, 20, 3),
  },
  {
    name: "100k files: 10 levels^4 x 10 files (very deep)",
    tree: makeNestedTree(10, 10, 4),
  },
];

let pass = true;
console.log("scenario".padEnd(48), "total", "visible", "build");
console.log("-".repeat(80));
for (const s of scenarios) {
  const total = countFiles(s.tree);
  const t0 = performance.now();
  const { nodes } = buildGraph(s.tree, new Set());
  const ms = (performance.now() - t0).toFixed(2);
  const pct = ((nodes.length / Math.max(total, 1)) * 100).toFixed(1);
  console.log(
    s.name.padEnd(48),
    String(total).padStart(5),
    String(nodes.length).padStart(6),
    `${ms}ms`
  );
  // Bounded-paint bar: visible nodes must stay well under half the repo and
  // under a hard 1,500-node render budget.
  if (nodes.length > 1500 || nodes.length > total * 0.5) pass = false;
}
console.log(
  `\n${pass ? "✅ BOUNDED" : "❌ UNBOUNDED"}: first-paint node counts stay under the 1,500-node budget`
);
process.exit(pass ? 0 : 1);
