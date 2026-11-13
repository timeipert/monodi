/**
 * The page layout of a manuscript as data: the writing space, the text lines and staves, the colourings and the
 * clefs. A layout has one or more sections, because a manuscript may change its layout between folio ranges or
 * notators ("F. 1–33v: … F. 34–42v: …", "Notator A: … Notator B: …").
 *
 * `normalisePageLayout` turns any input (a stored object, a file someone edited) into a complete layout: unknown
 * keys are dropped, values outside the vocabulary fall back to the empty value, numbers are checked. Every field is
 * optional in the sense that its empty value ('' , null, []) means "not recorded".
 *
 * Design and reasons: `apps/neume-docs/docs/page-layout.md` in this repository.
 */
import type {
    AreaSource, Arrangement, ClefChange, ClefPlacement, ClefShape, Colour, Custos, Frequency, Heighting, InitialKind,
    LineUnit, PitchLetter, Rubrication, Ruling, SideColumn, Term
} from './vocabulary';
import {
    AREA_SOURCE, ARRANGEMENT, CLEF_CHANGE, CLEF_PLACEMENT, CLEF_SHAPE, COLOUR, CUSTOS, FREQUENCY, HEIGHTING,
    INITIAL_KIND, LINE_UNIT, PITCH_LETTERS, RUBRICATION, RULING, SIDE_COLUMN
} from './vocabulary';

/** The format version written into every layout. */
export const PAGE_LAYOUT_VERSION = 1;

/** A measure that may be a range ("17–17,5"); `max` is null for a single value. Centimetres unless said otherwise. */
export interface Range {
    min: number | null;
    max: number | null;
}

/** 1. Division of the writing space (Einteilung des Schriftraums). */
export interface WritingSpace {
    /** The leaf (Blatt), height × width in cm. */
    leaf: { height: Range; width: Range };
    /** The written area (Schriftraum), height × width in cm. */
    area: { height: Range; width: Range };
    areaSource: AreaSource | '';
    /** Citation when `areaSource` is 'literature' ("Husmann 1964"). */
    areaReference: string;
    /** 1 or 2 text columns; null = not recorded. */
    columns: 1 | 2 | null;
    /** Width of one column in cm (only for two columns). */
    columnWidth: number | null;
    sideColumn: SideColumn | '';
    /** Width of the side column in cm. */
    sideColumnWidth: number | null;
    /** How the frame of the written area was ruled. */
    ruling: Ruling[];
    /** Margins in cm; null = not recorded. Used by the diagram only. */
    margins: { top: number | null; bottom: number | null; inner: number | null; outer: number | null };
    /** Lines per page (per column for two columns). */
    lines: { unit: LineUnit | ''; count: Range; variable: boolean };
}

/** 2. Text lines and staves (Textzeilen und Notensysteme). */
export interface Staves {
    arrangement: Arrangement | '';
    heighting: Heighting | '';
    /** Number of staff lines (0 = no line). null = not recorded. */
    lineCount: number | null;
    /** Further line counts that also occur, each with its frequency ("vier oder (selten) fünf"). */
    otherLineCounts: Array<{ count: number; frequency: Frequency }>;
    ruling: Ruling[];
    /** Colour of the staff lines that are not coloured to mark a pitch ("vier roten Linien", "braunen Linien"). */
    lineColour: Colour | '';
    /** The line drawn for the text is also used as a staff line. */
    textLineAsStaffLine: Frequency | '';
}

/** A staff line coloured to mark a pitch ("rote F-Linie"). `alternative` is the octave it may also stand for. */
export interface ColouredLine {
    pitch: PitchLetter | '';
    alternative: PitchLetter | '';
    colour: Colour | '';
    frequency: Frequency;
}

/** 3. Colourings (Färbungen) of lines, initials and rubrics. */
export interface Colourings {
    /** In descending order of frequency, as the notes on use ask. */
    lines: ColouredLine[];
    rubrication: Rubrication | '';
    initials: { kinds: InitialKind[]; colours: Colour[]; size: Range };
    /** Colours of the melisma bands (Melismenbänder). */
    melismaBands: Colour[];
}

/** One clef or one combination of clefs written together ("F- und c-Schlüssel"). */
export interface ClefUse {
    letters: PitchLetter[];
    frequency: Frequency;
}

/** 4. Clefs (Schlüsselungen) and custodes. */
export interface Clefs {
    /** In descending order of frequency. "F- oder c-Schlüssel" are two uses, "F- und c-Schlüssel" one. */
    uses: ClefUse[];
    shapes: Array<{ letter: PitchLetter; shape: ClefShape }>;
    placement: ClefPlacement | '';
    changes: ClefChange | '';
    custos: Custos | '';
}

/** The layout of a folio range or of a notator. */
export interface LayoutSection {
    /** Folio range ("1–33v"); '' = the whole manuscript or project. */
    folios: string;
    /** Notator or hand ("Notator A"); ''. */
    hand: string;
    writingSpace: WritingSpace;
    staves: Staves;
    colourings: Colourings;
    clefs: Clefs;
    /** Free remark in English, with its German original in `note_de` (both or neither). */
    note: string;
    note_de: string;
}

export interface PageLayout {
    version: number;
    sections: LayoutSection[];
}

// ---------------------------------------------------------------------------------------------------------------

const keysOf = (list: readonly Term[]) => list.map(t => t.key);
const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const pick = <T extends string>(v: unknown, list: readonly Term[]): T | '' =>
    (typeof v === 'string' && keysOf(list).includes(v) ? (v as T) : '');
const pickMany = <T extends string>(v: unknown, list: readonly Term[]): T[] =>
    (Array.isArray(v) ? [...new Set(v.filter((x): x is T => typeof x === 'string' && keysOf(list).includes(x)))] : []);
const frequency = (v: unknown): Frequency => (pick<Frequency>(v, FREQUENCY) || 'always');
const pitch = (v: unknown): PitchLetter | '' =>
    (typeof v === 'string' && (PITCH_LETTERS as readonly string[]).includes(v) ? (v as PitchLetter) : '');

/** A positive number (a German decimal comma is read too), or null. */
export function measure(v: unknown): number | null {
    const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v.trim().replace(',', '.')) : NaN;
    return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

function range(v: unknown): Range {
    const r = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
    const min = measure(r.min), max = measure(r.max);
    if (min === null) return { min: max, max: null };
    return { min, max: max !== null && max > min ? max : null };
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {});
const count = (v: unknown, max = 99): number | null => {
    const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
    return Number.isInteger(n) && n >= 0 && n <= max ? n : null;
};

function writingSpace(v: unknown): WritingSpace {
    const w = obj(v);
    const leaf = obj(w.leaf), area = obj(w.area), margins = obj(w.margins), lines = obj(w.lines);
    const columns = w.columns === 1 || w.columns === 2 ? w.columns : null;
    return {
        leaf: { height: range(leaf.height), width: range(leaf.width) },
        area: { height: range(area.height), width: range(area.width) },
        areaSource: pick<AreaSource>(w.areaSource, AREA_SOURCE),
        areaReference: text(w.areaReference),
        columns,
        columnWidth: columns === 2 ? measure(w.columnWidth) : null,
        sideColumn: pick<SideColumn>(w.sideColumn, SIDE_COLUMN),
        sideColumnWidth: w.sideColumn === 'initials' || w.sideColumn === 'margin' ? measure(w.sideColumnWidth) : null,
        ruling: pickMany<Ruling>(w.ruling, RULING),
        margins: { top: measure(margins.top), bottom: measure(margins.bottom), inner: measure(margins.inner), outer: measure(margins.outer) },
        lines: { unit: pick<LineUnit>(lines.unit, LINE_UNIT), count: countRange(lines.count), variable: !!lines.variable }
    };
}

function countRange(v: unknown): Range {
    const r = obj(v);
    const min = count(r.min), max = count(r.max);
    if (min === null) return { min: max, max: null };
    return { min, max: max !== null && max > min ? max : null };
}

function staves(v: unknown): Staves {
    const s = obj(v);
    const lineCount = count(s.lineCount, 6);
    const others = Array.isArray(s.otherLineCounts) ? s.otherLineCounts : [];
    const seen = new Set<number>(lineCount === null ? [] : [lineCount]);
    const otherLineCounts: Staves['otherLineCounts'] = [];
    for (const o of others) {
        const c = count(obj(o).count, 6);
        if (c === null || seen.has(c)) continue;
        seen.add(c);
        otherLineCounts.push({ count: c, frequency: frequency(obj(o).frequency) });
    }
    return {
        arrangement: pick<Arrangement>(s.arrangement, ARRANGEMENT),
        heighting: pick<Heighting>(s.heighting, HEIGHTING),
        lineCount,
        otherLineCounts,
        ruling: pickMany<Ruling>(s.ruling, RULING),
        lineColour: pick<Colour>(s.lineColour, COLOUR),
        textLineAsStaffLine: pick<Frequency>(s.textLineAsStaffLine, FREQUENCY)
    };
}

function colourings(v: unknown): Colourings {
    const c = obj(v);
    const initials = obj(c.initials);
    return {
        lines: (Array.isArray(c.lines) ? c.lines : []).map(obj).map(l => ({
            pitch: pitch(l.pitch),
            alternative: pitch(l.alternative),
            colour: pick<Colour>(l.colour, COLOUR),
            frequency: frequency(l.frequency)
        })).filter(l => l.pitch || l.colour),
        rubrication: pick<Rubrication>(c.rubrication, RUBRICATION),
        initials: {
            kinds: pickMany<InitialKind>(initials.kinds, INITIAL_KIND),
            colours: pickMany<Colour>(initials.colours, COLOUR),
            size: countRange(initials.size)
        },
        melismaBands: pickMany<Colour>(c.melismaBands, COLOUR)
    };
}

function clefs(v: unknown): Clefs {
    const c = obj(v);
    const uses = (Array.isArray(c.uses) ? c.uses : []).map(obj).map(u => ({
        letters: [...new Set((Array.isArray(u.letters) ? u.letters : []).map(pitch).filter((p): p is PitchLetter => !!p))],
        frequency: frequency(u.frequency)
    })).filter(u => u.letters.length > 0);
    const shapes: Clefs['shapes'] = [];
    for (const s of (Array.isArray(c.shapes) ? c.shapes : []).map(obj)) {
        const letter = pitch(s.letter);
        const shape = pick<ClefShape>(s.shape, CLEF_SHAPE);
        if (letter && shape && !shapes.some(x => x.letter === letter)) shapes.push({ letter, shape });
    }
    return {
        uses,
        shapes,
        placement: pick<ClefPlacement>(c.placement, CLEF_PLACEMENT),
        changes: pick<ClefChange>(c.changes, CLEF_CHANGE),
        custos: pick<Custos>(c.custos, CUSTOS)
    };
}

/** A complete section from any input. */
export function normaliseSection(v: unknown): LayoutSection {
    const s = obj(v);
    const note = text(s.note), note_de = text(s.note_de);
    // A note always comes with its German original: a lone half is kept in the field that has it, and marked so the
    // editor asks for the other (see `sectionProblems`).
    return {
        folios: text(s.folios),
        hand: text(s.hand),
        writingSpace: writingSpace(s.writingSpace),
        staves: staves(s.staves),
        colourings: colourings(s.colourings),
        clefs: clefs(s.clefs),
        note,
        note_de
    };
}

/** An empty section: nothing recorded. */
export function emptySection(): LayoutSection {
    return normaliseSection({});
}

/** A complete layout from any input; a layout always has at least one section. */
export function normalisePageLayout(v: unknown): PageLayout {
    const l = obj(v);
    const sections = (Array.isArray(l.sections) ? l.sections : []).map(normaliseSection);
    return { version: PAGE_LAYOUT_VERSION, sections: sections.length ? sections : [emptySection()] };
}

/** True when nothing at all is recorded in the layout. */
export function isEmptyLayout(layout: PageLayout): boolean {
    const blank = JSON.stringify(emptySection());
    return layout.sections.every(s => JSON.stringify(s) === blank);
}

/**
 * What is inconsistent in a section, as English sentences (an editor shows them; nothing is rejected): a note
 * without its German original or the other way round, a coloured line or clef that cannot stand on a staff line
 * together with the others (their distance is an odd number of steps), coloured lines without any staff line.
 */
export function sectionProblems(section: LayoutSection): string[] {
    const problems: string[] = [];
    if (!!section.note !== !!section.note_de) problems.push('The note needs both its English text and its German original.');
    const clefPitches = section.clefs.uses.flatMap(u => u.letters);
    const idx = (p: PitchLetter) => (PITCH_LETTERS as readonly string[]).indexOf(p);
    for (const use of section.clefs.uses) {
        const [a, b] = use.letters;
        if (a && b && Math.abs(idx(a) - idx(b)) % 2 === 1) problems.push(`The clefs ${use.letters.join(' and ')} cannot both stand on lines.`);
    }
    const colouredPitches = section.colourings.lines.map(l => l.pitch).filter(Boolean) as PitchLetter[];
    for (let i = 1; i < colouredPitches.length; i++) {
        if (Math.abs(idx(colouredPitches[0]) - idx(colouredPitches[i])) % 2 === 1) {
            problems.push(`The coloured ${colouredPitches[0]} and ${colouredPitches[i]} lines cannot both be staff lines.`);
        }
    }
    if (section.staves.lineCount === 0 && section.colourings.lines.length) problems.push('Coloured lines are recorded, but the staff has no line.');
    if (section.staves.lineCount === 0 && clefPitches.length) problems.push('Clefs are recorded, but the staff has no line.');
    return problems;
}
