/**
 * Files from the Neume Viewer (neume.monodi.app, repository CM-Transcriptionseq): the whole
 * workspace (`cm-workspace-backup`) or some manuscripts of it (`cm-manuscript-export`).
 *
 *   { schemaVersion: 2, type, data: {
 *       personalTables: [{ name, source, notes, rows: [{ pattern, customId, notes }] }],
 *       regions:        { "<source>_<folio>": [{ id, name: "Line 8", points }] },
 *       regionItems:    { "<region id>": [{ id, pattern, points, variant, linkData: { sysId } }] },
 *       iiifLinks:      { "<source>": manifest url } } }
 *
 * They are turned into the annotation exchange file of the Neumen-Editor, so that one preview
 * and one merge (`annotation-exchange.ts`) serve both: a neume table row becomes an
 * `equivalents` row (the `customId` is the Reference ID), a line region and its snippets keep
 * their ids. Pure functions on plain data.
 */

import * as VM from './types/model';
import { EXCHANGE_FORMAT, EXCHANGE_VERSION, ExchangeFile, ExchangeSource, parseExchange } from './annotation-exchange';
import { convertNeumeDocs, isNeumeDocs } from './neume-docs-import';

export const CM_BACKUP_TYPES = ['cm-workspace-backup', 'cm-manuscript-export'];

/** True for a file the Neume Viewer wrote. */
export function isCmTranscriptionFile(data: any): boolean {
  return !!data && typeof data === 'object' && CM_BACKUP_TYPES.includes(data.type) && !!data.data;
}

/** Splits a key `"Source_Folio"` at its LAST underscore: a source's name can contain one (`WiSch 4_5`). */
export function splitRegionKey(key: string): { source: string; folio: string } | null {
  const at = key.lastIndexOf('_');
  if (at <= 0 || at === key.length - 1) return null;
  return { source: key.slice(0, at), folio: key.slice(at + 1) };
}

const text = (v: unknown): string => (v === undefined || v === null ? '' : String(v)).trim();

/** The newest schema this reader knows; a newer file may hold things it would silently skip. */
const KNOWN_SCHEMA = 2;

export function convertCmTranscriptionFile(file: any): ExchangeFile {
  if (!isCmTranscriptionFile(file)) throw new Error('This is not a file from the Neume Viewer.');
  if (typeof file.schemaVersion === 'number' && file.schemaVersion > KNOWN_SCHEMA) {
    throw new Error('This file was written by a newer version of the Neume Viewer. Update Monodi-Zero to read it.');
  }
  const d = file.data;
  const bySource = new Map<string, ExchangeSource>();
  const sourceOf = (name: string): ExchangeSource => {
    let s = bySource.get(name);
    if (!s) {
      s = { quellensigle: name, equivalents: [], annotationRegions: [], annotationItems: [] };
      bySource.set(name, s);
    }
    return s;
  };

  // --- neume tables: a row says which Reference ID a pattern has in this manuscript ---
  for (const table of Array.isArray(d.personalTables) ? d.personalTables : []) {
    const name = text(table?.source) || text(table?.name);
    if (!name) continue;
    const s = sourceOf(name);
    const seen = new Set((s.equivalents ?? []).map(e => e.pattern));
    for (const row of Array.isArray(table.rows) ? table.rows : []) {
      const pattern = text(row?.pattern);
      if (!pattern || seen.has(pattern)) continue;   // the first row of a pattern wins
      seen.add(pattern);
      const eq: VM.EquivalentMetadata = { pattern, refId: text(row.customId) };
      if (text(row.notes)) eq.notes = text(row.notes);
      s.equivalents!.push(eq);
    }
    if (text(table.notes)) s.notationNotes = text(table.notes);
  }

  // --- line regions and their snippets ---
  const regionIds = new Set<string>();
  for (const [key, list] of Object.entries<any>(d.regions ?? {})) {
    if (!Array.isArray(list) || !list.length) continue;       // pages that were opened and left empty
    const k = splitRegionKey(key);
    if (!k) continue;
    const s = sourceOf(k.source);
    for (const r of list) {
      const id = text(r?.id);
      if (!id || !text(r.points)) continue;
      regionIds.add(id);
      // `folio` is Monodi's canvas index, which this file does not know; the label is what the writer knew
      s.annotationRegions!.push({ id, name: text(r.name), points: text(r.points), folio: '', folioLabel: k.folio });
      for (const it of Array.isArray(d.regionItems?.[id]) ? d.regionItems[id] : []) {
        const itemId = text(it?.id);
        if (!itemId || !text(it.points)) continue;
        const item: VM.AnnotationItem = { id: itemId, regionId: id, pattern: text(it.pattern), points: text(it.points) };
        if (text(it.variant)) item.variant = text(it.variant);
        if (text(it.linkData?.sysId)) item.sysId = text(it.linkData.sysId);
        s.annotationItems!.push(item);
      }
    }
  }

  // --- manifests ---
  for (const [name, url] of Object.entries<any>(d.iiifLinks ?? {})) {
    if (text(url)) sourceOf(name).iiifManifestUrl = text(url);
  }

  // a source named only by a manifest link says nothing else: leave it out
  const sources = [...bySource.values()].filter(s =>
    s.equivalents!.length || s.annotationRegions!.length || s.notationNotes);
  return { format: EXCHANGE_FORMAT, version: EXCHANGE_VERSION, generator: 'Neume Viewer', exportedAt: file.exportedAt, sources };
}

/**
 * Reads an annotation file of any of the kinds: the Neumen-Editor's exchange file, a Neume Viewer backup, or a
 * documentation published by the Neumen-Editor (`neume-docs.json` with its manuscript files in it, see
 * `readAnnotationFiles`).
 */
export function parseAnnotationFile(json: string | any): ExchangeFile {
  const data = typeof json === 'string' ? JSON.parse(json) : json;
  if (isCmTranscriptionFile(data)) return convertCmTranscriptionFile(data);
  if (isNeumeDocs(data)) return convertNeumeDocs(data);
  try {
    return parseExchange(data);
  } catch (e: any) {
    if (data?.format === EXCHANGE_FORMAT) throw e;   // the right kind of file, but unreadable: say why
    throw new Error('This is neither an annotation file or documentation from the Neumen-Editor nor a backup or manuscript export from the Neume Viewer.');
  }
}
