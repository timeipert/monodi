/**
 * Annotations coming from the Neumen-Editor.
 *
 * The editor is where line regions, snippets and neume tables are made; this app
 * is where the transcription lives. One small file carries them across:
 *
 *   { format: 'cm-annotation-exchange', version: 1, generator, exportedAt,
 *     sources: [{ id, quellensigle, iiifManifestUrl?, equivalents[],
 *                 annotationRegions[], annotationItems[] }] }
 *
 * The records are this app's own (`Source.equivalents / annotationRegions /
 * annotationItems`). Pure functions on plain data: the caller reads the file,
 * shows the plan, and saves what the plan says.
 *
 * Merge rules (INTEGRATION-PLAN.md §4.2):
 *  - by id: regions and snippets are matched by `id`, equivalents by `pattern`;
 *  - the editor owns geometry, names, patterns, variants and Ref-IDs: where both
 *    sides have a record, the file's values win;
 *  - this app owns the links to the transcription: `lineUUID` and an item's `uuid`
 *    are taken from the file only when it has one, and never blanked;
 *  - nothing is deleted: a record only here stays (deletions do not travel yet);
 *  - the manifest address is taken only when the source has none.
 */

import * as VM from './types/model';
import { Source } from './api.service';

export const EXCHANGE_FORMAT = 'cm-annotation-exchange';
export const EXCHANGE_VERSION = 1;

export interface ExchangeSource {
  id?: string;
  quellensigle?: string | string[];
  iiifManifestUrl?: string;
  equivalents?: VM.EquivalentMetadata[];
  annotationRegions?: VM.AnnotationRegion[];
  annotationItems?: VM.AnnotationItem[];
}

export interface ExchangeFile {
  format: typeof EXCHANGE_FORMAT;
  version: number;
  generator?: string;
  exportedAt?: string;
  sources: ExchangeSource[];
}

export interface MergeCounts {
  regionsNew: number;
  regionsUpdated: number;
  itemsNew: number;
  itemsUpdated: number;
  equivalentsNew: number;
  equivalentsUpdated: number;
  /** Snippets in the file whose line region is nowhere (not in the file, not here). */
  itemsDropped: number;
  manifestSet: boolean;
}

export interface MergePlan {
  /** The source this applies to. */
  sourceId: string;
  label: string;
  counts: MergeCounts;
  /** The fields to write into the source; absent fields are not touched. */
  result: Pick<Source, 'equivalents' | 'annotationRegions' | 'annotationItems' | 'iiifManifestUrl'>;
}

/** Read an exchange file; throws a message a person can act on. */
export function parseExchange(json: string | any): ExchangeFile {
  const data = typeof json === 'string' ? JSON.parse(json) : json;
  if (!data || data.format !== EXCHANGE_FORMAT) {
    throw new Error('This is not an annotation file from the Neumen-Editor.');
  }
  if (typeof data.version !== 'number' || data.version > EXCHANGE_VERSION) {
    throw new Error('This file was written by a newer version of the Neumen-Editor. Update Monodi-Zero to read it.');
  }
  return { ...data, sources: Array.isArray(data.sources) ? data.sources : [] } as ExchangeFile;
}

const text = (v: unknown): string => (v === undefined || v === null ? '' : String(v));
const sigleOf = (s: { quellensigle?: string | string[] }): string =>
  Array.isArray(s.quellensigle) ? s.quellensigle.join(', ') : text(s.quellensigle);

/** The local source an exchanged one belongs to: by id first (it survives a renamed siglum), then by siglum. */
export function matchSource(incoming: ExchangeSource, locals: Source[]): Source | null {
  if (incoming.id) {
    const byId = locals.find(s => s.id === incoming.id);
    if (byId) return byId;
  }
  const sigle = sigleOf(incoming);
  if (sigle) {
    const bySigle = locals.find(s => sigleOf(s as any) === sigle);
    if (bySigle) return bySigle;
  }
  return null;
}

const PAGE_FIELDS = ['name', 'points', 'folio', 'folioLabel', 'canvasId', 'imageId'] as const;

function mergeRegion(local: VM.AnnotationRegion | undefined, incoming: VM.AnnotationRegion): { region: VM.AnnotationRegion; changed: boolean } {
  const base: any = local ? { ...local } : { id: text(incoming.id) };
  let changed = !local;
  for (const f of PAGE_FIELDS) {
    const v = (incoming as any)[f];
    if (v === undefined || v === null || v === '') continue; // the file says nothing: keep what is here
    if (base[f] !== v) { base[f] = v; changed = true; }
  }
  // The link to the transcription is this app's: take the file's only if it has one.
  if (incoming.lineUUID && base.lineUUID !== incoming.lineUUID) { base.lineUUID = incoming.lineUUID; changed = true; }
  // A new region always has the three required fields.
  base.name = text(base.name);
  base.points = text(base.points);
  base.folio = text(base.folio);
  return { region: base as VM.AnnotationRegion, changed };
}

const ITEM_FIELDS = ['regionId', 'pattern', 'points'] as const;

function mergeItem(local: VM.AnnotationItem | undefined, incoming: VM.AnnotationItem): { item: VM.AnnotationItem; changed: boolean } {
  const base: any = local ? { ...local } : { id: text(incoming.id) };
  let changed = !local;
  for (const f of ITEM_FIELDS) {
    const v = (incoming as any)[f];
    if (v === undefined || v === null || v === '') continue; // the file says nothing: keep what is here
    if (base[f] !== v) { base[f] = v; changed = true; }
  }
  // "No variant" is a statement too: the file may clear one.
  if (incoming.variant !== undefined && incoming.variant !== null) {
    const v = text(incoming.variant);
    if (text(base.variant) !== v) { base.variant = v || undefined; changed = true; }
  }
  // The link to the transcription is this app's: take the file's only if it has one.
  if (incoming.uuid && base.uuid !== incoming.uuid) { base.uuid = incoming.uuid; changed = true; }
  base.pattern = text(base.pattern);
  base.points = text(base.points);
  return { item: base as VM.AnnotationItem, changed };
}

/**
 * What importing one source's annotations would do. Nothing is changed: the
 * caller shows `counts` and, on confirmation, writes `result` into the source.
 */
export function planMerge(local: Source, incoming: ExchangeSource): MergePlan {
  const counts: MergeCounts = {
    regionsNew: 0, regionsUpdated: 0, itemsNew: 0, itemsUpdated: 0,
    equivalentsNew: 0, equivalentsUpdated: 0, itemsDropped: 0, manifestSet: false
  };

  // --- regions ---
  const regions: VM.AnnotationRegion[] = (local.annotationRegions ?? []).map(r => ({ ...r }));
  const regionIndex = new Map(regions.map((r, i): [string, number] => [text(r.id), i]));
  for (const r of incoming.annotationRegions ?? []) {
    const id = text(r.id);
    if (!id) continue;
    const at = regionIndex.get(id);
    const { region, changed } = mergeRegion(at === undefined ? undefined : regions[at], r);
    if (at === undefined) { regionIndex.set(id, regions.length); regions.push(region); counts.regionsNew++; }
    else if (changed) { regions[at] = region; counts.regionsUpdated++; }
  }

  // --- items: only into regions that exist after the merge ---
  const items: VM.AnnotationItem[] = (local.annotationItems ?? []).map(i => ({ ...i }));
  const itemIndex = new Map(items.map((i, k): [string, number] => [text(i.id), k]));
  for (const i of incoming.annotationItems ?? []) {
    const id = text(i.id);
    if (!id) continue;
    const at = itemIndex.get(id);
    const regionId = text(i.regionId) || (at === undefined ? '' : text(items[at].regionId));
    if (!regionIndex.has(regionId)) { counts.itemsDropped++; continue; }
    const { item, changed } = mergeItem(at === undefined ? undefined : items[at], i);
    if (at === undefined) { itemIndex.set(id, items.length); items.push(item); counts.itemsNew++; }
    else if (changed) { items[at] = item; counts.itemsUpdated++; }
  }

  // --- equivalents, by pattern ---
  const equivalents: VM.EquivalentMetadata[] = (local.equivalents ?? []).map(e => ({ ...e }));
  const eqIndex = new Map(equivalents.map((e, k): [string, number] => [e.pattern, k]));
  for (const e of incoming.equivalents ?? []) {
    if (!e || !e.pattern) continue;
    const at = eqIndex.get(e.pattern);
    if (at === undefined) {
      eqIndex.set(e.pattern, equivalents.length);
      const row: VM.EquivalentMetadata = { pattern: e.pattern, refId: text(e.refId) };
      if (e.notes) row.notes = e.notes;
      equivalents.push(row);
      counts.equivalentsNew++;
    } else {
      const row = equivalents[at];
      let changed = false;
      if (e.refId && row.refId !== e.refId) { row.refId = e.refId; changed = true; }
      if (e.notes && row.notes !== e.notes) { row.notes = e.notes; changed = true; }
      if (changed) counts.equivalentsUpdated++;
    }
  }

  const result: MergePlan['result'] = { equivalents, annotationRegions: regions, annotationItems: items };
  if (!local.iiifManifestUrl && incoming.iiifManifestUrl) {
    result.iiifManifestUrl = incoming.iiifManifestUrl;
    counts.manifestSet = true;
  } else if (local.iiifManifestUrl) {
    result.iiifManifestUrl = local.iiifManifestUrl;
  }

  return {
    sourceId: text(local.id),
    label: sigleOf(local as any) || text(local.id),
    counts,
    result
  };
}

/** What a plan does, in a sentence fragment: "1 new line region, 2 new snippets, 1 table row updated". '' if nothing. */
export function describePlan(plan: MergePlan): string {
  const c = plan.counts;
  const n = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;
  return [
    c.regionsNew && `${n(c.regionsNew, 'new line region')}`,
    c.regionsUpdated && `${n(c.regionsUpdated, 'line region')} updated`,
    c.itemsNew && `${n(c.itemsNew, 'new snippet')}`,
    c.itemsUpdated && `${n(c.itemsUpdated, 'snippet')} updated`,
    c.equivalentsNew && `${n(c.equivalentsNew, 'new table row')}`,
    c.equivalentsUpdated && `${n(c.equivalentsUpdated, 'table row')} updated`,
    c.manifestSet && 'sets the manifest address'
  ].filter(Boolean).join(', ');
}

/** Whether applying the plan changes anything. */
export function planChangesAnything(plan: MergePlan): boolean {
  const c = plan.counts;
  return !!(c.regionsNew || c.regionsUpdated || c.itemsNew || c.itemsUpdated
    || c.equivalentsNew || c.equivalentsUpdated || c.manifestSet);
}

/** Write a plan's result into a copy of the source. */
export function applyPlan(local: Source, plan: MergePlan): Source {
  const out: Source = { ...local };
  out.equivalents = plan.result.equivalents;
  out.annotationRegions = plan.result.annotationRegions;
  out.annotationItems = plan.result.annotationItems;
  if (plan.result.iiifManifestUrl) out.iiifManifestUrl = plan.result.iiifManifestUrl;
  return out;
}

export interface ImportPreview {
  plans: MergePlan[];
  /** Sources in the file that match nothing here. */
  unmatched: string[];
}

/** Plan a whole file against the local sources. */
export function planImport(file: ExchangeFile, locals: Source[]): ImportPreview {
  const plans: MergePlan[] = [];
  const unmatched: string[] = [];
  const seen = new Set<string>();
  for (const incoming of file.sources) {
    const local = matchSource(incoming, locals);
    if (!local) { unmatched.push(sigleOf(incoming) || text(incoming.id) || '(unnamed)'); continue; }
    if (seen.has(text(local.id))) continue; // the same source twice in one file: first one wins
    seen.add(text(local.id));
    plans.push(planMerge(local, incoming));
  }
  return { plans, unmatched };
}
