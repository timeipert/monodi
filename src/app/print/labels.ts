/**
 * The fixed words of a print: the names of its parts, the contents, "p. 23". A language gives all of them at once
 * (German for the Corpus Monodicum volume), and the project can change any single one. Pure: no jsPDF, no Angular.
 */
export type PrintLanguage = 'en' | 'de';

export interface PrintLabels {
  edition: string;
  apparatus: string;
  /** The part of the source descriptions: one manuscript / several. */
  description: string;
  descriptions: string;
  notation: string;
  contents: string;
  /** "p." in "Source Description: p. 23". */
  page: string;
  /** The word between the frames in "2P siehe 1P". */
  see: string;
  equivalents: string;
  inventory: string;
  tree: string;
  noImage: string;
}

export type LabelKey = keyof PrintLabels;

export const PRINT_LANGUAGES: { language: PrintLanguage; label: string }[] = [
  { language: 'en', label: 'English' },
  { language: 'de', label: 'Deutsch' },
];

export const DEFAULT_LABELS: Record<PrintLanguage, PrintLabels> = {
  en: {
    edition: 'Edition', apparatus: 'Critical Apparatus', description: 'Source Description', descriptions: 'Source Descriptions',
    notation: 'Notation Documentation', contents: 'Contents', page: 'p.', see: 'siehe',
    equivalents: 'Transcription equivalents', inventory: 'Sign inventory', tree: 'Neume tree', noImage: 'No image',
  },
  de: {
    edition: 'Edition', apparatus: 'Kritischer Apparat', description: 'Die Quelle', descriptions: 'Die Quellen',
    notation: 'Die Notationen', contents: 'Inhaltsverzeichnis', page: 'S.', see: 'siehe',
    equivalents: 'Transkriptionsäquivalente', inventory: 'Zeichenbestand', tree: 'Neumenbaum', noImage: 'Kein Bild',
  },
};

export const LABEL_KEYS = Object.keys(DEFAULT_LABELS.en) as LabelKey[];

/** What each label is for, in the settings. */
export const LABEL_HINTS: Record<LabelKey, string> = {
  edition: 'Part: the editions', apparatus: 'Part: the critical apparatus', description: 'Part: the description of one manuscript',
  descriptions: 'Part: the descriptions of several manuscripts', notation: 'Part: the notation documentation', contents: 'Title of the contents',
  page: 'Abbreviation before a page number', see: 'Between the frames of "2P siehe 1P"', equivalents: 'Notation documentation: the table',
  inventory: 'Notation documentation: the lines with the signs', tree: 'Notation documentation: the neume tree', noImage: 'Notation documentation: where a picture is missing',
};

/** The labels of the settings: the language (English unless it is a known one), then the project's own words on top. */
export function printLabels(settings: { pdfLanguage?: string; pdfLabels?: Partial<Record<LabelKey, string>> } | null | undefined): PrintLabels {
  const language: PrintLanguage = settings?.pdfLanguage === 'de' ? 'de' : 'en';
  const out: PrintLabels = { ...DEFAULT_LABELS[language] };
  const own = settings?.pdfLabels ?? {};
  for (const k of LABEL_KEYS) {
    const v = typeof own[k] === 'string' ? own[k]!.trim() : '';
    if (v) out[k] = v;
  }
  return out;
}
