/**
 * A manuscript's notation documentation as one page shows it: everything it holds, and how each
 * piece is tied to the transcription.
 *
 *   rows       the patterns the documentation shows (its table, see notation-set.ts), each with its
 *              snippets by variant and every neume of the transcription written with that code
 *   others     patterns the documentation does not show: in the table only, or in the transcription only
 *   lines      the line regions, each with its snippets and the transcription line it covers
 *   counts     the sizes and how much of it is linked, for the overview of the data model
 *
 * Pure functions on plain data (see notation-links.ts for how the links are found).
 */

import * as VM from './types/model';
import { Source } from './api.service';
import { boundsOf, Rect } from './iiif-crop';
import { buildNotationDoc, compareFolios, idLabel, idParts, placeOf, PlaceRef } from './notation-doc';
import { baseCode, compareForTable } from './notation-order';
import { candidatesFor, NotationSetup, Origin } from './notation-set';
import { LineLink, LineLinkKind, LinkReport, SnippetLink, SnippetLinkKind, TNeume, TranscriptionIndex } from './notation-links';

type SourceLike = Pick<Source, 'equivalents' | 'annotationRegions' | 'annotationItems' | 'custom'>;

/** A snippet with what the page says about it. */
export interface SnippetView {
  item: VM.AnnotationItem;
  region?: VM.AnnotationRegion;
  place: PlaceRef;
  pattern: string;
  variant: string;
  /** The Reference ID of its pattern in this manuscript ('' if none). */
  refId: string;
  /** What the print writes over its frame: the ID and the variant (`10+20-a`), or the pattern without an ID. */
  label: string;
  /** Whether the documentation shows its pattern. */
  shown: boolean;
  link: SnippetLink;
}

/** A neume of the transcription and the snippet that depicts it, if one does. */
export interface NeumeView { neume: TNeume; snippet?: SnippetView }

/** One pattern: its row of the table, its snippets, and where the transcription has it. */
export interface PatternView {
  pattern: string;
  refId: string;
  idParts: string[];
  notes: string;
  origins: Origin[];
  shown: boolean;
  /** Its snippets by variant letter ('' = none), variants in order, each with its places (`8 / 6`) in book order. */
  variants: { variant: string; snippets: SnippetView[]; places: { text: string; snippet: SnippetView }[] }[];
  snippets: SnippetView[];
  /** The neumes of the transcription with this code, in reading order. */
  occurrences: NeumeView[];
  /** In how many documents it occurs. */
  documents: number;
  /** How many of its occurrences a snippet depicts. */
  documented: number;
}

/** A line region: its snippets (left to right) and the transcription line it covers. */
export interface LineView {
  region: VM.AnnotationRegion;
  place: PlaceRef;
  rect: Rect | null;
  snippets: SnippetView[];
  link: LineLink;
  /** The transcription line, neume by neume. */
  neumes: NeumeView[];
}

export interface Counts {
  standard: number;
  /** Rows of the manuscript's own table (`Source.equivalents`), and how many have an ID. */
  table: number;
  tableWithId: number;
  /** Patterns the documentation shows. */
  shown: number;
  snippets: number;
  snippetLinks: { [k in SnippetLinkKind]: number };
  lines: number;
  lineLinks: { [k in LineLinkKind]: number };
  documents: number;
  neumes: number;
  patterns: number;
  transcriptionLines: number;
}

export interface Overview {
  rows: PatternView[];
  others: PatternView[];
  lines: LineView[];
  /** All snippets, line by line, left to right. */
  snippets: SnippetView[];
  snippetById: Map<string, SnippetView>;
  counts: Counts;
}

const NONE_LINK: SnippetLink = { kind: 'none' };

/** Each place once (the first snippet there stands for it); the snippets are in book order already. */
function placesOf(list: SnippetView[]): { text: string; snippet: SnippetView }[] {
  const out: { text: string; snippet: SnippetView }[] = [];
  for (const s of list) if (s.place.text && !out.some(p => p.text === s.place.text)) out.push({ text: s.place.text, snippet: s });
  return out;
}
const NO_LINE: LineLink = { kind: 'none' };

/** The label of a snippet: the ID as printed and the variant, or the pattern (and variant) if the pattern has no ID. */
export const snippetLabel = (refId: string, pattern: string, variant: string): string =>
  refId ? idLabel(refId) + variant : variant ? `${pattern} ${variant}` : pattern;

export function buildOverview(source: SourceLike, setup: NotationSetup, index: TranscriptionIndex, report: LinkReport): Overview {
  const doc = buildNotationDoc(source, setup);
  const candidates = candidatesFor(source, setup);
  const candidateOf = new Map(candidates.map(c => [c.pattern, c]));
  const notesOf = new Map<string, string>();
  for (const e of source.equivalents ?? []) {
    const p = baseCode(e.pattern);
    if (p && e.notes?.trim() && !notesOf.has(p)) notesOf.set(p, e.notes.trim());
  }
  const regions = new Map((source.annotationRegions ?? []).map((r): [string, VM.AnnotationRegion] => [r.id, r]));
  const shownPatterns = new Set(doc.rows.map(r => r.pattern));

  // ── snippets ──
  const snippets: SnippetView[] = (source.annotationItems ?? []).map(item => {
    const pattern = baseCode(item.pattern);
    const variant = (item.variant ?? '').trim();
    const region = regions.get(item.regionId);
    const refId = candidateOf.get(pattern)?.refId ?? '';
    return {
      item, region, place: region ? placeOf(region) : { folio: '', line: null, text: '' }, pattern, variant, refId,
      label: snippetLabel(refId, pattern, variant), shown: shownPatterns.has(pattern), link: report.snippets.get(item.id) ?? NONE_LINK,
    };
  });
  const x = (s: SnippetView) => boundsOf(s.item.points)?.x ?? 0;
  const comparePlaces = (a: PlaceRef, b: PlaceRef) => compareFolios(a.folio, b.folio) || (a.line ?? 0) - (b.line ?? 0);
  snippets.sort((a, b) => comparePlaces(a.place, b.place) || (a.region?.id ?? '').localeCompare(b.region?.id ?? '') || x(a) - x(b));
  const snippetById = new Map(snippets.map(s => [s.item.id, s]));
  const snippetOfNeume = new Map<TNeume, SnippetView>();
  for (const s of snippets) if (s.link.neume && !snippetOfNeume.has(s.link.neume)) snippetOfNeume.set(s.link.neume, s);
  const viewOf = (n: TNeume): NeumeView => ({ neume: n, snippet: snippetOfNeume.get(n) });

  // ── patterns ──
  const snippetsOf = new Map<string, SnippetView[]>();
  for (const s of snippets) {
    const list = snippetsOf.get(s.pattern);
    if (list) list.push(s); else snippetsOf.set(s.pattern, [s]);
  }
  const patternView = (pattern: string, refId: string, shown: boolean): PatternView => {
    const own = snippetsOf.get(pattern) ?? [];
    const variants = new Map<string, SnippetView[]>();
    for (const s of own) {
      const list = variants.get(s.variant);
      if (list) list.push(s); else variants.set(s.variant, [s]);
    }
    const occurrences = (index.byPattern.get(pattern) ?? []).map(viewOf);
    return {
      pattern, refId, idParts: idParts(refId), notes: notesOf.get(pattern) ?? '', origins: candidateOf.get(pattern)?.origins ?? [], shown,
      variants: [...variants].sort(([a], [b]) => a.localeCompare(b)).map(([variant, list]) => ({ variant, snippets: list, places: placesOf(list) })),
      snippets: own, occurrences, documents: new Set(occurrences.map(o => o.neume.docId)).size,
      documented: occurrences.filter(o => o.snippet).length,
    };
  };
  const rows = doc.rows.map(r => patternView(r.pattern, r.refId, true));
  const otherPatterns = new Set<string>([...candidates.filter(c => !c.included).map(c => c.pattern), ...index.byPattern.keys()]);
  for (const p of shownPatterns) otherPatterns.delete(p);
  const others = [...otherPatterns]
    .sort(compareForTable)
    .map(p => patternView(p, candidateOf.get(p)?.refId ?? '', false));

  // ── lines ──
  const snippetsOfRegion = new Map<string, SnippetView[]>();
  for (const s of snippets) {
    const list = snippetsOfRegion.get(s.item.regionId);
    if (list) list.push(s); else snippetsOfRegion.set(s.item.regionId, [s]);
  }
  const lines: LineView[] = (source.annotationRegions ?? []).map(region => {
    const link = report.lines.get(region.id) ?? NO_LINE;
    return {
      region, place: placeOf(region), rect: boundsOf(region.points), snippets: snippetsOfRegion.get(region.id) ?? [],
      link, neumes: (link.line?.neumes ?? []).map(viewOf),
    };
  });
  lines.sort((a, b) => comparePlaces(a.place, b.place) || (a.rect?.y ?? 0) - (b.rect?.y ?? 0));

  // ── counts ──
  const snippetLinks = { stored: 0, reference: 0, position: 0, lost: 0, none: 0 };
  for (const s of snippets) snippetLinks[s.link.kind]++;
  const lineLinks = { stored: 0, snippets: 0, name: 0, lost: 0, none: 0 };
  for (const l of lines) lineLinks[l.link.kind]++;
  const counts: Counts = {
    standard: setup.standard.length,
    table: (source.equivalents ?? []).length,
    tableWithId: (source.equivalents ?? []).filter(e => e.refId?.trim()).length,
    shown: rows.length,
    snippets: snippets.length, snippetLinks,
    lines: lines.length, lineLinks,
    documents: index.documents, neumes: index.neumes.length, patterns: index.byPattern.size, transcriptionLines: index.byLine.size,
  };
  return { rows, others, lines, snippets, snippetById, counts };
}
