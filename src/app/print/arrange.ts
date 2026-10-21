import type { Document } from '../api.service';
import { RELATION_TARGET_KEY, RELATION_TYPE_KEY, RelationType, UNIT_ID_KEY, UNIT_POSITION_KEY, relationTypes } from '../relations/relations';

/**
 * The order and the numbers of the documents of one manuscript in a print, when documents belong together:
 *  - a *unit* (a play) stands together as one block, its documents in the order of their position in the unit
 *    (those without a position after them, in the order they came),
 *  - a document that another one names as its *related document* (the antiphon that is the primary chant of a trope)
 *    stands directly behind that document and is numbered like it with the suffix of the relation type: 1 → 1P.
 * Everything else keeps its place and is numbered 1, 2, 3 … as before. Pure: the caller says where the document of an item is.
 */
export interface Arranged<T> {
  items: T[];
  /** The number each item gets in the frame before it and in the contents ("3", "3P"). */
  labels: string[];
}

const text = (d: Document, key: string): string => String(d.custom?.[key] ?? '').trim();

/** The suffix of a relation type; a type without one still has to tell the related document from its source. */
function suffixOf(type: string, types: RelationType[]): string {
  const t = types.find((x) => x.name.trim().toLowerCase() === type.trim().toLowerCase()) ?? types[0];
  return (t?.suffix ?? '').trim() || (t?.name ?? 'P').trim().charAt(0).toUpperCase() || 'P';
}

export function arrangeChapter<T>(items: readonly T[], docOf: (item: T) => Document, settings?: { relationTypes?: RelationType[] } | null): Arranged<T> {
  const types = relationTypes(settings);

  // ── units: one block at the place of its first document ──
  const members = new Map<string, T[]>();
  for (const it of items) {
    const unit = text(docOf(it), UNIT_ID_KEY);
    if (unit) (members.get(unit) ?? members.set(unit, []).get(unit)!).push(it);
  }
  const positionOf = (it: T): number => {
    const raw = text(docOf(it), UNIT_POSITION_KEY).replace(',', '.');
    const n = raw === '' ? NaN : Number(raw);
    return Number.isFinite(n) ? n : NaN;
  };
  const seq: T[] = [];
  const emitted = new Set<string>();
  for (const it of items) {
    const unit = text(docOf(it), UNIT_ID_KEY);
    if (!unit) { seq.push(it); continue; }
    if (emitted.has(unit)) continue;
    emitted.add(unit);
    const block = members.get(unit)!;
    const placed = block.filter((m) => !Number.isNaN(positionOf(m)));
    // a stable sort: equal positions keep the order they came in
    placed.sort((a, b) => positionOf(a) - positionOf(b));
    seq.push(...placed, ...block.filter((m) => Number.isNaN(positionOf(m))));
  }

  // ── relations: the related document stands behind the first document that names it ──
  const byId = new Map<string, T[]>();
  for (const it of seq) {
    const id = String(docOf(it).dokumenten_id ?? '').trim();
    if (id) (byId.get(id) ?? byId.set(id, []).get(id)!).push(it);
  }
  const parentOf = new Map<T, T>();      // related document → the document it stands behind
  const suffixFor = new Map<T, string>();
  for (let i = 0; i < seq.length; i++) {
    const src = seq[i];
    const d = docOf(src);
    const target = text(d, RELATION_TARGET_KEY);
    if (!target) continue;
    const found = byId.get(target) ?? [];
    if (found.length !== 1) continue;                    // missing or ambiguous: the check reports it, the print leaves it be
    const rel = found[0];
    if (rel === src || parentOf.has(rel)) continue;      // itself, or already behind another document
    const relUnit = text(docOf(rel), UNIT_ID_KEY);
    if (relUnit && relUnit !== text(d, UNIT_ID_KEY)) continue;   // it belongs to another unit, whose block must not be broken
    // a circle: the document that would move is one the source stands behind
    let up: T | undefined = src;
    while (up && up !== rel) up = parentOf.get(up);
    if (up === rel) continue;
    parentOf.set(rel, src);
    suffixFor.set(rel, suffixOf(text(d, RELATION_TYPE_KEY), types));
    // it moves with everything that already stands behind it, and goes behind its source and what already stands behind that
    const moving = seq.filter((x) => x === rel || isBehind(x, rel, parentOf));
    for (const x of moving) seq.splice(seq.indexOf(x), 1);
    let at = seq.indexOf(src) + 1;
    while (at < seq.length && isBehind(seq[at], src, parentOf)) at++;
    seq.splice(at, 0, ...moving);
    i = Math.min(i, seq.indexOf(src));    // positions moved: look again from the source on
  }

  // ── numbers ──
  const labels = new Map<T, string>();
  let n = 0;
  for (const it of seq) {
    const parent = parentOf.get(it);
    labels.set(it, parent ? labels.get(parent)! + suffixFor.get(it)! : String(++n));
  }
  return { items: seq, labels: seq.map((it) => labels.get(it)!) };
}

/** True when `it` stands behind `root` through a chain of related documents. */
function isBehind<T>(it: T, root: T, parentOf: Map<T, T>): boolean {
  for (let p = parentOf.get(it); p; p = parentOf.get(p)) if (p === root) return true;
  return false;
}
