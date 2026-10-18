import type { Document } from '../api.service';

/** Custom document fields the Corpus Monodicum import fills. A set flag is any text: the export marks it with an "x". */
export const DONT_PUBLISH_KEY = 'dontpublish';
export const DONT_PUBLISH_METADATA_KEY = 'dontpublish_metadata';

export const RELEASE_FIELDS: { key: string; label: string }[] = [
  { key: DONT_PUBLISH_KEY, label: "Don't publish" },
  { key: DONT_PUBLISH_METADATA_KEY, label: "Don't publish metadata" },
];

export type HoldReason = 'dontpublish' | 'not-edited';

export const HOLD_REASON_LABEL: Record<HoldReason, string> = {
  dontpublish: "marked \"don't publish\"",
  'not-edited': 'not edited yet (status "none")',
};

/** A flag counts as set when it holds any text. A stray comment in the cell holds the document back too: better too careful than too open. */
export function isFlagSet(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim() !== '';
}

/**
 * Why a document must not be printed; empty when it may be. An empty edition status is "unknown" and does not hold
 * back: a workspace that never had the Corpus Monodicum export keeps printing as before.
 */
export function holdReasons(doc: Pick<Document, 'editionsstatus' | 'custom'> | null | undefined): HoldReason[] {
  if (!doc) return [];
  const reasons: HoldReason[] = [];
  if (isFlagSet(doc.custom?.[DONT_PUBLISH_KEY])) reasons.push('dontpublish');
  if ((doc.editionsstatus ?? '').trim().toLowerCase() === 'none') reasons.push('not-edited');
  return reasons;
}

export function isPrintable(doc: Pick<Document, 'editionsstatus' | 'custom'> | null | undefined): boolean {
  return holdReasons(doc).length === 0;
}

/** Adds the two release fields to the custom document fields, so the metadata grid shows them. Null when they are there already. */
export function withReleaseFields<S extends { customDocumentFields?: { key: string; label: string }[] }>(settings: S): S | null {
  const have = new Set((settings.customDocumentFields ?? []).map((f) => f.key));
  const missing = RELEASE_FIELDS.filter((f) => !have.has(f.key));
  if (!missing.length) return null;
  return { ...settings, customDocumentFields: [...(settings.customDocumentFields ?? []), ...missing] };
}
