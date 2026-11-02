/**
 * The neume tree (the "Zeichenbaum" of the Corpus Monodicum volumes): the patterns of a table arranged from
 * left to right by the number of notes, each one grown out of a shorter one that it contains.
 *
 * A pattern (also called a code) is the text that describes one neume shape: `*` is the first note, `u`, `e` and
 * `d` are further notes that go up, stay level or go down, capital letters after a note are signs on that note
 * (`V` is the virga), and brackets (`[ ]` or `{ }`) join notes into one connected group.
 *
 * To compare patterns the brackets are turned into hyphens. A hyphen stands between two notes that are written as
 * one connected group:
 *
 *   [*u]        ->  *-u
 *   *u          ->  *u
 *   *ud[ud]     ->  *udu-d
 *   [*ud]       ->  *-u-d
 *
 * A note is its movement (`*` start, `u`, `d`, `e`) with the signs it carries, so `*V` (a virga) is a note of its
 * own, never the same as `*`.
 *
 * A pattern grows out of the longest shorter pattern that is a subsequence of it: the same notes from the start
 * (`*u` in `*ud`, `*Vd` in `*V`), and every hyphen the shorter one has is there in the longer one too. So `*u`
 * branches into `*ud` and `*u-d`, while `[*u]` (`*-u`) is not under `*u` (it has as many notes) but under `*`. A
 * pattern whose shorter relatives are not in the set grows out of the nearest one that is, or out of the root.
 *
 * The tree can be gone on with, and cut back. Going on from a box makes the boxes that grow out of it (one more
 * note, up, level or down, written apart or joined to the one before), so a tree can have more columns than the
 * patterns that were chosen. Hiding a box takes it, and everything that grows out of it, out of the picture. Both
 * are lists of the boxes' notation.
 *
 * Used by Monodi-Zero (`apps/monodi`) and neume-docs (`apps/neume-docs`). Pure functions on strings and numbers:
 * no framework, no browser, no imports.
 */

const OPEN = ['[', '{'];
const CLOSE = [']', '}'];
const MOVEMENT = ['*', 'u', 'd', 'e'];

/** From top to bottom in the picture: what goes up is above what stays, and what goes down is below. */
const MOVE_RANK: { [move: string]: number } = { '*': 0, u: 1, e: 2, d: 3 };

/**
 * The virga, the sign that sorts last (at the bottom of the picture) and the one sign every neume-docs workspace
 * has. neume-docs checks in its tests that this is the key of its first default sign.
 */
export const VIRGA = 'V';

/**
 * A pattern as typed: the first word of it. A legacy variant letter after a blank (`*u b`) is dropped, blanks around
 * the pattern are ignored, and nothing (null, undefined) is an empty pattern.
 */
export const baseCode = (pattern: string | null | undefined): string => String(pattern ?? '').trim().split(/\s+/)[0] ?? '';

export interface ParsedTreeCode {
  code: string;
  /** The movement and signs of each note (`*`, `uV`). */
  notes: string[];
  /** `links[i]`: note i and i + 1 are one connected group. */
  links: boolean[];
  /** The code with hyphens. */
  text: string;
  count: number;
}

/** The notes of a code and which of them are connected; null for what is not a neume shape (clef, custos, a marker). */
export function parseTreeCode(code: string | null | undefined): ParsedTreeCode | null {
  const src = baseCode(code);
  if (!src || !src.includes('*')) return null;
  const moves: string[] = [];
  const marks: string[] = [];
  const groups: number[] = [];
  let current = 0;
  let made = 0;
  for (const ch of src) {
    if (OPEN.includes(ch)) { current = ++made; continue; }
    if (CLOSE.includes(ch)) { current = 0; continue; }
    if (MOVEMENT.includes(ch)) {
      moves.push(ch);
      marks.push('');
      groups.push(current);
    } else if (/[A-Z]/.test(ch) && moves.length) {
      marks[marks.length - 1] += ch;
    }
  }
  if (!moves.length || moves[0] !== '*') return null;
  const notes = moves.map((m, i) => m + marks[i]);
  const links = notes.slice(1).map((_, i) => groups[i] !== 0 && groups[i] === groups[i + 1]);
  const text = notes.map((n, i) => n + (links[i] ? '-' : '')).join('');
  return { code: src, notes, links, text, count: notes.length };
}

/**
 * Whether a code has a special sign: a sign on a note other than the virga (`L`, `O`, `Q`, `S`, a sign of the
 * project). The virga is told from a plain note in the tree; the others are details a tree leaves out unless asked.
 */
export function hasSpecialSign(code: string | null | undefined): boolean {
  const parsed = parseTreeCode(code);
  return !!parsed && parsed.notes.some(note => note.slice(1).split(VIRGA).join('') !== '');
}

/** The code with hyphens for the connected notes (`[*u]` -> `*-u`), or '' when it is not a neume shape. */
export function treeNotation(code: string | null | undefined): string {
  const parsed = parseTreeCode(code);
  return parsed ? parsed.text : '';
}

/**
 * The code of notes and the hyphens between them: `*`, `u`, `d` with a hyphen after `u` is `*[ud]`.
 * `links[i]`: note i and i + 1 are one group.
 */
export function treeCode(notes: string[], links: boolean[]): string {
  let out = '';
  for (let i = 0; i < notes.length; i++) {
    const joinedBefore = i > 0 && links[i - 1];
    if (links[i] && !joinedBefore) out += '[';
    out += notes[i];
    if (joinedBefore && !links[i]) out += ']';
  }
  return out;
}

export interface TreeNode {
  id: string;
  /** The notation with hyphens. */
  text: string;
  /** How it is shown: the plainest way it was written. */
  code: string;
  /** Every way it was written (`[*]` and `*` are one node). */
  codes: string[];
  notes: string[];
  links: boolean[];
  count: number;
  /** One of the codes given; otherwise the node was made by going on. */
  chosen: boolean;
  /** Boxes were made from it by going on. */
  grown: boolean;
  /** Going on from it would make something (`allow` says yes to one of its continuations). */
  canGrow: boolean;
  parent: TreeNode | null;
  children: TreeNode[];
}

/** What can come after a node: one more note, up, level or down, apart from the one before or joined to it. */
export function continuations(node: Pick<TreeNode, 'notes' | 'links'>): string[] {
  const out: string[] = [];
  for (const move of ['u', 'e', 'd']) {
    for (const joined of [false, true]) out.push(treeCode([...node.notes, move], [...node.links, joined]));
  }
  return out;
}

/**
 * How well `above` is a subsequence of `below`: 0 not at all, 1 when `below` has more hyphens in the part they
 * share, 2 when they have the same ones.
 */
function containment(above: TreeNode, below: TreeNode): number {
  if (above.count >= below.count) return 0;
  for (let i = 0; i < above.count; i++) if (above.notes[i] !== below.notes[i]) return 0;
  let same = true;
  for (let i = 0; i < above.count - 1; i++) {
    if (above.links[i] && !below.links[i]) return 0;
    if (above.links[i] !== below.links[i]) same = false;
  }
  return same ? 2 : 1;
}

const linkCount = (n: TreeNode): number => n.links.filter(Boolean).length;

/** Plain notes first, then notes with a sign of their own, the virga last (at the bottom of the picture). */
function signRank(note: string): number {
  const marks = note.slice(1);
  return marks.includes(VIRGA) ? 2 : marks ? 1 : 0;
}

/** One note before another, top to bottom: without a virga above the virga; then up above level above down. */
function compareNote(a: string, b: string): number {
  const sa = signRank(a), sb = signRank(b);
  if (sa !== sb) return sa - sb;
  const ra = MOVE_RANK[a[0]], rb = MOVE_RANK[b[0]];
  if (ra !== rb) return ra - rb;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The order of the branches of one node, top to bottom. */
function compareNodes(a: TreeNode, b: TreeNode): number {
  const shared = Math.min(a.count, b.count);
  for (let i = 0; i < shared; i++) {
    if (a.notes[i] !== b.notes[i]) return compareNote(a.notes[i], b.notes[i]);
  }
  if (a.count !== b.count) return a.count - b.count;
  for (let i = 0; i < a.links.length; i++) {
    if (a.links[i] !== b.links[i]) return a.links[i] ? 1 : -1;
  }
  return 0;
}

export interface NeumeTree {
  root: TreeNode;
  /** In reading order: the branches top to bottom, depth first. */
  nodes: TreeNode[];
  /** The nodes by number of notes (only the numbers that occur). */
  columns: { count: number; nodes: TreeNode[] }[];
  /** The codes that are not neume shapes (clef, custos …). */
  skipped: string[];
  /** The boxes that were hidden (and exist). */
  hidden: TreeNode[];
  /** How many boxes are out of the picture, with what grows out of them. */
  hiddenCount: number;
}

export interface BuildOptions {
  /** The notations of the boxes that are gone on from (see `continuations`). */
  grown?: Iterable<string>;
  /** The notations of the boxes that are left out, with all that grows out of them. */
  hidden?: Iterable<string>;
  /** Which boxes going on may make (the standard table allows only its own shapes); default all. */
  allow?: (code: string) => boolean;
}

/** Arrange codes as a tree. */
export function buildNeumeTree(codes: Iterable<string> | null | undefined, { grown = [], hidden = [], allow = () => true }: BuildOptions = {}): NeumeTree {
  const byText = new Map<string, TreeNode>();
  const skipped: string[] = [];
  const growSet = new Set(grown);
  const hideSet = new Set(hidden);

  const add = (code: string, chosen: boolean): TreeNode | null => {
    const parsed = parseTreeCode(code);
    if (!parsed) return null;
    let node = byText.get(parsed.text);
    if (!node) {
      node = { id: parsed.text, text: parsed.text, code, codes: [], notes: parsed.notes, links: parsed.links, count: parsed.count, chosen: false, grown: false, canGrow: false, parent: null, children: [] };
      byText.set(parsed.text, node);
    }
    if (!node.codes.includes(code)) node.codes.push(code);
    if (chosen) node.chosen = true;
    return node;
  };

  for (const raw of codes ?? []) {
    const code = baseCode(raw);
    if (!code) continue;
    if (!add(code, true) && !skipped.includes(code)) skipped.push(code);
  }

  // Going on, a column at a time: what is made in one column can be gone on from in the next.
  for (let count = 1; ; count++) {
    const here = [...byText.values()].filter(n => n.count === count);
    if (!here.length && count > Math.max(0, ...[...byText.values()].map(n => n.count))) break;
    for (const node of here) {
      if (!growSet.has(node.text)) continue;
      for (const code of continuations(node)) {
        if (!allow(code)) continue;
        node.grown = true;
        add(code, false);
      }
    }
  }

  // Written two ways (`[*]` and `*`), a node is shown under the plainer one.
  for (const node of byText.values()) node.code = [...node.codes].sort((a, b) => a.length - b.length)[0];

  const root: TreeNode = { id: '', text: '', code: '', codes: [], notes: [], links: [], count: 0, chosen: false, grown: false, canGrow: false, parent: null, children: [] };
  const all = [...byText.values()];
  for (const node of all) node.canGrow = continuations(node).some(allow);

  for (const node of all) {
    let best: TreeNode | null = null;
    let bestFit = 0;
    for (const other of all) {
      const fit = containment(other, node);
      if (!fit) continue;
      const better = !best
        || other.count > best.count
        || (other.count === best.count && (fit > bestFit
          || (fit === bestFit && (linkCount(other) > linkCount(best)
            || (linkCount(other) === linkCount(best) && other.text < best.text)))));
      if (better) { best = other; bestFit = fit; }
    }
    node.parent = best ?? root;
    node.parent.children.push(node);
  }

  // Hiding takes a box out with everything that grows out of it.
  const hiddenNodes = all.filter(n => hideSet.has(n.text)).sort(compareNodes);
  const out = new Set<TreeNode>();
  const take = (node: TreeNode): void => { out.add(node); node.children.forEach(take); };
  hiddenNodes.forEach(take);
  for (const node of out) node.parent!.children = node.parent!.children.filter(c => c !== node);

  const nodes: TreeNode[] = [];
  const walk = (node: TreeNode): void => {
    node.children.sort(compareNodes);
    for (const child of node.children) { nodes.push(child); walk(child); }
  };
  walk(root);

  const counts = [...new Set(nodes.map(n => n.count))].sort((a, b) => a - b);
  const columns = counts.map(count => ({ count, nodes: nodes.filter(n => n.count === count) }));

  return { root, nodes, columns, skipped, hidden: hiddenNodes, hiddenCount: out.size };
}

// ── Where everything goes ────────────────────────────────────────────────────────────────────

/** How far into the gap between two columns a line goes before it bends, and how far from the next column it ends the bend. */
const BEND = 10;

export interface BoxSize {
  w: number;
  h: number;
  /** Where, from the top of the box, the lines meet it (default: the middle). */
  anchorY?: number;
}
export interface PlacedBox { x: number; y: number; w: number; h: number; anchorY: number }
export interface TreeEdge {
  from: TreeNode;
  to: TreeNode;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Where the line bends: from `xa` to `xb`, in the gap after the column of `from`. */
  xa: number;
  xb: number;
  /** The line as an SVG path: straight when level, else level to `xa`, an S-curve to `xb`, level to the box. */
  d: string;
}

export interface TreeLayout {
  width: number;
  height: number;
  boxes: Map<TreeNode, PlacedBox>;
  /** One column for each number of notes (and one for the root when it is shown). */
  columns: { count: number; x: number; w: number }[];
  edges: TreeEdge[];
}

export interface LayoutOptions {
  columnGap?: number;
  rowGap?: number;
}

/**
 * Place the nodes of a tree: one column for each number of notes, left to right; the branches of a node one below
 * the other, the node level with the middle of its branches. `size` is the box of a node (what it shows, and its
 * label). The root is not drawn: it has no box of its own in the result's columns and `size` is not asked for it;
 * the single notes (`*`, `*V`) are where the tree begins, with no line into them.
 */
export function layoutNeumeTree(tree: NeumeTree, size: (node: TreeNode) => BoxSize, { columnGap = 64, rowGap = 12 }: LayoutOptions = {}): TreeLayout {
  const { root } = tree;
  const sizes = new Map<TreeNode, Required<BoxSize>>();
  const sizeOf = (node: TreeNode): Required<BoxSize> => {
    let s = sizes.get(node);
    if (!s) {
      const raw = node === root ? { w: 0, h: 0 } : size(node) || { w: 0, h: 0 };
      s = { w: raw.w, h: raw.h, anchorY: raw.anchorY === undefined ? raw.h / 2 : raw.anchorY };
      sizes.set(node, s);
    }
    return s;
  };

  // Columns: one for each number of notes. The single notes (`*`, `*V`) are where the tree begins, each one a start
  // of its own.
  const columns = tree.columns.map(col => ({ count: col.count, x: 0, w: Math.max(0, ...col.nodes.map(n => sizeOf(n).w)) }));
  let cursor = 0;
  columns.forEach((col, i) => {
    col.x = cursor;
    cursor += col.w + (i < columns.length - 1 ? columnGap : 0);
  });
  const columnOf = new Map<number, { count: number; x: number; w: number }>([[0, { count: 0, x: 0, w: 0 }], ...columns.map(c => [c.count, c] as [number, { count: number; x: number; w: number }])]);

  // Height of a branch: its own box, or the boxes of what grows out of it, whichever is taller.
  const room = new Map<TreeNode, number>();
  const measure = (node: TreeNode): number => {
    const below = node.children.reduce((sum, c) => sum + measure(c), 0);
    const mine = Math.max(sizeOf(node).h + rowGap, below);
    room.set(node, mine);
    return mine;
  };
  measure(root);

  const boxes = new Map<TreeNode, PlacedBox>();
  const place = (node: TreeNode, top: number): void => {
    const s = sizeOf(node);
    const col = columnOf.get(node.count)!;
    const x = col.x + (col.w - s.w) / 2;
    if (!node.children.length) {
      boxes.set(node, { x, y: top + (room.get(node)! - s.h) / 2, w: s.w, h: s.h, anchorY: s.anchorY });
      return;
    }
    const below = node.children.reduce((sum, c) => sum + room.get(c)!, 0);
    let childTop = top + Math.max(0, (room.get(node)! - below) / 2);
    for (const child of node.children) {
      place(child, childTop);
      childTop += room.get(child)!;
    }
    const first = boxes.get(node.children[0])!;
    const last = boxes.get(node.children[node.children.length - 1])!;
    const meet = (first.y + first.anchorY + last.y + last.anchorY) / 2;
    boxes.set(node, { x, y: Math.max(top + rowGap / 2, meet - s.anchorY), w: s.w, h: s.h, anchorY: s.anchorY });
  };
  place(root, 0);

  const edges: TreeEdge[] = [];
  const round = (n: number): number => Math.round(n * 100) / 100;
  for (const node of tree.nodes) {
    if (node.parent === root) continue; // nothing is drawn for the root, so nothing leads from it
    const parent = node.parent!;
    const a = boxes.get(parent)!;
    const b = boxes.get(node)!;
    const x1 = a.x + a.w + 4;
    const y1 = a.y + a.anchorY;
    const x2 = b.x - 4;
    const y2 = b.y + b.anchorY;
    // The bend is made in the gap right after the parent's column, where there is nothing to cut across; the line
    // then runs level to the box. A box far to the right (a pattern that skips a column) is in the band of its own
    // branch, so the level part meets no other box.
    const gapStart = columnOf.get(parent.count)!;
    const gapEnd = columns[columns.findIndex(c => c.count === parent.count) + 1];
    const xa = Math.max(x1, gapStart.x + gapStart.w + BEND);
    const xb = Math.min(x2, gapEnd.x - BEND);
    const mid = (xa + xb) / 2;
    edges.push({
      from: parent, to: node, x1, y1, x2, y2, xa, xb,
      d: y1 === y2
        ? `M ${round(x1)} ${round(y1)} L ${round(x2)} ${round(y2)}`
        : `M ${round(x1)} ${round(y1)} L ${round(xa)} ${round(y1)} C ${round(mid)} ${round(y1)}, ${round(mid)} ${round(y2)}, ${round(xb)} ${round(y2)} L ${round(x2)} ${round(y2)}`,
    });
  }

  return { width: cursor, height: room.get(root)!, boxes, columns, edges };
}
