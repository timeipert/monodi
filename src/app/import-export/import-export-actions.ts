/**
 * The actions of the Import / Export page, grouped by what a person wants to do. The page shows them as cards in sections
 * under two tabs; this file holds the order, the wording and the facts that a card shows (format, what the format keeps).
 *
 * `id` of an action that has a `ws` is the action of the Sources page that does the work (`?ws=<ws>`, see
 * `SourcesOverviewComponent.handleWorkspaceAction`); the Cantus Index and the repository import are dialogs of the page.
 */

export type IoTab = 'import' | 'export';

export interface IoAction {
  id: string;
  /** Action of the Sources page that does the work; absent for the dialogs of the page itself. */
  ws?: string;
  icon: string;
  color: string;
  title: string;
  /** One short line: what the action does. */
  hint: string;
  /** File type or source, shown as a badge. */
  format: string;
  /** What the format keeps and what it leaves out, one short line. */
  keeps: string;
  /** The format holds the whole workspace (a backup), shown with a mark. */
  complete?: boolean;
  /** Needs the internet. */
  online?: boolean;
  /** The one a person should usually pick in its section. */
  recommended?: boolean;
}

export interface IoSection {
  id: string;
  tab: IoTab;
  title: string;
  description: string;
  actions: IoAction[];
}

export const IO_SECTIONS: IoSection[] = [
  {
    id: 'existing', tab: 'import', title: 'Start from existing data',
    description: 'Load a whole corpus or a saved workspace.',
    actions: [
      {
        id: 'repository', icon: 'bi-github', color: 'text-primary', title: 'Public repository',
        hint: 'Corpus Monodicum or Cantus Corpus: filter first, then load only what you need',
        format: 'GitHub', keeps: 'Chants with notes (Cantus: also chants to transcribe)', online: true,
      },
      {
        id: 'import-workspace', ws: 'import-workspace', icon: 'bi-archive', color: 'text-secondary', title: 'Workspace backup',
        hint: 'Restore everything from a backup file', format: '.monodijson', keeps: 'Everything', complete: true,
      },
      {
        id: 'import-zip', ws: 'import-zip', icon: 'bi-file-earmark-zip', color: 'text-secondary', title: 'ZIP archive',
        hint: 'Sources and chants from monodi+ or OMMR4all', format: 'ZIP', keeps: 'Sources, chants and notes',
      },
    ],
  },
  {
    id: 'chants', tab: 'import', title: 'Add chants',
    description: 'Bring single chants or lists of chants into the workspace.',
    actions: [
      {
        id: 'import-mei', ws: 'import-mei', icon: 'bi-filetype-xml', color: 'text-secondary', title: 'MEI files',
        hint: 'Neume or premensural notation, several files at once', format: 'MEI', keeps: 'Notation of each file',
      },
      {
        id: 'import-csv', ws: 'import-csv', icon: 'bi-filetype-csv', color: 'text-secondary', title: 'Spreadsheet',
        hint: 'Each row becomes a chant', format: 'CSV', keeps: 'Metadata, melody and text',
      },
      {
        id: 'import-guido', ws: 'import-guido', icon: 'bi-file-earmark-word', color: 'text-secondary', title: 'GUIDO (Word)',
        hint: 'Chant in the GUIDO font, one document per source', format: 'DOCX', keeps: 'Melody and text',
      },
      {
        id: 'cantus', icon: 'bi-cloud-arrow-down', color: 'text-primary', title: 'Cantus Index by ID',
        hint: 'Fetch the melodies of one Cantus ID', format: 'Volpiano', keeps: 'Melody; the full text goes into the metadata', online: true,
      },
    ],
  },
  {
    id: 'annotations', tab: 'import', title: 'Add manuscript annotations',
    description: 'Line regions and neume tables made in another tool.',
    actions: [
      {
        id: 'import-annotations', ws: 'import-annotations', icon: 'bi-images', color: 'text-secondary', title: 'Annotations',
        hint: 'From the Neumen-Editor or the Neume Viewer', format: 'JSON', keeps: 'Regions, snippets and table rows; nothing is deleted',
      },
    ],
  },
  {
    id: 'publish', tab: 'export', title: 'Publish and print',
    description: 'Finished layouts for readers.',
    actions: [
      {
        id: 'export-pdf', ws: 'export-pdf', icon: 'bi-file-pdf', color: 'text-danger', title: 'PDF edition',
        hint: 'Pick chants, then page options', format: 'PDF', keeps: 'Printed layout with apparatus',
      },
      {
        id: 'export-html', ws: 'export-html', icon: 'bi-globe', color: 'text-warning', title: 'Website',
        hint: 'A self-contained site to browse offline', format: 'HTML', keeps: 'Rendered notation, metadata and search',
      },
    ],
  },
  {
    id: 'backup', tab: 'export', title: 'Back up and share',
    description: 'A safe copy of your work, or data for colleagues and other tools.',
    actions: [
      {
        id: 'export-workspace', ws: 'export-workspace', icon: 'bi-archive', color: 'text-success', title: 'Workspace backup',
        hint: 'Everything in one file: the safest copy', format: '.monodijson', keeps: 'Everything', complete: true, recommended: true,
      },
      {
        id: 'export-zip', ws: 'export-zip', icon: 'bi-file-earmark-zip', color: 'text-info', title: 'ZIP archive',
        hint: 'For monodi+ or OMMR4all', format: 'ZIP', keeps: 'Sources, chants and notes',
      },
      {
        id: 'export-csv', ws: 'export-csv', icon: 'bi-filetype-csv', color: 'text-success', title: 'Spreadsheet',
        hint: 'One row per chant, for Excel or R', format: 'CSV', keeps: 'Metadata, melody and text; no apparatus or sections',
      },
    ],
  },
];

/** "Which one do I need?": a goal, the way to reach it, and the action that starts it. */
export interface IoGoal {
  goal: string;
  answer: string;
  actionId: string;
}

export const IO_GOALS: IoGoal[] = [
  { goal: 'Keep a safe copy of my work', answer: 'Export a workspace backup', actionId: 'export-workspace' },
  { goal: 'Continue on another computer', answer: 'Export a backup here, import it there', actionId: 'import-workspace' },
  { goal: 'Exchange with monodi+ or OMMR4all', answer: 'ZIP archive', actionId: 'export-zip' },
  { goal: 'Edit metadata in a spreadsheet', answer: 'Export a spreadsheet, import it again', actionId: 'export-csv' },
  { goal: 'Print or publish chants', answer: 'PDF edition or website', actionId: 'export-pdf' },
  { goal: 'Work with a published corpus', answer: 'Public repository', actionId: 'repository' },
  { goal: 'Look up a melody', answer: 'Cantus Index by ID', actionId: 'cantus' },
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

export function tabOfAction(id: string): IoTab | undefined {
  return IO_SECTIONS.find((s) => s.actions.some((a) => a.id === id))?.tab;
}

/** How long ago a time was, in words: "today", "yesterday", "3 days ago", "5 weeks ago". */
export function describeAgo(then: number, now: number): string {
  const days = Math.floor((now - then) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.floor(days / 7)} weeks ago`;
  return `${Math.floor(days / 30)} months ago`;
}
