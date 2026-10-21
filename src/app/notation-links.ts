/**
 * How a manuscript's notation documentation and its transcription point at each other.
 *
 * The documentation (`Source.equivalents`, `annotationRegions`, `annotationItems`) and the
 * transcription (the documents' neumes) are tied in three ways:
 *
 *   pattern     a row of the table and a neume of the transcription have the same code (`[*du]`)
 *   uuid        a snippet points at the neume it depicts: the uuid of the neume's first note
 *   lineUUID    a line region points at the transcription line it covers: the LineChange that ends it
 *
 * Only the last two are stored, and files from the Neume Viewer store neither: their snippets carry
 * a reference to the transcription instead, `sysId = document|folio|line|syllable|notes`
 * (`Aa 13-8-4|8r|6|et|D4-F4`). So a link is worked out, best first:
 *
 *   stored      the snippet's `uuid` is a note of a neume (the region's `lineUUID` a LineChange)
 *   reference   the snippet's `sysId` names a neume of the transcription
 *   position    the snippets of a line region, left to right, align with the neumes of one line
 *               of the transcription, by pattern (as the Neumen-Editor's link assistant does)
 *   lost        a stored uuid that is in none of the documents (changed, or not loaded)
 *   none        nothing to go on
 *
 * Where a neume is (folio, line) is counted as the Neumen-Editor and the Neume Viewer count it, so
 * that their references can be read here: the document's `foliostart` and `zeilenstart`, then
 * `FolioChange`, `LineChange` and `|` in paratext. Pure functions on plain data.
 */

import * as VM from './types/model';
import { extractPattern, firstNoteUuid } from './transcription-analyzer-core';
import { baseCode } from './notation-order';
import { compareFolios, folioOf, lineNumberOf } from './notation-doc';

// ── Where a neume is ──────────────────────────────────────────────────────────────────────────

/**
 * A folio as the Neumen-Editor writes it (`services/corpus/folio.js`): `8` → `8r`, `008r` → `8r`,
 * `113 verso` → `113v`, `113ra` → `113r`. With the corrections it knows for some sources.
 */
export function cmFolio(value: unknown, sigle = ''): string {
  if (value === null || value === undefined) return '';
  let s = String(value).toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[()]/g, '')
    .replace(/^p\.?/, '')
    .replace(/^0+/, '')
    .replace(/recto/g, 'r').replace(/verso/g, 'v')
    .replace(/[-/][a-g1-9]$/, '')          // a column or line behind it: "113r-a", "113r/2"
    .replace(/(\d[rv]?)[a-g]$/, '$1');     // a column letter: "113ra" → "113r"
  if (!s) return '';
  if (/^\d+$/.test(s)) s = `${s}r`;        // a bare number is a leaf, i.e. its recto
  return folioQuirk(sigle, s);
}

/** "Tri 2254" skips two leaves in its foliation: from f. 334 on everything is two back (as the Neumen-Editor keeps it). */
function folioQuirk(sigle: string, folio: string): string {
  if (sigle !== 'Tri 2254') return folio;
  const m = /(\d+)/.exec(folio);
  if (!m) return folio;
  const n = Number(m[1]);
  return n >= 334 ? folio.split(m[1]).join(String(n - 2)) : folio;
}

/** What is needed of a document to place its neumes. */
export interface DocMeta {
  id: string;
  /** `dokumenten_id`, e.g. `Aa 13-8-4`: the first part of a Neume Viewer reference. */
  label: string;
  foliostart?: string;
  zeilenstart?: string;
  /** The source's siglum, for the folio corrections of `cmFolio`. */
  sigle?: string;
}

/** One neume of the transcription and where it is. */
export interface TNeume {
  docId: string;
  docLabel: string;
  folio: string;
  line: number;
  syllable: string;
  /** Its pitches, `D4-F4`. */
  notes: string;
  /** The code of the whole neume, `[*u]dd`. */
  pattern: string;
  /** The uuid of its first note: what a snippet's `uuid` points at. */
  uuid: string;
  noteUuids: string[];
  /** The uuid of the LineChange that ends its line ('' if the line has none): what a region's `lineUUID` points at. */
  lineUuid: string;
  /** Its place in the reading order of its document. */
  order: number;
}

/** The reference a Neume Viewer snippet would have for this neume. */
export const sysIdOf = (n: Pick<TNeume, 'docLabel' | 'folio' | 'line' | 'syllable' | 'notes'>): string =>
  [n.docLabel, n.folio, String(n.line), n.syllable, n.notes].join('|');

/** `folio|line`: one line of the manuscript, whichever documents have neumes on it. */
export const lineKey = (folio: string, line: number | string): string => `${folio}|${line}`;

const parseLine = (value: unknown): number | null => {
  const s = String(value ?? '').trim();
  return /^[+-]?\d+$/.test(s) ? parseInt(s, 10) : null;
};

const notesOf = (ns: VM.NonSpaced): { text: string; uuids: string[] } => {
  const pitches: string[] = [];
  const uuids: string[] = [];
  for (const g of ns?.nonSpaced ?? []) {
    for (const n of g?.grouped ?? []) {
      if (n?.base !== undefined && n?.octave !== undefined && n?.octave !== null) pitches.push(`${n.base}${n.octave}`);
      if (n?.uuid) uuids.push(n.uuid);
    }
  }
  return { text: pitches.join('-'), uuids };
};

/**
 * The neumes of one document in reading order, each with its folio and line: the document's start, then
 * `FolioChange` (a new folio starts at line 1, or at `zeilenstart` if it is the start folio again),
 * `LineChange` (the next line) and `|` in paratext (one line each).
 */
export function indexDocument(root: any, doc: DocMeta): TNeume[] {
  const sigle = doc.sigle ?? '';
  const initialFolio = cmFolio(doc.foliostart, sigle);
  const parsed = parseLine(doc.zeilenstart);
  const lineStart = parsed === null ? 1 : parsed;
  let line = lineStart > 0 ? lineStart : 1;
  let folio = initialFolio;
  const out: TNeume[] = [];
  const lineUuids = new Map<string, string>();

  const visit = (node: any): void => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(visit); return; }
    const kind = node.kind;

    if (kind === VM.LinePartKind.Syllable) {
      if ((node.syllableType ?? VM.SyllableType.Normal) !== VM.SyllableType.Normal) return;
      for (const item of node.notes?.spaced ?? []) {
        if (!Array.isArray(item?.nonSpaced) || !item.nonSpaced.length) continue;
        const pattern = extractPattern(item);
        const notes = notesOf(item);
        if (!pattern || !notes.uuids.length && !notes.text) continue;
        out.push({
          docId: doc.id, docLabel: doc.label, folio, line, syllable: node.text ?? '', notes: notes.text, pattern,
          uuid: firstNoteUuid(item), noteUuids: notes.uuids, lineUuid: '', order: out.length,
        });
      }
      return;
    }

    if (kind === VM.LinePartKind.FolioChange) {
      const next = cmFolio(node.folio ?? node.text, sigle);
      if (next !== folio) {
        folio = next;
        line = folio === initialFolio ? lineStart : 1;
      }
    } else if (kind === VM.LinePartKind.LineChange) {
      if (folio && node.uuid && !lineUuids.has(lineKey(folio, line))) lineUuids.set(lineKey(folio, line), String(node.uuid));
      line += 1;
    } else if (kind === VM.ContainerKind.ParatextContainer) {
      const text = String(node.text ?? '');
      if (text.includes('|')) line += text.split('|').length - 1;
    }

    const children = node.children ?? node.elements;
    if (Array.isArray(children)) children.forEach(visit);
  };

  visit(root);
  for (const n of out) n.lineUuid = lineUuids.get(lineKey(n.folio, n.line)) ?? '';
  return out;
}

// ── The transcription as a whole ────────────────────────────────────────────────────────────────

/** One line of the manuscript as the transcription has it. */
export interface TLine {
  folio: string;
  line: number;
  /** The LineChange that ends it ('' if none of its documents has one). */
  uuid: string;
  /** Its neumes in reading order (documents by where they start). */
  neumes: TNeume[];
}

export interface TranscriptionIndex {
  neumes: TNeume[];
  /** Every note's uuid → the neume it belongs to. */
  byNote: Map<string, TNeume>;
  bySysId: Map<string, TNeume[]>;
  /** By the neume's code (`baseCode`). */
  byPattern: Map<string, TNeume[]>;
  byLine: Map<string, TLine>;
  /** The lines of each folio, by number. */
  linesOfFolio: Map<string, number[]>;
  lineByUuid: Map<string, TLine>;
  /** How many documents have neumes. */
  documents: number;
}

/** The index of a transcription's neumes (`indexDocument` of each of its documents, in any order). */
export function buildIndex(neumes: TNeume[]): TranscriptionIndex {
  const byNote = new Map<string, TNeume>();
  const bySysId = new Map<string, TNeume[]>();
  const byPattern = new Map<string, TNeume[]>();
  const byLine = new Map<string, TLine>();
  const docStart = new Map<string, { folio: string; line: number }>();
  const push = <K, V>(m: Map<K, V[]>, k: K, v: V) => { const l = m.get(k); if (l) l.push(v); else m.set(k, [v]); };

  for (const n of neumes) {
    for (const u of n.noteUuids) if (!byNote.has(u)) byNote.set(u, n);
    push(bySysId, sysIdOf(n), n);
    push(byPattern, baseCode(n.pattern), n);
    if (!docStart.has(n.docId)) docStart.set(n.docId, { folio: n.folio, line: n.line });
    const key = lineKey(n.folio, n.line);
    let l = byLine.get(key);
    if (!l) { l = { folio: n.folio, line: n.line, uuid: '', neumes: [] }; byLine.set(key, l); }
    l.neumes.push(n);
    if (!l.uuid && n.lineUuid) l.uuid = n.lineUuid;
  }

  // a line two documents share is read as the manuscript has it: the one that starts earlier first
  const startOf = (docId: string) => docStart.get(docId) ?? { folio: '', line: 0 };
  const linesOfFolio = new Map<string, number[]>();
  const lineByUuid = new Map<string, TLine>();
  for (const l of byLine.values()) {
    l.neumes.sort((a, b) => {
      if (a.docId === b.docId) return a.order - b.order;
      const sa = startOf(a.docId), sb = startOf(b.docId);
      return compareFolios(sa.folio, sb.folio) || sa.line - sb.line || a.docId.localeCompare(b.docId);
    });
    push(linesOfFolio, l.folio, l.line);
    if (l.uuid) lineByUuid.set(l.uuid, l);
  }
  for (const list of linesOfFolio.values()) list.sort((a, b) => a - b);
  return { neumes, byNote, bySysId, byPattern, byLine, linesOfFolio, lineByUuid, documents: docStart.size };
}

export const emptyIndex = (): TranscriptionIndex => buildIndex([]);

// ── Snippets and lines ──────────────────────────────────────────────────────────────────────────

export type SnippetLinkKind = 'stored' | 'reference' | 'position' | 'lost' | 'none';
export type Confidence = 'high' | 'medium' | 'low';

export interface SnippetLink {
  kind: SnippetLinkKind;
  neume?: TNeume;
  /** How sure a worked-out link is ('reference' and 'position'). */
  confidence?: Confidence;
  /** The transcription writes the neume with another code than the snippet's. */
  patternDiffers?: boolean;
}

export type LineLinkKind = 'stored' | 'snippets' | 'name' | 'lost' | 'none';

export interface LineLink {
  kind: LineLinkKind;
  /** The transcription line, if one was found. */
  line?: TLine;
}

export interface LinkReport {
  snippets: Map<string, SnippetLink>;
  lines: Map<string, LineLink>;
}

type SourceLike = { quellensigle?: string; annotationRegions?: VM.AnnotationRegion[]; annotationItems?: VM.AnnotationItem[] };

/** A clef or custos is not a neume: only codes that start with a note are linked. */
const isNeumeCode = (pattern: string): boolean => /^[*[{]/.test(baseCode(pattern));

/** The parts of a Neume Viewer reference, or null if it is not one. */
export function parseSysId(sysId: string | undefined): { doc: string; folio: string; line: number; syllable: string; notes: string } | null {
  const p = String(sysId ?? '').split('|');
  if (p.length < 5) return null;
  // a syllable may hold a bar itself: the document, folio and line come first, the notes last
  const line = parseLine(p[2]);
  if (line === null) return null;
  return { doc: p[0], folio: p[1], line, syllable: p.slice(3, -1).join('|'), notes: p[p.length - 1] };
}

/** Left, right and middle of a polygon in percent. */
function xSpan(points: string | undefined): { min: number; max: number; centre: number } | null {
  let min = Infinity, max = -Infinity;
  for (const p of String(points ?? '').split(/\s+/)) {
    const x = Number(p.split(',')[0]);
    if (!p || !Number.isFinite(x)) continue;
    if (x < min) min = x;
    if (x > max) max = x;
  }
  return Number.isFinite(min) ? { min, max, centre: (min + max) / 2 } : null;
}

interface AlignItem { id: string; pattern: string; centre: number }

/**
 * Snippets (left to right) aligned with the neumes of a line (reading order) by pattern: most matches first,
 * and among as many, the one whose positions agree best (a single note repeats often; where the snippet stands
 * says which one it is). Port of the Neumen-Editor's `alignItems`.
 */
export function alignItems(items: AlignItem[], neumes: Pick<TNeume, 'pattern'>[], span: { min: number; max: number }):
  { pairs: { item: AlignItem; neume: number; dist: number }[]; matched: number; maxDist: number } {
  const n = items.length, m = neumes.length;
  const width = Math.max(span.max - span.min, 1e-6);
  const where = items.map(i => Math.min(1, Math.max(0, (i.centre - span.min) / width)));
  const score = (i: number, j: number): number => {
    if (baseCode(items[i].pattern) !== baseCode(neumes[j].pattern)) return -1;
    return 1 + 0.5 * (1 - Math.min(1, Math.abs(where[i] - (j + 0.5) / m)));
  };
  const dp = Array.from({ length: n + 1 }, () => new Float64Array(m + 1));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      let best = Math.max(dp[i - 1][j], dp[i][j - 1]);
      const s = score(i - 1, j - 1);
      if (s > 0) best = Math.max(best, dp[i - 1][j - 1] + s);
      dp[i][j] = best;
    }
  }
  const pairs: { item: AlignItem; neume: number; dist: number }[] = [];
  let i = n, j = m;
  while (i > 0 && j > 0) {
    const s = score(i - 1, j - 1);
    if (s > 0 && dp[i][j] === dp[i - 1][j - 1] + s) {
      pairs.push({ item: items[i - 1], neume: j - 1, dist: Math.min(1, Math.abs(where[i - 1] - (j - 0.5) / m)) });
      i--; j--;
    } else if (dp[i][j] === dp[i - 1][j]) i--;
    else j--;
  }
  pairs.reverse();
  return { pairs, matched: pairs.length, maxDist: pairs.reduce((d, p) => Math.max(d, p.dist), 0) };
}

function confidenceOf(count: number, neumeCount: number, matched: number, maxDist: number): Confidence | null {
  if (!count || !matched) return null;
  if (matched === count) return count === neumeCount || maxDist <= 0.12 ? 'high' : 'medium';
  return matched / count >= 0.6 ? 'low' : null;
}

/**
 * Every snippet's and line region's link to the transcription, the best that can be found (see the top of
 * this file). Nothing is changed: `applyLinks` stores what is wanted of it.
 */
export function resolveLinks(source: SourceLike, index: TranscriptionIndex): LinkReport {
  const sigle = source.quellensigle ?? '';
  const regions = source.annotationRegions ?? [];
  const items = source.annotationItems ?? [];
  const snippets = new Map<string, SnippetLink>();
  const lines = new Map<string, LineLink>();
  const claimed = new Set<TNeume>();
  const loaded = index.neumes.length > 0;
  const differs = (item: VM.AnnotationItem, n: TNeume) => baseCode(item.pattern) !== baseCode(n.pattern);

  // 1. stored links
  for (const item of items) {
    if (!item.uuid) continue;
    const n = index.byNote.get(item.uuid);
    if (n) { snippets.set(item.id, { kind: 'stored', neume: n, patternDiffers: differs(item, n) }); claimed.add(n); }
    else snippets.set(item.id, { kind: loaded ? 'lost' : 'none' });
  }

  // 2. Neume Viewer references
  for (const item of items) {
    if (snippets.has(item.id) || !item.sysId) continue;
    const ref = parseSysId(item.sysId);
    if (!ref) continue;
    const folio = cmFolio(ref.folio, sigle);
    const free = (list: TNeume[] | undefined) => (list ?? []).filter(n => !claimed.has(n));
    let found = free(index.bySysId.get([ref.doc, folio, String(ref.line), ref.syllable, ref.notes].join('|')));
    let confidence: Confidence = 'high';
    if (!found.length) {
      // the line counted otherwise: the same document, syllable and notes elsewhere, if only once
      const same = free(index.neumes.filter(n => n.docLabel === ref.doc && n.syllable === ref.syllable && n.notes === ref.notes));
      if (same.length === 1) { found = same; confidence = 'medium'; }
    }
    if (!found.length) {
      // the document named otherwise: the same notes on that line of that folio
      const there = free(index.byLine.get(lineKey(folio, ref.line))?.neumes.filter(n => n.notes === ref.notes));
      if (there.length === 1) { found = there; confidence = 'low'; }
    }
    if (!found.length) continue;
    // two identical neumes on one syllable: they are taken in turn
    const n = found[0];
    claimed.add(n);
    snippets.set(item.id, { kind: 'reference', neume: n, confidence, patternDiffers: differs(item, n) });
  }

  // 3. the snippets of each region, aligned with a line of its folio
  const byRegion = new Map<string, VM.AnnotationItem[]>();
  for (const item of items) {
    const list = byRegion.get(item.regionId);
    if (list) list.push(item); else byRegion.set(item.regionId, [item]);
  }
  const linesTaken = new Set<string>();
  const regionLine = new Map<string, string>();   // region id → line key its linked snippets agree on
  for (const r of regions) {
    const keys = new Set((byRegion.get(r.id) ?? []).map(i => snippets.get(i.id)?.neume).filter((n): n is TNeume => !!n).map(n => lineKey(n.folio, n.line)));
    if (keys.size === 1) { const k = [...keys][0]; regionLine.set(r.id, k); linesTaken.add(k); }
  }
  interface Fit { key: string; pairs: { item: AlignItem; neume: number }[]; confidence: Confidence; matched: number; maxDist: number; named: boolean; neumes: TNeume[] }
  const work: { region: VM.AnnotationRegion; best: Fit[] }[] = [];
  for (const r of regions) {
    const span = xSpan(r.points);
    const free = (byRegion.get(r.id) ?? [])
      .filter(i => !snippets.has(i.id) && isNeumeCode(i.pattern))
      .map(i => ({ id: i.id, pattern: i.pattern, centre: xSpan(i.points)?.centre ?? NaN }))
      .filter(i => Number.isFinite(i.centre))
      .sort((a, b) => a.centre - b.centre);
    if (!free.length || !span) continue;
    const folio = cmFolio(folioOf(r), sigle);
    const named = lineNumberOf(r);
    const keys = regionLine.has(r.id) ? [regionLine.get(r.id)!] : (index.linesOfFolio.get(folio) ?? []).map(l => lineKey(folio, l));
    const best: Fit[] = [];
    for (const key of keys) {
      const neumes = (index.byLine.get(key)?.neumes ?? []).filter(n => !claimed.has(n));
      if (!neumes.length) continue;
      const a = alignItems(free, neumes, span);
      const confidence = confidenceOf(free.length, neumes.length, a.matched, a.maxDist);
      if (confidence) best.push({ key, pairs: a.pairs, confidence, matched: a.matched, maxDist: a.maxDist, named: named !== null && key === lineKey(folio, named), neumes });
    }
    // most matches; then the line the region is named after; then the closest positions
    best.sort((x, y) => y.matched - x.matched || Number(y.named) - Number(x.named) || x.maxDist - y.maxDist);
    work.push({ region: r, best });
  }
  // the clearest regions first, so that each keeps its line
  work.sort((a, b) => (b.best[0]?.matched ?? 0) - (a.best[0]?.matched ?? 0));
  for (const w of work) {
    const fixed = regionLine.has(w.region.id);
    const pick = w.best.find(b => fixed || !linesTaken.has(b.key));
    if (!pick) continue;
    linesTaken.add(pick.key);
    regionLine.set(w.region.id, pick.key);
    for (const p of pick.pairs) {
      const n = pick.neumes[p.neume];
      if (claimed.has(n)) continue;
      claimed.add(n);
      snippets.set(p.item.id, { kind: 'position', neume: n, confidence: pick.confidence, patternDiffers: baseCode(p.item.pattern) !== baseCode(n.pattern) });
    }
  }
  for (const item of items) if (!snippets.has(item.id)) snippets.set(item.id, { kind: 'none' });

  // 4. lines
  for (const r of regions) {
    if (r.lineUUID) {
      const l = index.lineByUuid.get(r.lineUUID);
      lines.set(r.id, l ? { kind: 'stored', line: l } : { kind: loaded ? 'lost' : 'none' });
      continue;
    }
    const fromSnippets = regionLine.get(r.id);
    if (fromSnippets && index.byLine.has(fromSnippets)) { lines.set(r.id, { kind: 'snippets', line: index.byLine.get(fromSnippets) }); continue; }
    const named = lineNumberOf(r);
    const key = named === null ? '' : lineKey(cmFolio(folioOf(r), sigle), named);
    const l = key ? index.byLine.get(key) : undefined;
    lines.set(r.id, l ? { kind: 'name', line: l } : { kind: 'none' });
  }
  return { snippets, lines };
}

/** What `applyLinks` would store: snippets and regions that get a link. */
export function linksToStore(report: LinkReport, minimum: Confidence = 'medium'): { items: Map<string, string>; regions: Map<string, string> } {
  const rank: { [c in Confidence]: number } = { high: 3, medium: 2, low: 1 };
  const items = new Map<string, string>();
  for (const [id, link] of report.snippets) {
    if ((link.kind === 'reference' || link.kind === 'position') && link.neume?.uuid && rank[link.confidence ?? 'low'] >= rank[minimum]) items.set(id, link.neume.uuid);
  }
  const regions = new Map<string, string>();
  for (const [id, link] of report.lines) {
    if ((link.kind === 'snippets' || link.kind === 'name') && link.line?.uuid) regions.set(id, link.line.uuid);
  }
  return { items, regions };
}

/**
 * Stores the worked-out links (at least `minimum` sure) in the source: a snippet's `uuid`, a region's `lineUUID`.
 * A link that is stored already is never changed. Returns how many were stored.
 */
export function applyLinks(source: SourceLike, report: LinkReport, minimum: Confidence = 'medium'): { items: number; regions: number } {
  const want = linksToStore(report, minimum);
  let items = 0, regions = 0;
  for (const item of source.annotationItems ?? []) {
    const uuid = want.items.get(item.id);
    if (uuid && !item.uuid) { item.uuid = uuid; items++; }
  }
  for (const r of source.annotationRegions ?? []) {
    const uuid = want.regions.get(r.id);
    if (uuid && !r.lineUUID) { r.lineUUID = uuid; regions++; }
  }
  return { items, regions };
}
