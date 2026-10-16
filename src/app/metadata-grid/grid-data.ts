import { Document, ProjectSettings, Source } from '../api.service';
import { GridColumn, GridRowInput, GridView } from './grid-view';

export type GridKind = 'documents' | 'sources';

const DOCUMENT_COLUMNS: { key: keyof Document; label: string; width: number }[] = [
  { key: 'dokumenten_id',            label: 'Document ID',        width: 220 },
  { key: 'textinitium',              label: 'Text Initium',       width: 260 },
  { key: 'gattung1',                 label: 'Genre 1',            width: 140 },
  { key: 'gattung2',                 label: 'Genre 2',            width: 140 },
  { key: 'festtag',                  label: 'Feast Day',          width: 130 },
  { key: 'feier',                    label: 'Celebration',        width: 130 },
  { key: 'foliostart',               label: 'Folio Start',        width: 100 },
  { key: 'zeilenstart',              label: 'Line Start',         width: 100 },
  { key: 'druckausgabe',             label: 'Print Edition',      width: 140 },
  { key: 'bibliographischerverweis', label: 'Bibliographic Ref.', width: 170 },
  { key: 'editionsstatus',           label: 'Edition Status',     width: 130 },
  { key: 'kommentar',                label: 'Comment',            width: 260 },
];

const SOURCE_COLUMNS: { key: keyof Source; label: string; width: number }[] = [
  { key: 'quellensigle',        label: 'Source Siglum',      width: 170 },
  { key: 'datierung',           label: 'Dating',             width: 150 },
  { key: 'herkunftsregion',     label: 'Region of Origin',   width: 160 },
  { key: 'herkunftsort',        label: 'Place of Origin',    width: 160 },
  { key: 'herkunftsinstitution', label: 'Institution',       width: 170 },
  { key: 'ordenstradition',     label: 'Order Tradition',    width: 150 },
  { key: 'quellentyp',          label: 'Source Type',        width: 140 },
  { key: 'bibliotheksort',      label: 'Library Location',   width: 160 },
  { key: 'bibliothek',          label: 'Library',            width: 170 },
  { key: 'bibliothekssignatur', label: 'Library Signature',  width: 170 },
  { key: 'kommentar',           label: 'Comment',            width: 260 },
];

const CUSTOM_PREFIX = 'custom.';

function customColumns(fields: { key: string; label: string }[] | undefined): GridColumn[] {
  return (fields ?? []).map((f) => ({ key: CUSTOM_PREFIX + f.key, label: f.label || f.key, width: 160 }));
}

/** A document per row, with the siglum of its source as a column of its own ("Source"). */
export function buildDocumentsView(documents: Document[], sources: Source[], settings: ProjectSettings | null | undefined): GridView {
  const sigla = new Map(sources.map((s) => [s.id ?? '', s.quellensigle || '']));
  const custom = settings?.customDocumentFields ?? [];
  const columns: GridColumn[] = [
    ...DOCUMENT_COLUMNS.slice(0, 1).map(({ key, label, width }) => ({ key, label, width, required: true })),
    { key: 'quelle', label: 'Source', width: 150, editable: false },
    ...DOCUMENT_COLUMNS.slice(1).map(({ key, label, width }) => ({ key, label, width })),
    ...customColumns(custom),
  ];
  const rows: GridRowInput[] = [];
  for (const d of documents) {
    if (!d.id) continue;   // without an id a row cannot be addressed (deleted, edited)
    const siglum = sigla.get(d.quelle_id ?? '') ?? '';
    rows.push({
      id: d.id,
      group: siglum || '(no source)',
      cells: columns.map((c) => {
        if (c.key === 'quelle') return siglum;
        if (c.key.startsWith(CUSTOM_PREFIX)) return d.custom?.[c.key.slice(CUSTOM_PREFIX.length)] ?? '';
        return String((d as unknown as Record<string, unknown>)[c.key] ?? '');
      }),
    });
  }
  return new GridView(columns, rows, 'dokumenten_id');
}

/** A source per row, with the number of its documents as a read-only column. */
export function buildSourcesView(sources: Source[], documents: Document[], settings: ProjectSettings | null | undefined): GridView {
  const counts = new Map<string, number>();
  for (const d of documents) counts.set(d.quelle_id ?? '', (counts.get(d.quelle_id ?? '') ?? 0) + 1);
  const columns: GridColumn[] = [
    ...SOURCE_COLUMNS.map(({ key, label, width }) => ({ key, label, width, required: key === 'quellensigle' })),
    { key: 'docCount', label: 'Documents', width: 110, editable: false },
    ...customColumns(settings?.customSourceFields),
  ];
  const rows: GridRowInput[] = [];
  for (const s of sources) {
    if (!s.id) continue;
    rows.push({
      id: s.id,
      group: '',
      cells: columns.map((c) => {
        if (c.key === 'docCount') return String(counts.get(s.id!) ?? 0);
        if (c.key.startsWith(CUSTOM_PREFIX)) return s.custom?.[c.key.slice(CUSTOM_PREFIX.length)] ?? '';
        return String((s as unknown as Record<string, unknown>)[c.key] ?? '');
      }),
    });
  }
  return new GridView(columns, rows, 'quellensigle');
}

/** How many documents the given sources own: deleting a source takes its documents with it. */
export function documentCountOfSources(sourceIds: string[], documents: Document[]): number {
  const set = new Set(sourceIds);
  let n = 0;
  for (const d of documents) if (set.has(d.quelle_id)) n++;
  return n;
}
