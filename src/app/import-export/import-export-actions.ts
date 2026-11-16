/**
 * The actions of the Import / Export page, grouped by what a person wants to do. The page shows them as rows in two
 * columns (import, export): title and format; what the action does and what the format keeps is the row's tooltip.
 *
 * `id` of an action that has a `ws` is the action of the Sources page that does the work (`?ws=<ws>`, see
 * `SourcesOverviewComponent.handleWorkspaceAction`); the Cantus Index and the repository import are dialogs of the page.
 */

export type IoTab = 'import' | 'export';

export interface IoAction {
  id: string;
  /** Action of the Sources page that does the work; absent for the dialogs of the page itself. */
  ws?: string;
  title: string;
  /** One short line: what the action does. */
  hint: string;
  /** File type or source, shown as a badge. */
  format: string;
  /** What the format keeps and what it leaves out, one short line. */
  keeps: string;
}

export interface IoSection {
  id: string;
  tab: IoTab;
  title: string;
  actions: IoAction[];
}

export const IO_SECTIONS: IoSection[] = [
  {
    id: 'existing', tab: 'import', title: 'Start from existing data',
    actions: [
      {
        id: 'repository', title: 'Public repository',
        hint: 'Corpus Monodicum or Cantus Corpus: filter first, then load only what you need',
        format: 'GitHub', keeps: 'Chants with notes (Cantus: also chants to transcribe)',
      },
      {
        id: 'import-workspace', ws: 'import-workspace', title: 'Workspace backup',
        hint: 'Restore everything from a backup file', format: '.monodijson', keeps: 'Everything',
      },
      {
        id: 'import-zip', ws: 'import-zip', title: 'ZIP archive',
        hint: 'Sources and chants from monodi or OMMR4all', format: 'ZIP', keeps: 'Sources, chants and notes',
      },
    ],
  },
  {
    id: 'chants', tab: 'import', title: 'Add chants',
    actions: [
      {
        id: 'import-mei', ws: 'import-mei', title: 'MEI files',
        hint: 'Neume or premensural notation, several files at once', format: 'MEI', keeps: 'Notation of each file',
      },
      {
        id: 'import-csv', ws: 'import-csv', title: 'Spreadsheet',
        hint: 'Each row becomes a chant', format: 'CSV', keeps: 'Metadata, melody and text',
      },
      {
        id: 'import-guido', ws: 'import-guido', title: 'GUIDO (Word)',
        hint: 'Chant in the GUIDO font, one document per source', format: 'DOCX', keeps: 'Melody and text',
      },
      {
        id: 'cantus', title: 'Cantus Index by ID',
        hint: 'Fetch the melodies of one Cantus ID', format: 'Volpiano', keeps: 'Melody; the full text goes into the metadata',
      },
    ],
  },
  {
    id: 'annotations', tab: 'import', title: 'Add manuscript annotations',
    actions: [
      {
        id: 'import-annotations', ws: 'import-annotations', title: 'Annotations',
        hint: 'From the Neumen-Editor or the Neume Viewer', format: 'JSON', keeps: 'Regions, snippets and table rows; nothing is deleted',
      },
    ],
  },
  {
    id: 'publish', tab: 'export', title: 'Publish and print',
    actions: [
      {
        id: 'export-pdf', ws: 'export-pdf', title: 'PDF edition',
        hint: 'Pick chants, then page options', format: 'PDF', keeps: 'Printed layout with apparatus',
      },
      {
        id: 'export-html', ws: 'export-html', title: 'Website',
        hint: 'A self-contained site to browse offline', format: 'HTML', keeps: 'Rendered notation, metadata and search',
      },
    ],
  },
  {
    id: 'backup', tab: 'export', title: 'Back up and share',
    actions: [
      {
        id: 'export-workspace', ws: 'export-workspace', title: 'Workspace backup',
        hint: 'Everything in one file: the safest copy', format: '.monodijson', keeps: 'Everything',
      },
      {
        id: 'export-zip', ws: 'export-zip', title: 'ZIP archive',
        hint: 'For monodi or OMMR4all', format: 'ZIP', keeps: 'Sources, chants and notes',
      },
      {
        id: 'export-csv', ws: 'export-csv', title: 'Spreadsheet',
        hint: 'One row per chant, for Excel or R', format: 'CSV', keeps: 'Metadata, melody and text; no apparatus or sections',
      },
    ],
  },
];

export function sectionsOf(tab: IoTab): IoSection[] {
  return IO_SECTIONS.filter((s) => s.tab === tab);
}

export function findAction(id: string): IoAction | undefined {
  for (const section of IO_SECTIONS) {
    const found = section.actions.find((a) => a.id === id);
    if (found) return found;
  }
  return undefined;
}
