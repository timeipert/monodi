import * as _ from 'lodash';
import type { Document, ProjectSettings, Source } from './api.service';
import { SOURCE_DESCRIPTION_KEY, sourceDescription } from './source-description';

/**
 * Renaming a source's siglum and merging two sources, as plain functions on the data: nothing is read or written here.
 *
 * What the siglum is: documents and the files on GitHub (`manuscripts/<id>.json`) hang on the source's *id*, so a new
 * siglum moves no document and no file. The siglum is a text, and it is repeated as text in a few places of the
 * settings: the list of sigla, the MEI rules that apply to one manuscript, the volume rules of the print that name
 * manuscripts. Those follow the rename here; everything else that looks like a siglum (document IDs such as "Aa 13-8-4",
 * comments, the cover text) is the person's own text and stays as it is.
 *
 * A merge makes the source that already carries the new siglum the one that stays (its id and its file on GitHub),
 * moves the documents of the other one over and takes over what the other one knows. Where both know something
 * different, the person chooses; nothing is dropped silently.
 */

export interface SigleRequest {
  /** The source being renamed (or absorbed, if the new siglum is already taken). */
  sourceId: string;
  newSigle: string;
  /** Merge only: per conflicting field (`FieldConflict.key`), which value the merged source gets. Default `kept`. */
  choices?: { [key: string]: FieldChoice };
}

/** `kept`: the value of the source that stays; `other`: the value of the absorbed one; `both`: both, one after the other (text fields only). */
export type FieldChoice = 'kept' | 'other' | 'both';

export interface SigleData {
  sources: Source[];
  documents: Document[];
  settings: Partial<ProjectSettings> | null;
}

export interface FieldConflict {
  /** `quellentyp`, `custom.<key>`, `equivalent:<pattern>` … */
  key: string;
  label: string;
  kept: string;
  other: string;
  choice: FieldChoice;
  /** Whether `both` is offered: free text can be joined, a place or a type cannot. */
  canJoin: boolean;
}

/** What the change does to the settings. */
export interface SettingsEffect {
  /** The siglum is in the list of sigla (the datalist of the source form). */
  siglumList: boolean;
  /** MEI rules that were for the old siglum and are now for the new one. */
  meiRulesMoved: number;
  /** MEI rules for the old siglum that were not carried over because one for the same neume and the other siglum exists. */
  meiRulesDropped: number;
  /** Volume rules in which the old siglum was replaced. */
  volumeRules: number;
}

export interface SiglePlan {
  kind: 'none' | 'rename' | 'merge';
  /** Why the change cannot be made. Empty: it can. */
  problems: string[];
  oldSigle: string;
  newSigle: string;
  /** The source that stays (the renamed one, or the one already carrying the sigle). */
  keepId: string;
  /** Merge: the source that is absorbed and removed. */
  dropId: string | null;
  documents: {
    /** Documents of the absorbed source that change their source. */
    moved: number;
    /** Documents of the stayed source. */
    kept: number;
    /** Records that are the same document in both sources, identical: kept once. */
    duplicates: number;
    /** Document IDs (`dokumenten_id`) used in both sources: they are not unique in the merged source. */
    clashingIds: string[];
    clashingIdsTotal: number;
  };
  /** Rename: documents whose ID starts with the old siglum. They keep their IDs. */
  idsWithOldSigle: number;
  conflicts: FieldConflict[];
  /** Annotations the absorbed source brings (regions, items, transcription annotations) that the stayed one does not have. */
  annotationsTaken: number;
  settings: SettingsEffect;
}

/** What to store. Null where nothing changes. */
export interface SigleOutcome {
  sources: Source[];
  /** Null: the document list stays as it is. */
  documents: Document[] | null;
  /** Null: the settings stay as they are. */
  settings: Partial<ProjectSettings> | null;
  /** Sources whose file on GitHub has to be uploaded. */
  dirtyIds: string[];
  /** The source whose file on GitHub has to go, once `dirtyIds` is up (merge only). */
  deletedId: string | null;
}

const MAX_CLASHES_SHOWN = 20;

const norm = (s: unknown): string => String(s ?? '').trim().toLowerCase();

/** The siglum as text (old data kept a list). */
export function sigleText(s: { quellensigle?: unknown } | null | undefined): string {
  const v = s?.quellensigle;
  return (Array.isArray(v) ? v.join(', ') : String(v ?? '')).trim();
}

const SOURCE_LABELS: { [key: string]: string } = {
  herkunftsregion: 'Region of origin', herkunftsort: 'Place of origin', herkunftsinstitution: 'Institution of origin',
  ordenstradition: 'Order / tradition', quellentyp: 'Source type', bibliotheksort: 'Library town', bibliothek: 'Library',
  bibliothekssignatur: 'Shelfmark', kommentar: 'Comment', datierung: 'Dating', iiifManifestUrl: 'IIIF manifest',
  assignedTo: 'Assigned to',
};

/** Fields that are handled one by one, not as a plain value. */
const SPECIAL = new Set(['id', 'quellensigle', 'custom', 'equivalents', 'annotationRegions', 'annotationItems', 'transcriptionAnnotations']);
const ANNOTATION_LISTS = ['annotationRegions', 'annotationItems', 'transcriptionAnnotations'] as const;

const isEmpty = (v: unknown): boolean => v === undefined || v === null || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0);
const show = (v: unknown): string => typeof v === 'string' ? v : Array.isArray(v) && v.every((x) => typeof x === 'string') ? v.join(', ') : JSON.stringify(v ?? '');

/** The custom fields with the old key of the description folded into the new one, as a copy. */
function customOf(s: Source): { [key: string]: string } {
  const c = { ...(s.custom ?? {}) };
  const description = sourceDescription(s);
  delete c['beschreibung'];
  if (description.trim()) c[SOURCE_DESCRIPTION_KEY] = description;
  return c;
}

function joinText(a: string, b: string): string {
  return [a, b].filter((x) => x.trim()).join('\n\n');
}

interface MergedSource { source: Source; conflicts: FieldConflict[]; problems: string[]; annotationsTaken: number }

/** The source that stays, taking over what the absorbed one knows. See `FieldConflict` for what is left to the person. */
function mergeSources(keep: Source, drop: Source, choices: { [key: string]: FieldChoice }): MergedSource {
  const conflicts: FieldConflict[] = [];
  const problems: string[] = [];
  const merged: any = { ...keep };
  let annotationsTaken = 0;

  const decide = (key: string, label: string, kept: string, other: string, canJoin: boolean): FieldChoice => {
    const asked = choices[key];
    const choice: FieldChoice = asked === 'other' || (asked === 'both' && canJoin) ? asked : 'kept';
    conflicts.push({ key, label, kept, other, choice, canJoin });
    return choice;
  };

  // plain fields (strings, lists of strings such as `assignedTo`)
  const keys = new Set([...Object.keys(keep), ...Object.keys(drop)].filter((k) => !SPECIAL.has(k)));
  for (const k of keys) {
    const a = (keep as any)[k], b = (drop as any)[k];
    if (isEmpty(b) || _.isEqual(a, b)) continue;
    if (isEmpty(a)) { merged[k] = b; continue; }
    if (Array.isArray(a) && Array.isArray(b) && [...a, ...b].every((x) => typeof x === 'string')) {
      merged[k] = [...new Set([...a, ...b])];
      continue;
    }
    const canJoin = k === 'kommentar' && typeof a === 'string' && typeof b === 'string';
    const choice = decide(k, SOURCE_LABELS[k] ?? k, show(a), show(b), canJoin);
    if (choice === 'other') merged[k] = b;
    else if (choice === 'both') merged[k] = joinText(a, b);
  }

  // custom fields (the description is one of them)
  const ca = customOf(keep), cb = customOf(drop);
  const custom: { [key: string]: string } = { ...ca };
  for (const k of Object.keys(cb)) {
    if (isEmpty(cb[k]) || ca[k] === cb[k]) continue;
    if (isEmpty(ca[k])) { custom[k] = cb[k]; continue; }
    const choice = decide('custom.' + k, k === SOURCE_DESCRIPTION_KEY ? 'Description' : k, ca[k], cb[k], true);
    if (choice === 'other') custom[k] = cb[k];
    else if (choice === 'both') custom[k] = joinText(ca[k], cb[k]);
  }
  if (Object.keys(custom).length > 0 || keep.custom || drop.custom) merged.custom = custom;

  // equivalents: one entry per neume pattern
  if (keep.equivalents || drop.equivalents) {
    const list = [...(keep.equivalents ?? [])];
    for (const e of drop.equivalents ?? []) {
      const i = list.findIndex((x) => x.pattern === e.pattern);
      if (i < 0) { list.push(e); annotationsTaken++; continue; }
      if (_.isEqual(list[i], e)) continue;
      const choice = decide('equivalent:' + e.pattern, 'Equivalent ' + e.pattern, equivalentText(list[i]), equivalentText(e), false);
      if (choice === 'other') list[i] = e;
    }
    merged.equivalents = list;
  }

  // annotations: the same id with different content cannot be told apart, so it is not guessed
  for (const name of ANNOTATION_LISTS) {
    const a: any[] | undefined = (keep as any)[name], b: any[] | undefined = (drop as any)[name];
    if (!a && !b) continue;
    const list = [...(a ?? [])];
    let clashes = 0;
    for (const x of b ?? []) {
      const i = list.findIndex((y) => y.id === x.id);
      if (i < 0) { list.push(x); annotationsTaken++; }
      else if (!_.isEqual(list[i], x)) clashes++;
    }
    if (clashes > 0) problems.push(`${clashes} ${clashes === 1 ? 'annotation exists' : 'annotations exist'} in both sources with the same ID and different content (${name}).`);
    merged[name] = list;
  }

  return { source: merged as Source, conflicts, problems, annotationsTaken };
}

const equivalentText = (e: { refId?: string; notes?: string }): string => [e.refId, e.notes].filter(Boolean).join(' – ');

/** Volume rules that name manuscripts by their siglum. */
const SIGLE_RULE_FIELDS = new Set(['quelle-id', 'quellensigle', 'sigle']);

/**
 * The settings with the siglum `from` replaced by `to` where the settings repeat it. `winner` says whose MEI rule stays
 * when both sigla have one for the same neume: the old one (a rename: the rules of the renamed manuscript) or the new
 * one (a merge: the rules of the manuscript that stays). Returns the same object when nothing changes.
 */
export function relabelSigle(
  settings: Partial<ProjectSettings> | null,
  from: string,
  to: string,
  winner: 'from' | 'to',
): { settings: Partial<ProjectSettings> | null; effect: SettingsEffect } {
  const effect: SettingsEffect = { siglumList: false, meiRulesMoved: 0, meiRulesDropped: 0, volumeRules: 0 };
  if (!settings || !norm(from) || from.trim() === to.trim()) return { settings, effect };
  const out: any = { ...settings };
  const f = norm(from), t = norm(to);

  // the list of sigla: the old one becomes the new one, once
  if (Array.isArray(out.quellensigle) && out.quellensigle.some((x: unknown) => norm(x) === f)) {
    const seen = new Set<string>();
    out.quellensigle = out.quellensigle
      .map((x: string) => norm(x) === f ? to.trim() : x)
      .filter((x: string) => { const k = norm(x); if (seen.has(k)) return false; seen.add(k); return true; });
    effect.siglumList = true;
  }

  // MEI rules for one manuscript
  if (Array.isArray(out.meiProfiles)) {
    out.meiProfiles = out.meiProfiles.map((profile: any) => {
      if (!Array.isArray(profile?.patternRules) || !profile.patternRules.some((r: any) => norm(r?.sigle) === f)) return profile;
      const rules: any[] = profile.patternRules;
      const result: any[] = [];
      for (const r of rules) {
        const samePattern = (x: any) => x !== r && x?.pattern === r?.pattern;
        if (norm(r?.sigle) === f) {
          if (winner === 'to' && rules.some((x) => samePattern(x) && norm(x?.sigle) === t)) { effect.meiRulesDropped++; continue; }
          result.push({ ...r, sigle: to.trim() });
          effect.meiRulesMoved++;
        } else if (winner === 'from' && norm(r?.sigle) === t && rules.some((x) => samePattern(x) && norm(x?.sigle) === f)) {
          effect.meiRulesDropped++;   // a leftover rule for the new siglum gives way to the renamed manuscript's
        } else {
          result.push(r);
        }
      }
      return { ...profile, patternRules: result };
    });
  }

  // volume rules that name manuscripts
  if (Array.isArray(out.volumeRules)) {
    out.volumeRules = out.volumeRules.map((rule: any) => {
      if (!rule || !SIGLE_RULE_FIELDS.has(rule.field) || !Array.isArray(rule.values) || !rule.values.some((v: unknown) => norm(v) === f)) return rule;
      const seen = new Set<string>();
      const values = rule.values.map((v: string) => norm(v) === f ? to.trim() : v).filter((v: string) => { const k = norm(v); if (seen.has(k)) return false; seen.add(k); return true; });
      effect.volumeRules++;
      return { ...rule, values };
    });
  }

  const changed = effect.siglumList || effect.meiRulesMoved > 0 || effect.meiRulesDropped > 0 || effect.volumeRules > 0;
  return { settings: changed ? out : settings, effect };
}

function noPlan(request: SigleRequest, oldSigle: string, problems: string[], kind: SiglePlan['kind'] = 'none'): SiglePlan {
  return {
    kind, problems, oldSigle, newSigle: request.newSigle.trim(), keepId: request.sourceId, dropId: null,
    documents: { moved: 0, kept: 0, duplicates: 0, clashingIds: [], clashingIdsTotal: 0 },
    idsWithOldSigle: 0, conflicts: [], annotationsTaken: 0,
    settings: { siglumList: false, meiRulesMoved: 0, meiRulesDropped: 0, volumeRules: 0 },
  };
}

/**
 * What changing the siglum of a source would do, and the data after it. `outcome` is null when there is nothing to do or
 * the change cannot be made (see `plan.problems`).
 */
export function planSigleChange(data: SigleData, request: SigleRequest): { plan: SiglePlan; outcome: SigleOutcome | null } {
  const source = data.sources.find((s) => s.id === request.sourceId);
  if (!source) return { plan: noPlan(request, '', ['The source does not exist (any more).']), outcome: null };
  const oldSigle = sigleText(source);
  const newSigle = request.newSigle.trim();
  if (!newSigle) return { plan: noPlan(request, oldSigle, ['The siglum must not be empty.']), outcome: null };
  if (newSigle === oldSigle) return { plan: noPlan(request, oldSigle, []), outcome: null };

  const others = data.sources.filter((s) => s.id !== source.id && norm(sigleText(s)) === norm(newSigle));
  if (others.length > 1) {
    return { plan: noPlan(request, oldSigle, [`${others.length} sources already have this siglum. Merge those first.`], 'merge'), outcome: null };
  }
  return others.length === 1
    ? planMerge(data, request, source, others[0], oldSigle)
    : planRename(data, request, source, oldSigle, newSigle);
}

function planRename(data: SigleData, request: SigleRequest, source: Source, oldSigle: string, newSigle: string) {
  const plan = noPlan(request, oldSigle, [], 'rename');
  const own = data.documents.filter((d) => d.quelle_id === source.id);
  plan.documents.kept = own.length;
  if (norm(oldSigle)) plan.idsWithOldSigle = own.filter((d) => norm(d.dokumenten_id).startsWith(norm(oldSigle))).length;

  const { settings, effect } = relabelSigle(data.settings, oldSigle, newSigle, 'from');
  plan.settings = effect;
  const sources = data.sources.map((s) => s === source ? { ...s, quellensigle: newSigle } : s);
  return { plan, outcome: { sources, documents: null, settings: settings === data.settings ? null : settings, dirtyIds: [source.id!], deletedId: null } as SigleOutcome };
}

function planMerge(data: SigleData, request: SigleRequest, drop: Source, keep: Source, oldSigle: string) {
  const plan = noPlan(request, oldSigle, [], 'merge');
  plan.newSigle = sigleText(keep);
  plan.keepId = keep.id!;
  plan.dropId = drop.id!;

  const keptDocs = data.documents.filter((d) => d.quelle_id === keep.id);
  const droppedDocs = data.documents.filter((d) => d.quelle_id === drop.id);
  plan.documents.kept = keptDocs.length;

  // the same record in both: once; the same id with different content: the person has to look at it
  const keptById = new Map(keptDocs.map((d) => [d.id, d]));
  const duplicateIds = new Set<string>();
  const different: string[] = [];
  for (const d of droppedDocs) {
    const twin = keptById.get(d.id);
    if (!twin) continue;
    if (_.isEqual({ ...twin, quelle_id: '' }, { ...d, quelle_id: '' })) duplicateIds.add(d.id);
    else different.push(d.dokumenten_id || d.id);
  }
  if (different.length > 0) {
    plan.problems.push(`${different.length} ${different.length === 1 ? 'document exists' : 'documents exist'} in both sources with the same internal ID and different content (${different.slice(0, 3).join(', ')}${different.length > 3 ? ' …' : ''}).`);
  }
  plan.documents.duplicates = duplicateIds.size;
  plan.documents.moved = droppedDocs.length - duplicateIds.size;

  const keptIds = new Set(keptDocs.map((d) => (d.dokumenten_id ?? '').trim()).filter(Boolean));
  const clashes = new Set<string>();
  for (const d of droppedDocs) {
    const id = (d.dokumenten_id ?? '').trim();
    if (id && keptIds.has(id) && !duplicateIds.has(d.id)) clashes.add(id);
  }
  plan.documents.clashingIdsTotal = clashes.size;
  plan.documents.clashingIds = [...clashes].sort().slice(0, MAX_CLASHES_SHOWN);

  const merged = mergeSources(keep, drop, request.choices ?? {});
  plan.conflicts = merged.conflicts;
  plan.problems.push(...merged.problems);
  plan.annotationsTaken = merged.annotationsTaken;

  const { settings, effect } = relabelSigle(data.settings, oldSigle, sigleText(keep), 'to');
  plan.settings = effect;
  if (plan.problems.length > 0) return { plan, outcome: null };

  const sources = data.sources.filter((s) => s !== drop).map((s) => s === keep ? merged.source : s);
  const documents = data.documents
    .filter((d) => !(d.quelle_id === drop.id && duplicateIds.has(d.id)))
    .map((d) => d.quelle_id === drop.id ? { ...d, quelle_id: keep.id! } : d);
  return {
    plan,
    outcome: { sources, documents, settings: settings === data.settings ? null : settings, dirtyIds: [keep.id!], deletedId: drop.id! } as SigleOutcome,
  };
}

/**
 * The siglum changes a list of metadata edits makes (the metadata grid edits sigla in place): old text → new text, per
 * source. The settings that repeat a siglum have to follow those, too.
 */
export function siglumRenames(before: Source[], after: Source[]): { from: string; to: string }[] {
  const old = new Map(before.map((s) => [s.id, sigleText(s)]));
  const out: { from: string; to: string }[] = [];
  for (const s of after) {
    const was = old.get(s.id);
    if (was !== undefined && was !== sigleText(s) && was) out.push({ from: was, to: sigleText(s) });
  }
  return out;
}
