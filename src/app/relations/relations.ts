import type { Document } from '../api.service';

/**
 * Two things the data can say about documents beyond their genre:
 *  - a *relation*: this document refers to another one (a trope to the antiphon of its manuscript that is its primary chant);
 *  - a *unit*: documents that belong together as one whole on a higher level than their genre (a play and its chants).
 * Both are plain custom document fields; the print reads them later. Nothing here knows about the print.
 */
export const RELATION_TARGET_KEY = 'relation_target';
export const RELATION_TYPE_KEY = 'relation_type';
export const UNIT_ID_KEY = 'unit_id';
export const UNIT_TYPE_KEY = 'unit_type';
export const UNIT_POSITION_KEY = 'unit_position';

export const RELATION_FIELDS: { key: string; label: string }[] = [
  { key: RELATION_TARGET_KEY, label: 'Related document' },
  { key: RELATION_TYPE_KEY, label: 'Relation type' },
  { key: UNIT_ID_KEY, label: 'Unit ID' },
  { key: UNIT_TYPE_KEY, label: 'Unit type' },
  { key: UNIT_POSITION_KEY, label: 'Position in unit' },
];

/**
 * What a relation is called and the suffix the related document's number gets in the print ("1" → "1P").
 * `relation_type` holds the name; a document with a related document but no type has the first type of the list.
 */
export interface RelationType { name: string; suffix: string }

export const DEFAULT_RELATION_TYPES: RelationType[] = [{ name: 'Primary chant', suffix: 'P' }];

export function relationTypes(settings: { relationTypes?: RelationType[] } | null | undefined): RelationType[] {
  const own = (settings?.relationTypes ?? []).filter((t) => t && (t.name ?? '').trim());
  return own.length ? own : DEFAULT_RELATION_TYPES;
}

/** Adds the relation and unit fields to the custom document fields, so the grid, the document form and the print see them. Null when all are there. */
export function withRelationFields<S extends { customDocumentFields?: { key: string; label: string }[] }>(settings: S): S | null {
  const have = new Set((settings.customDocumentFields ?? []).map((f) => f.key));
  const missing = RELATION_FIELDS.filter((f) => !have.has(f.key));
  if (!missing.length) return null;
  return { ...settings, customDocumentFields: [...(settings.customDocumentFields ?? []), ...missing] };
}

export type FindingKind =
  | 'target-missing' | 'target-self' | 'target-other-source' | 'target-ambiguous' | 'relation-cycle'
  | 'type-unknown' | 'type-without-target'
  | 'unit-single' | 'unit-type-mixed' | 'unit-position-invalid' | 'unit-position-duplicate';

export interface Finding {
  kind: FindingKind;
  /** A broken reference cannot be followed (error); the rest can be printed but is probably not meant (warning). */
  severity: 'error' | 'warning';
  /** The document the finding is about (its internal id) and the ID the user sees. */
  id: string;
  dokumentenId: string;
  message: string;
}

export const FINDING_TITLE: Record<FindingKind, string> = {
  'target-missing': 'Related document does not exist',
  'target-self': 'Document is related to itself',
  'target-other-source': 'Related document is in another manuscript',
  'target-ambiguous': 'Related document ID belongs to several documents',
  'relation-cycle': 'Relations form a circle',
  'type-unknown': 'Relation type is not in the list',
  'type-without-target': 'Relation type without a related document',
  'unit-single': 'Unit has only one document',
  'unit-type-mixed': 'Documents of one unit have different unit types',
  'unit-position-invalid': 'Position in unit is not a number',
  'unit-position-duplicate': 'Two documents of a unit have the same position',
};

export interface RelationReport {
  findings: Finding[];
  /** Documents with a related document / distinct units. */
  relations: number;
  units: number;
}

const text = (d: Document, key: string): string => String(d.custom?.[key] ?? '').trim();

/**
 * Looks for what would go wrong in a print: a relation that leads nowhere, a circle, a unit whose positions clash.
 * A related document is looked for in the manuscript of the document first, as the primary chant of a trope is the one
 * its own manuscript has; one that exists only in another manuscript is found, but reported.
 */
export function checkRelations(documents: readonly Document[], settings: { relationTypes?: RelationType[] } | null | undefined): RelationReport {
  const findings: Finding[] = [];
  const add = (d: Document, kind: FindingKind, severity: Finding['severity'], message: string) =>
    findings.push({ kind, severity, id: d.id ?? '', dokumentenId: d.dokumenten_id ?? '', message });

  const byDokumentenId = new Map<string, Document[]>();
  for (const d of documents) {
    const key = (d.dokumenten_id ?? '').trim();
    if (key) (byDokumentenId.get(key) ?? byDokumentenId.set(key, []).get(key)!).push(d);
  }

  const knownTypes = new Set(relationTypes(settings).map((t) => t.name.trim().toLowerCase()));
  /** document → the document it refers to, where that could be resolved (for the circle search) */
  const resolved = new Map<Document, Document>();
  let relations = 0;

  for (const d of documents) {
    const target = text(d, RELATION_TARGET_KEY);
    const type = text(d, RELATION_TYPE_KEY);
    if (!target) {
      if (type) add(d, 'type-without-target', 'warning', `Relation type "${type}" is set, but no related document.`);
      continue;
    }
    relations++;
    if (type && !knownTypes.has(type.toLowerCase())) add(d, 'type-unknown', 'warning', `"${type}" is not one of the relation types.`);
    if (target === (d.dokumenten_id ?? '').trim()) { add(d, 'target-self', 'error', 'The related document is this document.'); continue; }
    const candidates = byDokumentenId.get(target) ?? [];
    if (!candidates.length) { add(d, 'target-missing', 'error', `There is no document "${target}".`); continue; }
    const sameSource = candidates.filter((c) => c.quelle_id === d.quelle_id);
    if (sameSource.length === 1) { resolved.set(d, sameSource[0]); continue; }
    if (sameSource.length > 1) { add(d, 'target-ambiguous', 'error', `"${target}" belongs to ${sameSource.length} documents of this manuscript.`); continue; }
    if (candidates.length > 1) { add(d, 'target-ambiguous', 'error', `"${target}" belongs to ${candidates.length} documents, none of this manuscript.`); continue; }
    add(d, 'target-other-source', 'warning', `"${target}" is in another manuscript.`);
    resolved.set(d, candidates[0]);
  }

  // circles: A → B → A. Every document of a circle is reported once.
  const inCircle = new Set<Document>();
  const done = new Set<Document>();
  for (const start of resolved.keys()) {
    if (done.has(start)) continue;
    const path: Document[] = [];
    const onPath = new Map<Document, number>();
    let cur: Document | undefined = start;
    while (cur && !done.has(cur)) {
      if (onPath.has(cur)) { for (const m of path.slice(onPath.get(cur)!)) inCircle.add(m); break; }
      onPath.set(cur, path.length);
      path.push(cur);
      cur = resolved.get(cur);
    }
    for (const p of path) done.add(p);
  }
  for (const d of inCircle) add(d, 'relation-cycle', 'error', `"${d.dokumenten_id}" leads back to itself through its related documents.`);

  // units
  const units = new Map<string, Document[]>();
  for (const d of documents) {
    const id = text(d, UNIT_ID_KEY);
    if (id) (units.get(id) ?? units.set(id, []).get(id)!).push(d);
  }
  for (const [id, members] of units) {
    if (members.length === 1) add(members[0], 'unit-single', 'warning', `Unit "${id}" has no other document.`);
    const types = [...new Set(members.map((m) => text(m, UNIT_TYPE_KEY)).filter(Boolean))];
    if (types.length > 1) add(members[0], 'unit-type-mixed', 'warning', `Unit "${id}" has the types ${types.map((t) => `"${t}"`).join(', ')}.`);
    const seen = new Map<number, Document>();
    for (const m of members) {
      const raw = text(m, UNIT_POSITION_KEY);
      if (!raw) continue;
      const pos = Number(raw.replace(',', '.'));
      if (!Number.isFinite(pos)) { add(m, 'unit-position-invalid', 'warning', `"${raw}" is not a number (unit "${id}").`); continue; }
      const other = seen.get(pos);
      if (other) add(m, 'unit-position-duplicate', 'warning', `Position ${raw} of unit "${id}" is also used by "${other.dokumenten_id}".`);
      else seen.set(pos, m);
    }
  }

  return { findings, relations, units: units.size };
}
