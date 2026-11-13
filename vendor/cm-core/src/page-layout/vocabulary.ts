/**
 * The controlled vocabulary of the page layout ("Seiteneinrichtung") of a chant manuscript, as the notation
 * documentation of the Corpus Monodicum (CM) describes it. Each list holds the values a field may take, with the
 * English and German wording. The German wording is the one of the CM source descriptions (section
 * "Schriftraum – Notation – Textschrift" and "Ausstattung", `olyro/data` content/quellenbeschreibungen, 121 files,
 * read on 2026-11-12) and of the notes on use of the printed volume (CM-hub `config/print/de/notes-on-use.md`,
 * paragraph "Einteilung des Schriftraums").
 *
 * Design and reasons: `apps/neume-docs/docs/page-layout.md` in this repository.
 */

/** One value of a list: its stored key and its wording in English and German. */
export interface Term {
    readonly key: string;
    readonly en: string;
    readonly de: string;
}

const terms = <T extends readonly Term[]>(list: T): T => list;

/** How the size of the written area was found. */
export const AREA_SOURCE = terms([
    { key: 'measured', en: 'measured on the manuscript', de: 'am Original gemessen' },
    { key: 'reproduction', en: 'measured on a digital reproduction', de: 'Abmessung nach digitaler Reproduktion' },
    { key: 'calculated', en: 'calculated value', de: 'errechneter Wert' },
    { key: 'literature', en: 'taken from the literature', de: 'nach Literatur' }
] as const);

/** What a side column next to the text column holds (Versalienspalte, Randspalte). */
export const SIDE_COLUMN = terms([
    { key: 'none', en: 'no side column', de: 'keine Randspalte' },
    { key: 'initials', en: 'column for initials', de: 'Versalienspalte' },
    { key: 'margin', en: 'margin column', de: 'Randspalte' }
] as const);

/** How the lines of the page or of a staff were drawn. Several may apply ("blindgeritzt oder mit Tinte gezogen"). */
export const RULING = terms([
    { key: 'drypoint', en: 'dry-point', de: 'blindgeritzt' },
    { key: 'ink', en: 'drawn in ink', de: 'mit Tinte gezogen' },
    { key: 'plummet', en: 'drawn in plummet', de: 'mit Stift gezogen' }
] as const);

/** What the number of lines on a page counts. */
export const LINE_UNIT = terms([
    { key: 'systems', en: 'staves', de: 'Notensysteme' },
    { key: 'text-lines', en: 'text lines', de: 'Textzeilen' }
] as const);

/** How text and music share the written area. */
export const ARRANGEMENT = terms([
    { key: 'alternating', en: 'text line and staff alternate', de: 'Textzeile und Notensystem im Wechsel' },
    { key: 'interlinear', en: 'neumes above the text line, no staff', de: 'Neumen über der Textzeile, ohne Notensystem' },
    { key: 'textless', en: 'staves without text', de: 'Notensysteme ohne Text' }
] as const);

/** Whether the neumes show pitch by their height. */
export const HEIGHTING = terms([
    { key: 'heighted', en: 'heighted (diastematic) neumes', de: 'diastematische Neumen' },
    { key: 'unheighted', en: 'unheighted (adiastematic) neumes', de: 'adiastematische Neumen' }
] as const);

/** How often something occurs; the wording of the source descriptions ("meist", "selten", "sporadisch"). */
export const FREQUENCY = terms([
    { key: 'always', en: '', de: '' },
    { key: 'mostly', en: 'mostly', de: 'meist' },
    { key: 'often', en: 'often', de: 'häufig' },
    { key: 'sometimes', en: 'sometimes', de: 'bisweilen' },
    { key: 'sporadic', en: 'sporadically', de: 'sporadisch' },
    { key: 'rarely', en: 'rarely', de: 'selten' },
    { key: 'very-rarely', en: 'very rarely', de: 'sehr selten' }
] as const);

/** Colours of lines, initials and rubrics. The German form is the stem; `colourAdjective` inflects it. */
export const COLOUR = terms([
    { key: 'red', en: 'red', de: 'rot' },
    { key: 'yellow', en: 'yellow', de: 'gelb' },
    { key: 'green', en: 'green', de: 'grün' },
    { key: 'blue', en: 'blue', de: 'blau' },
    { key: 'light-blue', en: 'light blue', de: 'hellblau' },
    { key: 'violet', en: 'violet', de: 'violett' },
    { key: 'brown', en: 'brown', de: 'braun' },
    { key: 'black', en: 'black', de: 'schwarz' },
    { key: 'gold', en: 'gold', de: 'gold' }
] as const);

/** The colour each key is drawn in by the diagrams. */
export const COLOUR_HEX: Readonly<Record<string, string>> = {
    red: '#c0392b', yellow: '#e0b40a', green: '#3a8f3a', blue: '#2d5fb3', 'light-blue': '#6fa8dc',
    violet: '#7d3c98', brown: '#7a5230', black: '#222222', gold: '#b8902a'
};

/**
 * Pitch letters of clefs and coloured lines, from low to high, in the letter forms of the CM source descriptions
 * (Guidonian gamut: Γ, A–G, a–g, aa). The order is the order of the steps, so the index difference of two letters is
 * their distance in diatonic steps.
 */
export const PITCH_LETTERS = ['Γ', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'aa'] as const;

/** The form of a clef letter (the F clef "punktförmig" or "hakenförmig"). */
export const CLEF_SHAPE = terms([
    { key: 'letter', en: 'letter', de: 'Buchstabe' },
    { key: 'dot', en: 'dot-shaped', de: 'punktförmig' },
    { key: 'hook', en: 'hook-shaped', de: 'hakenförmig' }
] as const);

/** Where clefs stand. */
export const CLEF_PLACEMENT = terms([
    { key: 'every-system', en: 'at the start of every staff', de: 'zu Beginn jedes Notensystems' },
    { key: 'when-needed', en: 'only where the clef changes', de: 'nur bei Schlüsselwechsel' },
    { key: 'none', en: 'no clefs', de: 'keine Schlüssel' }
] as const);

/** Whether and where the clef changes. */
export const CLEF_CHANGE = terms([
    { key: 'none', en: 'no clef changes', de: 'keine Schlüsselwechsel' },
    { key: 'between-systems', en: 'clef changes between staves', de: 'Schlüsselwechsel zwischen den Notensystemen' },
    { key: 'within-system', en: 'clef changes also within a staff', de: 'Schlüsselwechsel auch innerhalb eines Notensystems' }
] as const);

/** Custodes at the end of a staff. */
export const CUSTOS = terms([
    { key: 'none', en: 'no custodes', de: 'keine Kustoden' },
    { key: 'present', en: 'custodes', de: 'Kustoden' },
    { key: 'sporadic', en: 'custodes only sporadically', de: 'Kustoden nur sporadisch' },
    { key: 'later-hand', en: 'custodes added by a later hand', de: 'Kustoden von späterer Hand ergänzt' }
] as const);

/** Rubrication. */
export const RUBRICATION = terms([
    { key: 'throughout', en: 'rubricated throughout', de: 'durchgehend rubriziert' },
    { key: 'partial', en: 'partly rubricated', de: 'teilweise rubriziert' },
    { key: 'not-executed', en: 'rubrics not executed', de: 'Rubriken nicht ausgeführt' },
    { key: 'none', en: 'no rubrics', de: 'keine Rubriken' }
] as const);

/** Kinds of initials and decorated letters named in the "Ausstattung" sections. */
export const INITIAL_KIND = terms([
    { key: 'lombard', en: 'Lombardic initials', de: 'Lombarden' },
    { key: 'cadel', en: 'cadels', de: 'Cadellen' },
    { key: 'fleuronne', en: 'penwork (fleuronné) initials', de: 'Fleuronné-Initialen' },
    { key: 'split', en: 'split initials', de: 'gespaltene Initialen' },
    { key: 'foliate', en: 'foliate initials', de: 'Rankeninitialen' },
    { key: 'painted', en: 'painted initials', de: 'Deckfarbeninitialen' },
    { key: 'historiated', en: 'historiated initials', de: 'historisierte Initialen' },
    { key: 'gold', en: 'initials in gold', de: 'Initialen in Gold' }
] as const);

export type Key<T extends readonly Term[]> = T[number]['key'];
export type AreaSource = Key<typeof AREA_SOURCE>;
export type SideColumn = Key<typeof SIDE_COLUMN>;
export type Ruling = Key<typeof RULING>;
export type LineUnit = Key<typeof LINE_UNIT>;
export type Arrangement = Key<typeof ARRANGEMENT>;
export type Heighting = Key<typeof HEIGHTING>;
export type Frequency = Key<typeof FREQUENCY>;
export type Colour = Key<typeof COLOUR>;
export type PitchLetter = typeof PITCH_LETTERS[number];
export type ClefShape = Key<typeof CLEF_SHAPE>;
export type ClefPlacement = Key<typeof CLEF_PLACEMENT>;
export type ClefChange = Key<typeof CLEF_CHANGE>;
export type Custos = Key<typeof CUSTOS>;
export type Rubrication = Key<typeof RUBRICATION>;
export type InitialKind = Key<typeof INITIAL_KIND>;

/** The term of `key` in `list`, or undefined. */
export function termOf(list: readonly Term[], key: string): Term | undefined {
    return list.find(t => t.key === key);
}

/** Every list by the field name the design document uses, for editors and validators. */
export const VOCABULARY = {
    areaSource: AREA_SOURCE,
    sideColumn: SIDE_COLUMN,
    ruling: RULING,
    lineUnit: LINE_UNIT,
    arrangement: ARRANGEMENT,
    heighting: HEIGHTING,
    frequency: FREQUENCY,
    colour: COLOUR,
    clefShape: CLEF_SHAPE,
    clefPlacement: CLEF_PLACEMENT,
    clefChange: CLEF_CHANGE,
    custos: CUSTOS,
    rubrication: RUBRICATION,
    initialKind: INITIAL_KIND
} as const;
