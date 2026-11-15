/**
 * Fingerprints: short content digests that tell whether the documents an analysis was computed from have changed.
 *
 * The digest of a document is taken from what the methods read, not from the raw document tree, so editing a comment
 * or an image zone changes nothing, and a typo in the text invalidates only methods that read the text:
 *  - `melody`: the pitches, the syllable boundaries and the neume boundaries;
 *  - `text`: the syllable texts;
 *  - `meta`: the metadata that groups and labels documents.
 *
 * The hash is a synchronous 53-bit string hash (cyrb53), no `crypto.subtle`: it must work in a worker, in Node and
 * under `file://` in the desktop app. It detects change; it is not a security measure.
 */
import type { ChantFeatures, DocInfo } from './corpus';

/** JSON with sorted object keys, so that two equal values always give the same text. `undefined` members are dropped. */
export function stableStringify(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return '[' + value.map((v) => stableStringify(v)).join(',') + ']';
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(obj[k])).join(',') + '}';
}

/** cyrb53: a fast, well mixed 53-bit hash of a string, as base-36 text (11 characters at most). */
export function hashString(text: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** The three digests of one document. */
export interface DocDigests {
  melody: string;
  text: string;
  meta: string;
}

/** Which of the digests a method reads. */
export type Uses = 'melody' | 'text' | 'meta';

export function digestMelody(f: ChantFeatures): string {
  return hashString(f.pitches.join(',') + '|' + f.sylStart.join(',') + '|' + f.neumeStart.join(','));
}

export function digestText(f: ChantFeatures): string {
  return hashString(f.sylText.join('\u0001'));
}

export function digestMeta(info: DocInfo): string {
  return hashString(stableStringify({ s: info.sourceId, g: info.sigle, l: info.label, f: info.fields }));
}

export function digestsOf(f: ChantFeatures, info: DocInfo): DocDigests {
  return { melody: digestMelody(f), text: digestText(f), meta: digestMeta(info) };
}

/** The digests of the document, restricted to the parts a method uses, as one short string. */
export function usedDigest(d: DocDigests, uses: readonly Uses[]): string {
  return [...uses].sort().map((u) => d[u]).join('.');
}

/** The used digest of every document: what a stored result keeps to tell later whether its documents changed. */
export function usedDigests(digests: Record<string, DocDigests>, uses: readonly Uses[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const id of Object.keys(digests)) out[id] = usedDigest(digests[id], uses);
  return out;
}

/**
 * The fingerprint of a method run: its identity (id, version, parameters), the documents and what they contain as far
 * as the method reads it, and `extra` for anything else the result depends on (for example the note flag settings).
 * Two runs with the same fingerprint give the same result.
 */
export function methodFingerprint(args: {
  methodId: string;
  version: number;
  params: unknown;
  uses: readonly Uses[];
  digests: Record<string, DocDigests>;
  extra?: string;
}): string {
  const ids = Object.keys(args.digests).sort();
  let body = `${args.methodId}@${args.version}|${stableStringify(args.params)}|${args.extra ?? ''}|${ids.length}`;
  for (const id of ids) body += `|${id}:${usedDigest(args.digests[id], args.uses)}`;
  return hashString(body) + hashString(body, 7);
}

/** The result of comparing the digests stored with a result against the documents as they are now. */
export interface DigestDiff {
  /** Documents present in both whose used digests differ. */
  changed: string[];
  /** Documents the result was computed from that no longer exist. */
  removed: string[];
  /** Documents of the current corpus that the result does not contain. */
  added: string[];
  /** True when nothing differs. */
  same: boolean;
}

/**
 * Compare what a result stored (`usedDigests` at the time it was computed) with the documents as they are now.
 * `current` lacks an entry (or has `undefined`) for a document that no longer exists.
 */
export function diffDigests(
  stored: Record<string, string>,
  current: Record<string, DocDigests | undefined>,
  uses: readonly Uses[],
): DigestDiff {
  const changed: string[] = [];
  const removed: string[] = [];
  for (const id of Object.keys(stored)) {
    const now = current[id];
    if (!now) removed.push(id);
    else if (usedDigest(now, uses) !== stored[id]) changed.push(id);
  }
  const added = Object.keys(current).filter((id) => current[id] && !(id in stored));
  return { changed, removed, added, same: changed.length === 0 && removed.length === 0 && added.length === 0 };
}
