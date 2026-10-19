/**
 * The neume tree (the "Zeichenbaum" of the Corpus Monodicum volumes): the patterns of a table arranged
 * from left to right by the number of notes, each one grown out of a shorter one that it contains. The
 * same rules as the Neumen-Editor's (neume-docs), so a manuscript's tree looks the same in both.
 *
 * To compare patterns the brackets are turned into hyphens. A hyphen stands between two notes that are
 * written as one connected group:
 *
 *   [*u]   ->  *-u
 *   *u     ->  *u
 *   *ud[ud] -> *udu-d
 *   [*ud]  ->  *-u-d
 *
 * A note is its movement (`*` start, `u`, `d`, `e`) with the signs it carries. A pattern grows out of the
 * longest shorter pattern that is a *subsequence* of it: the same notes from the start, and every hyphen the
 * shorter one has is there in the longer one too. So `*u` branches into `*ud` and `*u-d`, while `[*u]`
 * (`*-u`) is not under `*u` — it has as many notes — but under `*`. A pattern whose shorter relatives are not
 * in the set grows out of the nearest one that is, or out of the root.
 *
 * Pure functions on strings and numbers.
 */

import { baseCode } from './notation-order';

const OPEN = ['[', '{'];
const CLOSE = [']', '}'];
const MOVEMENT = ['*', 'u', 'd', 'e'];

/** From top to bottom in the picture: what goes up is above what stays, and what goes down is below. */
const MOVE_RANK: { [move: string]: number } = { '*': 0, u: 1, e: 2, d: 3 };

/** The virga, the sign that sorts last (at the bottom of the picture). */
const VIRGA = 'V';

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
export function parseTreeCode(code: string): ParsedTreeCode | null {
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
  parent: TreeNode | null;
  children: TreeNode[];
}

export interface NeumeTree {
  root: TreeNode;
  /** In reading order: the branches top to bottom, depth first. */
  nodes: TreeNode[];
  /** The nodes by number of notes (only the numbers that occur). */
  columns: { count: number; nodes: TreeNode[] }[];
  /** The codes that are not neume shapes (clef, custos …). */
  skipped: string[];
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

/** Plain notes first, then notes with a sign of their own, the virga last. */
function signRank(note: string): number {
  const marks = note.slice(1);
  return marks.includes(VIRGA) ? 2 : marks ? 1 : 0;
}

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

/** Arrange codes as a tree. */
export function buildNeumeTree(codes: Iterable<string>): NeumeTree {
  const byText = new Map<string, TreeNode>();
  const skipped: string[] = [];
  for (const raw of codes) {
    const code = baseCode(raw);
    if (!code) continue;
    const parsed = parseTreeCode(code);
    if (!parsed) { if (!skipped.includes(code)) skipped.push(code); continue; }
    let node = byText.get(parsed.text);
    if (!node) {
      node = { id: parsed.text, text: parsed.text, code, codes: [], notes: parsed.notes, links: parsed.links, count: parsed.count, parent: null, children: [] };
      byText.set(parsed.text, node);
    }
    if (!node.codes.includes(code)) node.codes.push(code);
  }
  // Written two ways, a node is shown under the plainer one.
  for (const node of byText.values()) node.code = [...node.codes].sort((a, b) => a.length - b.length)[0];

  const root: TreeNode = { id: '', text: '', code: '', codes: [], notes: [], links: [], count: 0, parent: null, children: [] };
  const all = [...byText.values()];
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

  const nodes: TreeNode[] = [];
  const walk = (node: TreeNode): void => {
    node.children.sort(compareNodes);
    for (const child of node.children) { nodes.push(child); walk(child); }
  };
  walk(root);

  const counts = [...new Set(nodes.map(n => n.count))].sort((a, b) => a - b);
  return { root, nodes, columns: counts.map(count => ({ count, nodes: nodes.filter(n => n.count === count) })), skipped };
}

// ── Where everything goes ────────────────────────────────────────────────────────────────────

export interface BoxSize { w: number; h: number; /** where, from the top of the box, the lines meet it (default: the middle) */ anchorY?: number }
export interface PlacedBox { x: number; y: number; w: number; h: number; anchorY: number }
export interface TreeEdge { from: TreeNode; to: TreeNode; x1: number; y1: number; x2: number; y2: number }

export interface TreeLayout {
  width: number;
  height: number;
  boxes: Map<TreeNode, PlacedBox>;
  /** One column for the root and one for each number of notes. */
  columns: { count: number; x: number; w: number }[];
  edges: TreeEdge[];
}

/**
 * Place the nodes: one column for each number of notes, left to right; the branches of a node one below the other,
 * the node level with the middle of its branches. `size` is the box of a node (what it shows and its label).
 */
export function layoutNeumeTree(tree: NeumeTree, size: (node: TreeNode) => BoxSize, columnGap = 64, rowGap = 12): TreeLayout {
  const { root } = tree;
  const sizes = new Map<TreeNode, Required<BoxSize>>();
  const sizeOf = (node: TreeNode): Required<BoxSize> => {
    let s = sizes.get(node);
    if (!s) {
      const raw = size(node) || { w: 0, h: 0 };
      s = { w: raw.w, h: raw.h, anchorY: raw.anchorY === undefined ? raw.h / 2 : raw.anchorY };
      sizes.set(node, s);
    }
    return s;
  };

  const columns = [{ count: 0, x: 0, w: sizeOf(root).w }];
  for (const col of tree.columns) columns.push({ count: col.count, x: 0, w: Math.max(0, ...col.nodes.map(n => sizeOf(n).w)) });
  let cursor = 0;
  columns.forEach((col, i) => { col.x = cursor; cursor += col.w + (i < columns.length - 1 ? columnGap : 0); });
  const columnOf = new Map(columns.map(c => [c.count, c]));

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
    for (const child of node.children) { place(child, childTop); childTop += room.get(child)!; }
    const first = boxes.get(node.children[0])!;
    const last = boxes.get(node.children[node.children.length - 1])!;
    const meet = (first.y + first.anchorY + last.y + last.anchorY) / 2;
    boxes.set(node, { x, y: Math.max(top + rowGap / 2, meet - s.anchorY), w: s.w, h: s.h, anchorY: s.anchorY });
  };
  place(root, 0);

  const edges: TreeEdge[] = tree.nodes.map(node => {
    const a = boxes.get(node.parent!)!, b = boxes.get(node)!;
    return { from: node.parent!, to: node, x1: a.x + a.w + 4, y1: a.y + a.anchorY, x2: b.x - 4, y2: b.y + b.anchorY };
  });
  return { width: cursor, height: room.get(root)!, boxes, columns, edges };
}

/** An edge as an SVG path: straight when level, else an S-curve. */
export function edgePath(e: TreeEdge): string {
  const r = (n: number) => Math.round(n * 100) / 100;
  if (e.y1 === e.y2) return `M ${r(e.x1)} ${r(e.y1)} L ${r(e.x2)} ${r(e.y2)}`;
  const mid = (e.x1 + e.x2) / 2;
  return `M ${r(e.x1)} ${r(e.y1)} C ${r(mid)} ${r(e.y1)}, ${r(mid)} ${r(e.y2)}, ${r(e.x2)} ${r(e.y2)}`;
}
