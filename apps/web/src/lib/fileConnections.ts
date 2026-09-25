/**
 * Connected-files computation for the File Graph tab (PRD-G02).
 *
 * Given the repo file tree, the selected file, and (optionally) the
 * import/require edges extracted by the analysis service (`file-edges`
 * artifact), produces the 1-hop neighborhood rendered by
 * FileConnectionsGraph: files the selected file imports, files that import
 * it, plus structural fallbacks (test pairs, siblings, same-basename) so the
 * graph is useful even for repos analyzed before edges existed.
 *
 * Pure functions only — no effects, no identity churn; the component tree
 * renders the same output for the same inputs (flicker contract, TRD-F0x).
 */

export interface FileEdge {
  from: string;
  to: string;
  type?: string;
}

export type ConnectionKind = "import" | "imported-by" | "test" | "sibling" | "related";

export interface ConnectionNode {
  path: string;
  name: string;
  relation: ConnectionKind;
}

export interface ConnectionLink {
  source: string;
  target: string;
  relation: ConnectionKind;
}

export interface Connections {
  selected: string;
  nodes: ConnectionNode[];
  links: ConnectionLink[];
}

interface TreeNodeLike {
  name: string;
  path: string;
  kind: "dir" | "file";
  children?: TreeNodeLike[];
}

/** Priority order: import relationships first, structural ones after. */
const KIND_PRIORITY: ConnectionKind[] = ["import", "imported-by", "test", "sibling", "related"];

const CAPS: Record<ConnectionKind, number> = {
  import: 8,
  "imported-by": 8,
  test: 4,
  sibling: 10,
  related: 4,
};

const TOTAL_CAP = 24;

const INDEX_NAMES = new Set(["index", "__init__"]);

function norm(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+/, "");
}

function baseName(path: string): string {
  const last = norm(path).split("/").pop() ?? path;
  const dot = last.lastIndexOf(".");
  return dot > 0 ? last.slice(0, dot) : last;
}

function dirName(path: string): string {
  const parts = norm(path).split("/");
  parts.pop();
  return parts.join("/");
}

/** `foo.test.ts` -> `foo`, `test_app.py` -> `app`, `app_test.py` -> `app`. */
function testKey(path: string): string {
  return baseName(path)
    .toLowerCase()
    .replace(/\.(test|spec)$/, "")
    .replace(/[\._-]?test$/, "")
    .replace(/^test[\._-]?/, "");
}

function looksLikeTest(path: string): boolean {
  const base = baseName(path).toLowerCase();
  const full = norm(path).toLowerCase();
  return (
    /^test[\._-]/.test(base) ||
    /[\._-]test$/.test(base) ||
    /\.(test|spec)\./.test(full) ||
    full.includes("/__tests__/") ||
    full.includes("/__mocks__/")
  );
}

function collectFiles(node: TreeNodeLike, out: string[] = []): string[] {
  if (node.kind === "file") out.push(norm(node.path));
  for (const child of node.children ?? []) collectFiles(child, out);
  return out;
}

/**
 * 1-hop neighborhood of `selected`, strongest relations first, deduped by
 * path, capped so a 500-file directory cannot explode the graph.
 */
export function computeConnections(
  tree: TreeNodeLike,
  selected: string,
  edges: FileEdge[] = []
): Connections {
  const sel = norm(selected);
  const files = collectFiles(tree);
  const known = new Set(files);
  const picked = new Map<string, ConnectionKind>();
  const links: ConnectionLink[] = [];

  const add = (path: string, relation: ConnectionKind): void => {
    const p = norm(path);
    if (p === sel || !known.has(p) || picked.has(p)) return;
    const count = Array.from(picked.values()).filter((k) => k === relation).length;
    if (count >= CAPS[relation]) return;
    if (picked.size >= TOTAL_CAP) return;
    picked.set(p, relation);
    links.push({ source: sel, target: p, relation });
  };

  // 1. Import edges (real data from the analysis service).
  const normEdges = edges.map((e) => ({ from: norm(e.from), to: norm(e.to) }));
  for (const e of normEdges) if (e.from === sel) add(e.to, "import");
  for (const e of normEdges) if (e.to === sel) add(e.from, "imported-by");

  // 2. Test <-> source pairs (`foo.ts` <-> `foo.test.ts`, `test_app.py` <-> `app.py`).
  const selIsTest = looksLikeTest(sel);
  const selKey = testKey(sel);
  for (const f of files) {
    if (f === sel) continue;
    if (testKey(f) === selKey && looksLikeTest(f) !== selIsTest) add(f, "test");
  }

  // 3. Siblings — same directory, names closest to the selected file first,
  //    capped so a 500-file directory cannot explode the graph.
  const selDir = dirName(sel);
  const selBaseFull = baseName(sel).toLowerCase();
  const commonPrefix = (name: string): number => {
    const b = name.toLowerCase();
    let i = 0;
    while (i < b.length && i < selBaseFull.length && b[i] === selBaseFull[i]) i++;
    return -i; // longer shared prefix sorts first
  };
  const siblings = files.filter((f) => f !== sel && dirName(f) === selDir);
  siblings.sort((a, b) => {
    const ca = commonPrefix(baseName(a));
    const cb = commonPrefix(baseName(b));
    if (ca !== cb) return ca - cb;
    return a.localeCompare(b);
  });
  for (const f of siblings) add(f, "sibling");

  // 4. Same basename elsewhere (`src/api.ts` <-> `test/api.ts`), skipping
  //    index-like files that would match across every directory.
  const selBaseName = baseName(sel).toLowerCase();
  if (!INDEX_NAMES.has(selBaseName)) {
    const related = files.filter((f) => {
      const b = baseName(f).toLowerCase();
      return f !== sel && b === selBaseName && !INDEX_NAMES.has(b);
    });
    related.sort((a, b) => a.localeCompare(b));
    for (const f of related) add(f, "related");
  }

  // Stable order for rendering: priority first, then path.
  const nodes: ConnectionNode[] = Array.from(picked.entries())
    .map(([path, relation]) => ({
      path,
      name: path.split("/").pop() ?? path,
      relation,
    }))
    .sort((a, b) => {
      const pa = KIND_PRIORITY.indexOf(a.relation);
      const pb = KIND_PRIORITY.indexOf(b.relation);
      if (pa !== pb) return pa - pb;
      return a.path.localeCompare(b.path);
    });

  const order = new Map(nodes.map((n, i) => [n.path, i]));
  links.sort((a, b) => (order.get(a.target) ?? 0) - (order.get(b.target) ?? 0));

  return { selected: sel, nodes, links };
}
