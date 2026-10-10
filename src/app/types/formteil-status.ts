/**
 * The "Status" field of a section (Formteil). The editor offers English names; the Corpus
 * Monodicum data (and the old text parsers) carry the German ones — `canonicalStatus` maps
 * both onto the English name so that the dropdown, the print settings and the exports agree.
 */
export const STATUS_ENTRY_MARK = 'Entry Mark';
export const STATUS_TROPE_ELEMENT = 'Trope Element';
export const STATUS_REFRAIN = 'Refrain';
export const STATUS_PRIMARY_SEGMENT = 'Primary Chant Segment';

/** The statuses the editor offers, in the order of the dropdown. */
export const FORMTEIL_STATUSES: readonly string[] = [
  STATUS_TROPE_ELEMENT,
  STATUS_ENTRY_MARK,
  STATUS_REFRAIN,
  STATUS_PRIMARY_SEGMENT,
];

/** Spellings found in the data, by their lower-case, space-free form. */
const ALIASES: { [key: string]: string } = {
  einsatzmarke: STATUS_ENTRY_MARK,
  entrymark: STATUS_ENTRY_MARK,
  tropenelement: STATUS_TROPE_ELEMENT,
  tropeelement: STATUS_TROPE_ELEMENT,
  refrain: STATUS_REFRAIN,
  'primärgesangssegment': STATUS_PRIMARY_SEGMENT,
  primaergesangssegment: STATUS_PRIMARY_SEGMENT,
  primarygesangssegment: STATUS_PRIMARY_SEGMENT,
  primarychantsegment: STATUS_PRIMARY_SEGMENT,
};

/** The English name of a status; an unknown value is returned as typed (trimmed). */
export function canonicalStatus(raw: string | undefined | null): string {
  const text = (raw ?? '').trim();
  if (!text) return '';
  return ALIASES[text.toLowerCase().replace(/[\s_-]+/g, '')] ?? text;
}
