/**
 * Which patterns a manuscript's notation documentation shows.
 *
 *  - The workspace has a **standard set** (Settings → Notation): patterns that every manuscript's
 *    documentation has, each with the Reference ID it usually gets. A manuscript can take its own ID for
 *    a pattern (its neume table, `Source.equivalents`).
 *  - A manuscript can **restrict** the standard set (`remove`) and **extend** it (`add`). What it
 *    has snippets of is shown too, unless it is removed.
 *
 * The standard set and the overrides are small lists of patterns; the order is not kept in them but
 * made from the patterns (see notation-order.ts), so a pattern added later finds its place.
 */

import { Source } from './api.service';
import { baseCode, compareForTable } from './notation-order';

/** One pattern of the standard set and the Reference ID it usually gets ('' if it has none). */
export interface StandardEntry { pattern: string; refId: string }

/** How the rows are ordered: by Reference ID (rows with the same ID, or none, in the order of the neume table), or only as the Neumen-Editor orders its neume table. */
export type NotationOrder = 'neume' | 'id';

/** What the workspace decides about the notation documentation. */
export interface NotationSetup {
  standard: StandardEntry[];
  order: NotationOrder;
}

/** What a manuscript changes in the standard set. */
export interface SourceSet { add: string[]; remove: string[] }

/** Key under which a source keeps its changes (JSON) in `Source.custom`. */
export const NOTATION_SET_KEY = 'notationSet';

/**
 * The patterns whose Reference IDs agree in the neume tables of the Corpus Monodicum's notation
 * documentation (seven manuscripts compared): plain shapes first, then liquescents, strophicus and
 * quilisma. A starting point for the workspace; every entry can be changed in Settings.
 */
export const DEFAULT_STANDARD: readonly StandardEntry[] = [
  { pattern: '*', refId: '10' },
  { pattern: '[*d]', refId: '20' },
  { pattern: '[*du]', refId: '21' },
  { pattern: '[*dud]', refId: '22' },
  { pattern: '*dd', refId: '30' },
  { pattern: '[*u]', refId: '40' },
  { pattern: '[*ud]', refId: '41' },
  { pattern: '[*udu]', refId: '42' },
  { pattern: '*uu', refId: '50' },
  { pattern: '*SeS', refId: '61' },
  { pattern: '[*Qu]', refId: '81' },
  { pattern: '[*dL]', refId: '10+/20-' },
  { pattern: '[*uL]', refId: '10+/40-' },
  { pattern: '[*ddL]', refId: '20+' },
];

export const defaultSetup = (): NotationSetup => ({ standard: DEFAULT_STANDARD.map(e => ({ ...e })), order: 'id' });

/**
 * The setup from the project settings: what is there, cleaned (no empty pattern, no pattern twice —
 * the first wins), else the default.
 */
export function readSetup(settings: { notationStandard?: unknown; notationOrder?: unknown } | null | undefined): NotationSetup {
  const out = defaultSetup();
  if (Array.isArray(settings?.notationStandard)) {
    const seen = new Set<string>();
    out.standard = [];
    for (const e of settings!.notationStandard as any[]) {
      const pattern = baseCode(e?.pattern);
      if (!pattern || seen.has(pattern)) continue;
      seen.add(pattern);
      out.standard.push({ pattern, refId: String(e?.refId ?? '').trim() });
    }
  }
  if (settings?.notationOrder === 'id' || settings?.notationOrder === 'neume') out.order = settings.notationOrder;
  return out;
}

/** What to write into the project settings. */
export const settingsOf = (setup: NotationSetup): { notationStandard: StandardEntry[]; notationOrder: NotationOrder } =>
  ({ notationStandard: setup.standard.map(e => ({ pattern: e.pattern, refId: e.refId })), notationOrder: setup.order });

/** The changes a source keeps; none if there are none or they cannot be read. */
export function readSourceSet(source: { custom?: { [key: string]: string } } | null | undefined): SourceSet {
  const raw = source?.custom?.[NOTATION_SET_KEY];
  const out: SourceSet = { add: [], remove: [] };
  if (!raw) return out;
  try {
    const data = JSON.parse(raw);
    const list = (v: unknown): string[] => (Array.isArray(v) ? [...new Set(v.map(baseCode).filter(Boolean))] : []);
    out.add = list(data?.add);
    out.remove = list(data?.remove).filter(p => !out.add.includes(p));
  } catch { /* an unreadable entry is no entry */ }
  return out;
}

/** Keeps the source's changes (and drops the entry when there are none). */
export function writeSourceSet(source: { custom?: { [key: string]: string } }, set: SourceSet): void {
  const c = (source.custom ??= {});
  if (set.add.length || set.remove.length) c[NOTATION_SET_KEY] = JSON.stringify({ add: set.add, remove: set.remove });
  else delete c[NOTATION_SET_KEY];
}

/** Where a pattern comes from: the standard set, the manuscript's snippets, its neume table, or a hand that added it. */
export type Origin = 'standard' | 'snippets' | 'table' | 'added';

export interface Candidate {
  pattern: string;
  /** The ID this manuscript gives it: its own table row, else the standard's, else ''. */
  refId: string;
  origins: Origin[];
  /** Whether the documentation shows it. */
  included: boolean;
  /** How many snippets of this pattern the manuscript has. */
  snippets: number;
}

type SourceLike = Pick<Source, 'equivalents' | 'annotationItems'> & { custom?: { [key: string]: string } };

/**
 * Every pattern the manuscript's documentation could show, in the order of the table, with whether it does.
 * A pattern is shown if it is in the standard set or was added, or the manuscript has snippets of it — unless the
 * manuscript removed it. Patterns that only have a row in its neume table are offered, not shown.
 */
export function candidatesFor(source: SourceLike | null | undefined, setup: NotationSetup): Candidate[] {
  const set = readSourceSet(source);
  const standardId = new Map(setup.standard.map((e): [string, string] => [e.pattern, e.refId]));
  const ownId = new Map<string, string>();
  for (const e of source?.equivalents ?? []) {
    const p = baseCode(e.pattern), id = (e.refId ?? '').trim();
    if (p && id && !ownId.has(p)) ownId.set(p, id);
  }
  const snippets = new Map<string, number>();
  for (const i of source?.annotationItems ?? []) {
    const p = baseCode(i.pattern);
    if (p) snippets.set(p, (snippets.get(p) ?? 0) + 1);
  }

  const all = new Set<string>([...standardId.keys(), ...ownId.keys(), ...snippets.keys(), ...set.add]);
  const out: Candidate[] = [];
  for (const pattern of all) {
    const origins: Origin[] = [];
    if (standardId.has(pattern)) origins.push('standard');
    if (set.add.includes(pattern)) origins.push('added');
    if (snippets.has(pattern)) origins.push('snippets');
    if (ownId.has(pattern)) origins.push('table');
    const wanted = origins.some(o => o !== 'table');
    out.push({
      pattern,
      refId: ownId.get(pattern) ?? standardId.get(pattern) ?? '',
      origins,
      included: wanted && !set.remove.includes(pattern),
      snippets: snippets.get(pattern) ?? 0,
    });
  }
  return out.sort((a, b) => compareForTable(a.pattern, b.pattern));
}

/** Changes `included` of one pattern into the source's add/remove lists (as little as is needed). */
export function setIncluded(source: { custom?: { [key: string]: string } } & SourceLike, setup: NotationSetup, pattern: string, included: boolean): void {
  const p = baseCode(pattern);
  const set = readSourceSet(source);
  set.add = set.add.filter(x => x !== p);
  set.remove = set.remove.filter(x => x !== p);
  const now = candidatesFor({ ...source, custom: { ...(source.custom ?? {}), [NOTATION_SET_KEY]: JSON.stringify(set) } }, setup).find(c => c.pattern === p);
  // what the pattern would be without any say of the manuscript's
  const byDefault = !!now && now.origins.some(o => o === 'standard' || o === 'snippets');
  if (included && !byDefault) set.add.push(p);
  if (!included && byDefault) set.remove.push(p);
  writeSourceSet(source, set);
}

/** The patterns the documentation shows, with their Reference IDs. */
export const includedRows = (source: SourceLike | null | undefined, setup: NotationSetup): { pattern: string; refId: string }[] =>
  candidatesFor(source, setup).filter(c => c.included).map(c => ({ pattern: c.pattern, refId: c.refId }));
