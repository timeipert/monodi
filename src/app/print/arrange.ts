import type { Document } from '../api.service';
import { RelationFieldMap, RelationType, fieldText, relationFields, relationTypes } from '../relations/relations';

/**
 * The order and the numbers of the documents of one chapter in a print, when documents belong together:
 *  - a *unit* (a play) stands together as one block, its documents in the order of their position in the unit
 *    (those without a position after them, in the order they came),
 *  - a document that another one names as its *related document* (the antiphon that is the primary chant of a trope)
 *    is numbered like that document plus the suffix of the relation type: 1 → 1P. As in the printed volume it stands
 *    in a section of its own behind the others (`block`, with the heading of the relation type), or directly behind
 *    its trope (`behind`). A play stays whole: what belongs to a document of the play stands behind it.
 *  - when two documents name the same related document it stands once; the second one is followed by a line that
 *    points to it ("2P siehe 1P"), as the printed volume does.
 * Everything else keeps its place and is numbered 1, 2, 3 … as before. Pure: the caller says where the document of an item is.
 */
export interface SeeNote { label: string; to: string }

export interface Arranged<T> {
  items: T[];
  /** The number each item gets in the frame before it and in the contents ("3", "3P"). */
  labels: string[];
  /** The heading of the section that begins at an item (the related documents behind the others), else null. */
  sections: (string | null)[];
  /** Lines "2P siehe 1P" that follow an item. */
  see: SeeNote[][];
}

export type RelatedAt = 'block' | 'behind';

const text = fieldText;

/** What chapters a print has besides the manuscripts: a unit is a chapter of its own. Keys of units start with this. */
export const UNIT_CHAPTER = '\u0002';

function typeOf(type: string, types: RelationType[]): RelationType {
  return types.find((x) => x.name.trim().toLowerCase() === type.trim().toLowerCase()) ?? types[0];
}

/** The suffix of a relation type; a type without one still has to tell the related document from its source. */
function suffixOf(t: RelationType): string {
  return (t.suffix ?? '').trim() || (t.name ?? 'P').trim().charAt(0).toUpperCase() || 'P';
}

/**
 * The chapter of each document: a unit is a chapter of its own (a document that a document of the unit names as its
 * related document goes with it), everything else is a chapter by its manuscript. Chapters keep the order of first appearance.
 */
export function chapterKeyFn<T>(items: readonly T[], docOf: (item: T) => Document, sourceKeyOf: (item: T) => string, settings?: { relationFields?: Partial<RelationFieldMap> } | null): (item: T) => string {
  const F = relationFields(settings);
  const byId = new Map<string, T[]>();
  for (const it of items) {
    const id = String(docOf(it).dokumenten_id ?? '').trim();
    if (id) (byId.get(id) ?? byId.set(id, []).get(id)!).push(it);
  }
  const pulled = new Map<T, string>();
  for (const it of items) {
    const d = docOf(it);
    const unit = text(d, F.unitId);
    const target = text(d, F.target);
    if (!unit || !target) continue;
    const found = (byId.get(target) ?? []).filter((c) => sourceKeyOf(c) === sourceKeyOf(it));
    if (found.length === 1 && !text(docOf(found[0]), F.unitId) && !pulled.has(found[0])) pulled.set(found[0], UNIT_CHAPTER + unit);
  }
  return (it) => {
    const unit = text(docOf(it), F.unitId);
    return unit ? UNIT_CHAPTER + unit : pulled.get(it) ?? sourceKeyOf(it);
  };
}

export function arrangeChapter<T>(
  items: readonly T[], docOf: (item: T) => Document, settings?: { relationTypes?: RelationType[]; relationFields?: Partial<RelationFieldMap> } | null, relatedAt: RelatedAt = 'block',
): Arranged<T> {
  const types = relationTypes(settings);
  const F = relationFields(settings);

  // ── units: one block at the place of its first document ──
  const members = new Map<string, T[]>();
  for (const it of items) {
    const unit = text(docOf(it), F.unitId);
    if (unit) (members.get(unit) ?? members.set(unit, []).get(unit)!).push(it);
  }
  const positionOf = (it: T): number => {
    const raw = text(docOf(it), F.unitPosition).replace(',', '.');
    const n = raw === '' ? NaN : Number(raw);
    return Number.isFinite(n) ? n : NaN;
  };
  const seq: T[] = [];
  const emitted = new Set<string>();
  for (const it of items) {
    const unit = text(docOf(it), F.unitId);
    if (!unit) { seq.push(it); continue; }
    if (emitted.has(unit)) continue;
    emitted.add(unit);
    const block = members.get(unit)!;
    const placed = block.filter((m) => !Number.isNaN(positionOf(m)));
    // a stable sort: equal positions keep the order they came in
    placed.sort((a, b) => positionOf(a) - positionOf(b));
    seq.push(...placed, ...block.filter((m) => Number.isNaN(positionOf(m))));
  }

  // ── relations: the first document that names a related document owns it; later ones only point to it ──
  const byId = new Map<string, T[]>();
  for (const it of seq) {
    const id = String(docOf(it).dokumenten_id ?? '').trim();
    if (id) (byId.get(id) ?? byId.set(id, []).get(id)!).push(it);
  }
  const parentOf = new Map<T, T>();           // related document → the document that owns it
  const typeFor = new Map<T, RelationType>();  // related document → the type of that relation
  const pointsTo = new Map<T, T>();            // a document that names an owned related document → that document
  const kidsOf = new Map<T, T[]>();
  const isBelow = (it: T, root: T): boolean => { for (let p = parentOf.get(it); p; p = parentOf.get(p)) if (p === root) return true; return false; };
  for (const src of seq) {
    const d = docOf(src);
    const target = text(d, F.target);
    if (!target) continue;
    const found = byId.get(target) ?? [];
    if (found.length !== 1) continue;                    // missing or ambiguous: the check reports it, the print leaves it be
    const rel = found[0];
    if (rel === src || isBelow(src, rel)) continue;      // itself, or a circle
    const relUnit = text(docOf(rel), F.unitId);
    if (relUnit && relUnit !== text(d, F.unitId)) continue;   // it belongs to another unit, whose block must not be broken
    if (parentOf.has(rel)) { pointsTo.set(src, rel); continue; }
    parentOf.set(rel, src);
    typeFor.set(rel, typeOf(text(d, F.type), types));
    (kidsOf.get(src) ?? kidsOf.set(src, []).get(src)!).push(rel);
  }

  // ── the final order ──
  const out: T[] = [];
  const sectionAt = new Map<T, string>();
  const unitOf = (it: T) => text(docOf(it), F.unitId);
  const inBlock = new Set<T>();
  const block: T[] = [];
  const emit = (it: T, into: T[]): void => {
    into.push(it);
    for (const kid of kidsOf.get(it) ?? []) {
      // a play stays whole; the rest goes behind the others in `block` mode
      if (relatedAt === 'block' && (!unitOf(kid) || unitOf(kid) !== unitOf(it))) { inBlock.add(kid); emitBlockTree(kid); }
      else emit(kid, into);
    }
  };
  const emitBlockTree = (it: T): void => {
    block.push(it);
    for (const kid of kidsOf.get(it) ?? []) { inBlock.add(kid); emitBlockTree(kid); }
  };
  const roots = seq.filter((it) => !parentOf.has(it));
  for (const r of roots) emit(r, out);
  const mainCount = out.length;
  out.push(...block);

  // where the lines "siehe" go: after the document that points, or — for related documents that stand in the section —
  // at that document's turn in the section
  const pointers = [...pointsTo.keys()];
  const after = new Map<T, T[]>();
  const place = (src: T): T => {
    const rel = pointsTo.get(src)!;
    if (!inBlock.has(rel)) {
      // inline: behind the document and what stands behind it
      let last = src;
      for (let i = out.indexOf(src) + 1; i < out.length && isBelow(out[i], src); i++) last = out[i];
      return last;
    }
    // in the section: behind the last related document of the documents up to this one
    const order = roots.indexOf(src);
    let last: T | null = null;
    for (const b of block) {
      let top = b;
      while (parentOf.has(top)) top = parentOf.get(top)!;
      const at = roots.indexOf(top);
      if (at !== -1 && at <= order) last = b;
    }
    return last ?? src;
  };
  for (const src of pointers) {
    const at = place(src);
    (after.get(at) ?? after.set(at, []).get(at)!).push(src);
  }

  // ── numbers, sections, lines ──
  const labels = new Map<T, string>();
  let n = 0;
  for (const it of out) {
    const parent = parentOf.get(it);
    labels.set(it, parent ? labels.get(parent)! + suffixOf(typeFor.get(it)!) : String(++n));
  }
  let lastHeading: string | null = null;
  out.forEach((it, i) => {
    if (i < mainCount) return;
    const t = typeFor.get(it);
    const heading = ((t?.heading ?? '').trim() || (t?.name ?? '').trim()) || null;
    if (heading && heading !== lastHeading) sectionAt.set(it, heading);
    lastHeading = heading;
  });
  const noteOf = (src: T): SeeNote => {
    const suffix = suffixOf(typeOf(text(docOf(src), F.type), types));
    return { label: labels.get(src)! + suffix, to: labels.get(pointsTo.get(src)!)! };
  };
  return {
    items: out,
    labels: out.map((it) => labels.get(it)!),
    sections: out.map((it) => sectionAt.get(it) ?? null),
    see: out.map((it) => (after.get(it) ?? []).map(noteOf)),
  };
}
