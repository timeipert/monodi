import { Document, ProjectSettings } from './api.service';

/** Metadata of a document as shown in print: field labels, values and the inline summary. */

export function metadataFieldLabel(key: string, settings: ProjectSettings | null | undefined): string {
  if (key === 'dokumenten_id') return 'ID';
  if (key === 'textinitium') return 'Initium';
  if (key === 'gattung1') return 'Genre 1';
  if (key === 'gattung2') return 'Genre 2';
  if (key === 'festtag') return 'Feast Day';
  if (key === 'feier') return 'Feast';
  const custom = settings?.customDocumentFields?.find((f) => f.key === key);
  return custom ? custom.label : key;
}

export function metadataFieldValue(document: Document | null | undefined, key: string): string {
  if (!document) return '';
  if (key === 'dokumenten_id') return document.dokumenten_id || '';
  if (key === 'textinitium') return document.textinitium || '';
  if (key === 'gattung1') return document.gattung1 || '';
  if (key === 'gattung2') return document.gattung2 || '';
  if (key === 'festtag') return document.festtag || '';
  if (key === 'feier') return document.feier || '';
  return document.custom?.[key] || '';
}

export function headlineText(document: Document | null | undefined, fields: string[], settings: ProjectSettings | null | undefined): string {
  if (!fields || fields.length === 0) return '';
  const parts: string[] = [];
  for (const f of fields) {
    const val = metadataFieldValue(document, f);
    if (!val) continue;
    parts.push(f === 'dokumenten_id' ? val : `${metadataFieldLabel(f, settings)}: ${val}`);
  }
  return parts.join('   •   ');
}

/** The metadata rows of a document (key/value), in print order; empty fields are left out. */
export function inlineMetadataItems(document: Document | null | undefined, settings: ProjectSettings | null | undefined): { label: string; val: string }[] {
  const items: { label: string; val: string }[] = [];
  if (!document) return items;
  if (document.dokumenten_id) items.push({ label: 'ID', val: document.dokumenten_id });
  if (document.textinitium) items.push({ label: 'Initium', val: document.textinitium });
  const genres = [document.gattung1, document.gattung2].filter((x) => x).join(' / ');
  if (genres) items.push({ label: 'Genre', val: genres });
  const feast = [document.festtag, document.feier ? `(${document.feier})` : ''].filter((x) => x).join(' ');
  if (feast) items.push({ label: 'Feast', val: feast });
  if (document.foliostart || document.zeilenstart) {
    items.push({ label: 'Folio/Line', val: `F: ${document.foliostart || ''}, L: ${document.zeilenstart || ''}` });
  }
  if (document.druckausgabe) items.push({ label: 'Edition', val: document.druckausgabe });
  if (document.bibliographischerverweis) items.push({ label: 'Ref', val: document.bibliographischerverweis });
  if (document.kommentar) items.push({ label: 'Comment', val: document.kommentar });
  for (const cf of settings?.customDocumentFields || []) {
    const val = document.custom?.[cf.key];
    if (val) items.push({ label: cf.label, val });
  }
  return items;
}

/** Genre as one string ("Tropus / Introitus-Tropus"). */
export function genreOf(document: Document | null | undefined): string {
  return [document?.gattung1, document?.gattung2].filter((x) => x).join(' / ');
}
