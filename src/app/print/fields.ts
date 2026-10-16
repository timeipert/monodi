import type { Document, ProjectSettings, Source } from '../api.service';
import { PlaceholderLookup } from './placeholders';

/** What a print of one or several documents knows about a document: the document, its manuscript and the manuscript's sigle. */
export interface FieldJob {
  document: Document;
  source: Source | null;
  sigle: string;
}

export interface FieldDef {
  key: string;
  label: string;
  scope: 'source' | 'document' | 'derived';
}

const SOURCE_FIELDS: [string, string][] = [
  ['quellensigle', 'Sigle'], ['herkunftsregion', 'Region of origin'], ['herkunftsort', 'Place of origin'],
  ['herkunftsinstitution', 'Institution of origin'], ['ordenstradition', 'Order / tradition'], ['quellentyp', 'Source type'],
  ['bibliotheksort', 'Library town'], ['bibliothek', 'Library'], ['bibliothekssignatur', 'Shelfmark'], ['datierung', 'Dating'],
];

const DOCUMENT_FIELDS: [string, string][] = [
  ['dokumenten_id', 'Document ID'], ['textinitium', 'Incipit'], ['gattung1', 'Genre 1'], ['gattung2', 'Genre 2'],
  ['festtag', 'Feast day'], ['feier', 'Feast'], ['bibliographischerverweis', 'Reference'], ['druckausgabe', 'Edition'],
  ['foliostart', 'Folio'], ['zeilenstart', 'Line'], ['kommentar', 'Comment'],
];

/** Fields that are computed, not stored: usable in texts, not for splitting. */
const DERIVED_FIELDS: [string, string][] = [
  ['quelle', 'Manuscript (town, library, shelfmark)'], ['genre', 'Genre (1 / 2)'], ['anzahl', 'Number of documents'],
  ['quellenanzahl', 'Number of manuscripts'], ['datum', 'Date of printing'], ['jahr', 'Year of printing'],
  ['titel', 'Title (from the print dialog)'], ['gruppe', 'Value of the volume'], ['gruppenfeld', 'Field the volumes are split by'],
];

/** Other names for the same thing (also English ones, for other projects). */
const ALIASES: { [alias: string]: string } = {
  quellenid: 'quelle', source: 'quelle', sigle: 'quellensigle', id: 'dokumenten_id', initium: 'textinitium',
  region: 'herkunftsregion', place: 'herkunftsort', library: 'bibliothek', shelfmark: 'bibliothekssignatur',
  count: 'anzahl', date: 'datum', year: 'jahr', title: 'titel', group: 'gruppe', groupfield: 'gruppenfeld',
  sources: 'quellenanzahl', dating: 'datierung', genre1: 'gattung1', genre2: 'gattung2',
};

/** The text of the field `key` for one document; '' when it has none. */
export function fieldValue(job: FieldJob, key: string): string {
  const src: any = job.source || {};
  const d: any = job.document || {};
  switch (key) {
    case 'quellensigle': return String(job.sigle || src.quellensigle || '').trim();
    case 'quelle': return sourceLine(job);
    case 'genre': return [d.gattung1, d.gattung2].filter((x) => x).join(' / ');
  }
  if (SOURCE_FIELDS.some(([k]) => k === key)) return String(src[key] ?? '').trim();
  if (DOCUMENT_FIELDS.some(([k]) => k === key)) return String(d[key] ?? '').trim();
  return String(d.custom?.[key] ?? src.custom?.[key] ?? '').trim();
}

/** "Aachen, Domarchiv, Hs. G 13": town, library and shelfmark of the manuscript. */
export function sourceLine(job: FieldJob): string {
  const src: any = job.source || {};
  return [src.bibliotheksort || src.herkunftsort, src.bibliothek, src.bibliothekssignatur]
    .map((v: any) => (v || '').toString().trim()).filter(Boolean).join(', ');
}

/** Fields a print can be split by or filtered on: the manuscript, then every source and document field, custom ones last. */
export function splitFields(settings: Partial<ProjectSettings> | null | undefined): FieldDef[] {
  const out: FieldDef[] = [{ key: 'quelle-id', label: 'Manuscript', scope: 'source' }];
  for (const [key, label] of SOURCE_FIELDS) out.push({ key, label, scope: 'source' });
  for (const f of settings?.customSourceFields || []) out.push({ key: f.key, label: f.label || f.key, scope: 'source' });
  out.push({ key: 'genre', label: 'Genre', scope: 'document' });
  for (const [key, label] of DOCUMENT_FIELDS) {
    if (key !== 'dokumenten_id' && key !== 'textinitium' && key !== 'kommentar') out.push({ key, label, scope: 'document' });
  }
  for (const f of settings?.customDocumentFields || []) out.push({ key: f.key, label: f.label || f.key, scope: 'document' });
  return out;
}

/** All placeholders a text can use, with what they stand for (for the editor's list). */
export function placeholderCatalog(settings: Partial<ProjectSettings> | null | undefined, variables: { key: string }[] = []): FieldDef[] {
  const out: FieldDef[] = [];
  for (const [key, label] of DERIVED_FIELDS) out.push({ key, label, scope: 'derived' });
  for (const [key, label] of SOURCE_FIELDS) out.push({ key, label, scope: 'source' });
  for (const f of settings?.customSourceFields || []) out.push({ key: f.key, label: f.label || f.key, scope: 'source' });
  for (const [key, label] of DOCUMENT_FIELDS) out.push({ key, label, scope: 'document' });
  for (const f of settings?.customDocumentFields || []) out.push({ key: f.key, label: f.label || f.key, scope: 'document' });
  for (const v of variables) if (v.key) out.push({ key: v.key, label: 'Own variable', scope: 'derived' });
  return out;
}

/** The key (what makes two documents belong together) and the label (what the volume is called) of a document for a split field. */
export function splitKey(job: FieldJob, field: string): { key: string; label: string } {
  if (field === 'quelle-id') {
    const id = (job.source as any)?.id ?? job.sigle ?? '';
    return { key: String(id), label: fieldValue(job, 'quellensigle') || fieldValue(job, 'quelle') };
  }
  const v = fieldValue(job, field);
  return { key: v, label: v };
}

/** The different values, in order of first appearance. */
export function distinctValues(jobs: FieldJob[], key: string): string[] {
  const seen: string[] = [];
  for (const j of jobs) {
    const v = fieldValue(j, key);
    if (v && !seen.includes(v)) seen.push(v);
  }
  return seen;
}

/** Several values as one text: "A, B, C"; more than `max` are cut off with an ellipsis. */
export function joinValues(values: string[], max = 5, sep = ', '): string {
  if (values.length <= max) return values.join(sep);
  return values.slice(0, max - 1).join(sep) + sep + '…';
}

export interface LookupExtras {
  titel?: string;
  gruppe?: string;
  gruppenfeld?: string;
  now?: Date;
}

/**
 * What a placeholder stands for in a print of `jobs`: the value when all documents share it, otherwise the different
 * values side by side. Own variables come last, so a field of the data always wins over a variable of the same name.
 */
export function makeLookup(jobs: FieldJob[], settings: Partial<ProjectSettings> | null | undefined, variables: { key: string; value: string }[], extras: LookupExtras = {}): PlaceholderLookup {
  const now = extras.now ?? new Date();
  const sourceIds = new Set(jobs.map((j) => String((j.source as any)?.id ?? j.sigle ?? '')));
  const vars = new Map(variables.filter((v) => v.key).map((v) => [v.key.toLowerCase(), v.value]));
  const known = new Set(placeholderCatalog(settings).map((f) => f.key.toLowerCase()));
  const derived: { [k: string]: string } = {
    anzahl: String(jobs.length),
    quellenanzahl: String(sourceIds.size),
    datum: now.toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' }),
    jahr: String(now.getFullYear()),
    titel: (extras.titel || '').trim(),
    gruppe: (extras.gruppe || '').trim(),
    gruppenfeld: (extras.gruppenfeld || '').trim(),
  };
  return (name: string) => {
    const key = ALIASES[name] ?? name;
    if (key in derived) return derived[key];
    // manuscripts contain commas themselves, so they are told apart by semicolons
    if (key === 'quelle') return joinValues(distinctValues(jobs, key), 5, '; ');
    if (key === 'genre') return joinValues(distinctValues(jobs, key));
    const lower = key.toLowerCase();
    // data fields and custom fields (their keys keep their case)
    const field = placeholderCatalog(settings).find((f) => f.key.toLowerCase() === lower);
    if (field && field.scope !== 'derived') return joinValues(distinctValues(jobs, field.key));
    if (vars.has(lower)) return vars.get(lower);
    return known.has(lower) ? '' : undefined;
  };
}
