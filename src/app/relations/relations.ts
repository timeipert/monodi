import type { Document } from '../api.service';
import { metadataFieldLabel, metadataFieldValue } from '../document-metadata';

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
export interface RelationType {
  name: string;
  suffix: string;
  /** The title of the section in which the related documents stand in a print ("Primary chants"); the name when empty. */
  heading?: string;
}

export const DEFAULT_RELATION_TYPES: RelationType[] = [{ name: 'Primary chant', suffix: 'P', heading: 'Primary chants' }];

export function relationTypes(settings: { relationTypes?: RelationType[] } | null | undefined): RelationType[] {
  const own = (settings?.relationTypes ?? []).filter((t) => t && (t.name ?? '').trim());
  return own.length ? own : DEFAULT_RELATION_TYPES;
}

/** What a field of the data does for the print. Each role reads one document field; which one is a setting. */
export type RelationRole = 'target' | 'type' | 'unitId' | 'unitType' | 'unitPosition';
export type RelationFieldMap = Record<RelationRole, string>;

export const DEFAULT_RELATION_FIELDS: RelationFieldMap = {
  target: RELATION_TARGET_KEY, type: RELATION_TYPE_KEY, unitId: UNIT_ID_KEY, unitType: UNIT_TYPE_KEY, unitPosition: UNIT_POSITION_KEY,
};

export const RELATION_ROLES: { role: RelationRole; label: string; hint: string }[] = [
  { role: 'target', label: 'Related document', hint: 'the ID of the document this one refers to (a trope: its antiphon)' },
  { role: 'type', label: 'Relation type', hint: 'the name of one of the relation types; empty = the first type' },
  { role: 'unitId', label: 'Unit ID', hint: 'documents with the same value belong together (a play)' },
  { role: 'unitType', label: 'Unit type', hint: 'what kind of unit it is (Play)' },
  { role: 'unitPosition', label: 'Position in unit', hint: 'a number; without it the document IDs set the order' },
];

/** The field each role reads: the setting where there is one, else the built-in field. Works with any field, a standard one too. */
export function relationFields(settings: { relationFields?: Partial<RelationFieldMap> } | null | undefined): RelationFieldMap {
  const own = settings?.relationFields ?? {};
  const out = { ...DEFAULT_RELATION_FIELDS };
  for (const r of Object.keys(out) as RelationRole[]) {
    const k = typeof own[r] === 'string' ? own[r]!.trim() : '';
    if (k) out[r] = k;
  }
  return out;
}

/** What a document has in a field (standard or custom), trimmed; '' when it has none. */
export const fieldText = (d: Document, key: string): string => metadataFieldValue(d, key).trim();

/** A field the roles can read: the standard document fields, the registered custom fields and every custom key the documents carry. */
export interface FieldOption { key: string; label: string; /** how many documents have a value in it */ filled: number; /** a custom key that the settings do not list (an import brought it) */ unregistered?: boolean }

const STANDARD_ROLE_FIELDS = ['bibliographischerverweis', 'druckausgabe', 'festtag', 'feier', 'foliostart', 'zeilenstart', 'gattung1', 'gattung2', 'editionsstatus'];

export function documentFieldOptions(
  settings: { customDocumentFields?: { key: string; label: string }[] } | null | undefined, documents: readonly Document[],
): FieldOption[] {
  const count = (key: string) => documents.reduce((n, d) => n + (fieldText(d, key) ? 1 : 0), 0);
  const out: FieldOption[] = [];
  const seen = new Set<string>();
  const add = (key: string, label: string, unregistered = false) => {
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ key, label, filled: count(key), ...(unregistered ? { unregistered } : {}) });
  };
  for (const f of settings?.customDocumentFields ?? []) add(f.key, f.label || f.key);
  for (const k of STANDARD_ROLE_FIELDS) add(k, metadataFieldLabel(k, settings as any));
  const found = new Set<string>();
  for (const d of documents) for (const k of Object.keys(d.custom ?? {})) found.add(k);
  for (const k of [...found].sort((a, b) => a.localeCompare(b))) add(k, k, true);
  return out;
}

/** Adds the built-in relation and unit fields (those a role still reads) to the custom document fields, so the grid, the document form and the print see them. Null when all are there. */
export function withRelationFields<S extends { customDocumentFields?: { key: string; label: string }[]; relationFields?: Partial<RelationFieldMap> }>(settings: S): S | null {
  const have = new Set((settings.customDocumentFields ?? []).map((f) => f.key));
  const inUse = new Set(Object.values(relationFields(settings)));
  const missing = RELATION_FIELDS.filter((f) => !have.has(f.key) && inUse.has(f.key));
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

const text = fieldText;

/**
 * Looks for what would go wrong in a print: a relation that leads nowhere, a circle, a unit whose positions clash.
 * A related document is looked for in the manuscript of the document first, as the primary chant of a trope is the one
 * its own manuscript has; one that exists only in another manuscript is found, but reported.
 */
export function checkRelations(documents: readonly Document[], settings: { relationTypes?: RelationType[]; relationFields?: Partial<RelationFieldMap> } | null | undefined): RelationReport {
  const F = relationFields(settings);
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
    const target = text(d, F.target);
    const type = text(d, F.type);
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
    const id = text(d, F.unitId);
    if (id) (units.get(id) ?? units.set(id, []).get(id)!).push(d);
  }
  for (const [id, members] of units) {
    if (members.length === 1) add(members[0], 'unit-single', 'warning', `Unit "${id}" has no other document.`);
    const types = [...new Set(members.map((m) => text(m, F.unitType)).filter(Boolean))];
    if (types.length > 1) add(members[0], 'unit-type-mixed', 'warning', `Unit "${id}" has the types ${types.map((t) => `"${t}"`).join(', ')}.`);
    const seen = new Map<number, Document>();
    for (const m of members) {
      const raw = text(m, F.unitPosition);
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

/** What is wrong with a print that holds back some documents or leaves some out, as far as units and relations go. */
export function checkPrintSet(all: readonly Document[], printed: ReadonlySet<string>, held: ReadonlySet<string>, settings?: { relationFields?: Partial<RelationFieldMap> } | null): string[] {
  const F = relationFields(settings);
  const out: string[] = [];
  const names = (docs: Document[]) => {
    const n = docs.map((d) => d.dokumenten_id || d.id || '?');
    return n.length > 5 ? n.slice(0, 5).join(', ') + ', …' : n.join(', ');
  };
  const units = new Map<string, Document[]>();
  const byId = new Map<string, Document[]>();
  for (const d of all) {
    const unit = text(d, F.unitId);
    if (unit) (units.get(unit) ?? units.set(unit, []).get(unit)!).push(d);
    const id = (d.dokumenten_id ?? '').trim();
    if (id) (byId.get(id) ?? byId.set(id, []).get(id)!).push(d);
  }
  for (const [unit, members] of units) {
    if (!members.some((m) => printed.has(m.id ?? ''))) continue;
    const heldBack = members.filter((m) => held.has(m.id ?? ''));
    const left = members.filter((m) => !printed.has(m.id ?? '') && !held.has(m.id ?? ''));
    if (heldBack.length) out.push(`Unit "${unit}" is printed with gaps: ${heldBack.length} of ${members.length} documents are held back (${names(heldBack)}).`);
    if (left.length) out.push(`Unit "${unit}" is printed with gaps: ${left.length} of ${members.length} documents are not in this print (${names(left)}).`);
  }
  for (const d of all) {
    if (!printed.has(d.id ?? '')) continue;
    const target = text(d, F.target);
    if (!target) continue;
    const found = (byId.get(target) ?? []).filter((c) => c.quelle_id === d.quelle_id);
    if (found.length !== 1) continue;
    const rel = found[0];
    if (held.has(rel.id ?? '')) out.push(`"${d.dokumenten_id}" refers to "${target}", which is held back.`);
    else if (!printed.has(rel.id ?? '')) out.push(`"${d.dokumenten_id}" refers to "${target}", which is not in this print.`);
  }
  return out;
}
