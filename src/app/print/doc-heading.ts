import { Document, ProjectSettings } from '../api.service';
import { metadataFieldLabel, metadataFieldValue } from '../document-metadata';

/**
 * The heading where a document begins in the PDF: an editable list of metadata fields,
 * each with its own label, style and the option to appear only where documents differ.
 * Pure: no jsPDF, no Angular.
 */
export type HeadingStyle = 'bold' | 'normal' | 'grey';

export interface HeadingField {
  /** A document field ('dokumenten_id', 'bibliographischerverweis', 'genre' = both genres, ...) or the key of a custom field. */
  key: string;
  /** Printed before the value instead of the standard label ("Ref."). Only with `showLabel`. */
  label?: string;
  showLabel?: boolean;
  style?: HeadingStyle;
  /** Printed only if the value is not the same in every document of the PDF (genre: not when the whole PDF has one genre). */
  onlyIfVaries?: boolean;
}

/** Document ID, reference and genre; the genre only where the PDF holds more than one. */
export const DEFAULT_HEADING_FIELDS: HeadingField[] = [
  { key: 'dokumenten_id', style: 'bold' },
  { key: 'bibliographischerverweis', style: 'normal' },
  { key: 'genre', style: 'grey', onlyIfVaries: true },
];

export const DEFAULT_HEADING_SEPARATOR = '   ';

/** Standard fields offered in the settings (custom document fields come on top). */
export const HEADING_FIELD_KEYS = [
  'dokumenten_id', 'textinitium', 'genre', 'gattung1', 'gattung2', 'festtag', 'feier',
  'bibliographischerverweis', 'druckausgabe', 'foliostart', 'zeilenstart', 'kommentar',
];

/** Settings come from user-editable storage: drops malformed entries; missing = the default, [] = no heading. */
export function sanitizeHeadingFields(raw: unknown): HeadingField[] {
  if (!Array.isArray(raw)) return DEFAULT_HEADING_FIELDS.map((f) => ({ ...f }));
  const out: HeadingField[] = [];
  for (const r of raw as any[]) {
    if (!r || typeof r.key !== 'string' || !r.key) continue;
    out.push({
      key: r.key,
      label: typeof r.label === 'string' && r.label.trim() ? r.label : undefined,
      showLabel: r.showLabel === true,
      style: r.style === 'bold' || r.style === 'grey' ? r.style : 'normal',
      onlyIfVaries: r.onlyIfVaries === true,
    });
  }
  return out;
}

export interface HeadingPart { key: string; label: string; text: string; style: HeadingStyle; }

/** The parts of one document's heading, in order; empty values and constant "only if varies" fields are left out. */
export function headingParts(
  document: Document | null | undefined, fields: HeadingField[], settings: ProjectSettings | null | undefined, allDocuments: (Document | null | undefined)[],
): HeadingPart[] {
  const out: HeadingPart[] = [];
  for (const f of fields) {
    const text = metadataFieldValue(document, f.key).trim();
    if (!text) continue;
    if (f.onlyIfVaries && new Set(allDocuments.map((d) => metadataFieldValue(d, f.key).trim())).size <= 1) continue;
    out.push({
      key: f.key,
      label: f.showLabel ? (f.label || metadataFieldLabel(f.key, settings)) : '',
      text,
      style: f.style || 'normal',
    });
  }
  return out;
}
