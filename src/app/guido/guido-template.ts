import { NoteFlagDef, sanitizeNoteFlags } from '../notes/note-flags';
import { NoteType } from '../types/model';
import { GLYPH_TABLES } from './guido-glyphs';

/**
 * An import template says how a Word file with GUIDO music is laid out and how its signs are stored in
 * Monodi. The layout it describes: one table per phrase of the chant; a code row has the source siglum in
 * one column and, in the columns after it, one cell of GUIDO code per syllable; the row below a code row
 * may be a text row (empty siglum cell). The first text row of a table is shared by all sources, a later
 * one belongs to the code row above it and replaces the shared text in the columns it fills.
 */
export type GuidoShape = 'punctum' | 'virga' | 'quilisma' | 'tenor';

/** How one shape is stored on a Monodi note: a note type, a user-defined flag, or both. */
export interface ShapeMapping {
  noteType?: NoteType;
  flag?: string;
}

export interface GuidoTemplate {
  id: string;
  name: string;
  /** Key into GLYPH_TABLES: the font and keyboard layout the code was typed in. */
  glyphTable: string;
  /** Only runs in this font are read as code ('' = every run). */
  codeFont: string;
  layout: {
    /** 0-based column of the siglum in a code row. */
    siglumColumn: number;
    /** First column that holds a syllable's code (a column with only the clef counts). */
    firstCodeColumn: number;
  };
  /** Runs in this colour (hex, no #) are copies kept for the look and are not read ('' = read all). */
  notAttestedColor: string;
  /** The title paragraph, e.g. "R 1001_Dum staret" read with the pattern "{id}_{incipit}". */
  title: { paragraph: number; pattern: string };
  /** Patterns over {siglum} and the title fields; custom values are stored in document.custom. */
  document: { idPattern: string; textinitium: string; custom: { [key: string]: string } };
  symbols: {
    /** Empty glyph that keeps two notes in one ligature. */
    join: string;
    /** Empty glyph for a short gap inside a neume. */
    shortGap: string;
    /** Phrasing marks (, . : ;) go into the report only, or are appended to the syllable text. */
    phrasingMarks: 'report' | 'text';
  };
  mapping: {
    shapes: { [shape in GuidoShape]: ShapeMapping };
    plicaFlag: string;
    /** Used for a sign of alteration when its note is not a plain punctum (a note has one note type). */
    accidentalFlags: { flat: string; sharp: string; natural: string };
    /** Put the clef of the source at the start of each document. */
    clef: 'source' | 'none';
  };
  /** Flag definitions added to the project settings when missing, so the flags show up in the editor. */
  ensureFlags: NoteFlagDef[];
}

export const BUILTIN_TEMPLATE_ID = 'budapest-guido6-hu';

export const BUILTIN_GUIDO_TEMPLATE: GuidoTemplate = {
  id: BUILTIN_TEMPLATE_ID,
  name: 'GUIDO table (Budapest, guido6+, Hungarian keys)',
  glyphTable: 'guido6-hu',
  codeFont: 'guido6+',
  layout: { siglumColumn: 0, firstCodeColumn: 1 },
  notAttestedColor: 'BFBFBF',
  title: { paragraph: 0, pattern: '{id}_{incipit}' },
  document: {
    idPattern: '{siglum}-{id}',
    textinitium: '{incipit}',
    custom: { chant_id: '{id}' },
  },
  symbols: { join: '\\', shortGap: 'n', phrasingMarks: 'report' },
  mapping: {
    shapes: {
      punctum: {},
      virga: { flag: 'V' },
      quilisma: { noteType: NoteType.Quilisma },
      tenor: { flag: 'T' },
    },
    plicaFlag: 'P',
    accidentalFlags: { flat: 'F', sharp: 'H', natural: 'U' },
    clef: 'source',
  },
  ensureFlags: [
    { key: 'V', label: 'Virga', abbrev: 'V', meiTag: 'virga' },
    { key: 'P', label: 'Plica', abbrev: 'P' },
    { key: 'T', label: 'Tenor note', abbrev: 'T' },
    { key: 'F', label: 'Flat (on a stemmed note)', abbrev: 'b' },
    { key: 'H', label: 'Sharp (on a stemmed note)', abbrev: '#' },
    { key: 'U', label: 'Natural (on a stemmed note)', abbrev: 'n' },
  ],
};

const SHAPES: GuidoShape[] = ['punctum', 'virga', 'quilisma', 'tenor'];

const isObj = (v: unknown): v is { [k: string]: unknown } => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown, dflt: string): string => (typeof v === 'string' ? v : dflt);
const col = (v: unknown, dflt: number): number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 200 ? v : dflt;

function mapping(raw: unknown, dflt: ShapeMapping, errors: string[], label: string): ShapeMapping {
  if (raw === undefined) return { ...dflt };
  if (!isObj(raw)) { errors.push(`${label} must be an object`); return { ...dflt }; }
  const out: ShapeMapping = {};
  if (raw['noteType'] !== undefined) {
    if (Object.values(NoteType).includes(raw['noteType'] as NoteType)) out.noteType = raw['noteType'] as NoteType;
    else errors.push(`${label}.noteType "${String(raw['noteType'])}" is not a note type`);
  }
  if (raw['flag'] !== undefined) {
    if (typeof raw['flag'] === 'string' && /^[A-Z]$/.test(raw['flag'])) out.flag = raw['flag'];
    else errors.push(`${label}.flag must be one uppercase letter`);
  }
  return out;
}

/**
 * Builds a template from stored or typed JSON. Missing fields take the built-in's value; what is wrong is
 * listed in `errors` and, where it can be, replaced by the built-in's value. `template` is undefined only
 * when the input is not an object or has no id/name.
 */
export function parseGuidoTemplate(raw: unknown): { template?: GuidoTemplate; errors: string[] } {
  const errors: string[] = [];
  if (!isObj(raw)) return { errors: ['The template must be a JSON object.'] };
  const d = BUILTIN_GUIDO_TEMPLATE;
  const id = str(raw['id'], '').trim();
  const name = str(raw['name'], '').trim();
  if (!id) errors.push('The template needs an "id".');
  if (!name) errors.push('The template needs a "name".');
  if (!id || !name) return { errors };
  if (id === BUILTIN_TEMPLATE_ID) errors.push(`"${BUILTIN_TEMPLATE_ID}" is the built-in template's id; choose another.`);

  const glyphTable = str(raw['glyphTable'], d.glyphTable);
  if (!GLYPH_TABLES[glyphTable]) {
    errors.push(`Unknown glyph table "${glyphTable}" (known: ${Object.keys(GLYPH_TABLES).join(', ')}).`);
  }
  const layout = isObj(raw['layout']) ? raw['layout'] : {};
  const title = isObj(raw['title']) ? raw['title'] : {};
  const doc = isObj(raw['document']) ? raw['document'] : {};
  const sym = isObj(raw['symbols']) ? raw['symbols'] : {};
  const map = isObj(raw['mapping']) ? raw['mapping'] : {};
  const shapesRaw = isObj(map['shapes']) ? map['shapes'] : {};
  const accRaw = isObj(map['accidentalFlags']) ? map['accidentalFlags'] : {};

  const custom: { [k: string]: string } = {};
  if (isObj(doc['custom'])) {
    for (const [k, v] of Object.entries(doc['custom'])) if (typeof v === 'string') custom[k] = v;
  } else if (doc['custom'] === undefined) Object.assign(custom, d.document.custom);

  const flagLetter = (v: unknown, dflt: string, label: string): string => {
    if (v === undefined) return dflt;
    if (typeof v === 'string' && (v === '' || /^[A-Z]$/.test(v))) return v;
    errors.push(`${label} must be one uppercase letter or empty`);
    return dflt;
  };

  const shapes = {} as { [s in GuidoShape]: ShapeMapping };
  for (const s of SHAPES) shapes[s] = mapping(shapesRaw[s], d.mapping.shapes[s], errors, `mapping.shapes.${s}`);

  const phrasing = sym['phrasingMarks'];
  if (phrasing !== undefined && phrasing !== 'report' && phrasing !== 'text') {
    errors.push('symbols.phrasingMarks must be "report" or "text"');
  }
  const clef = map['clef'];
  if (clef !== undefined && clef !== 'source' && clef !== 'none') errors.push('mapping.clef must be "source" or "none"');
  const patternOf = (v: unknown, dflt: string, label: string): string => {
    if (v === undefined) return dflt;
    if (typeof v === 'string') return v;
    errors.push(`${label} must be text`);
    return dflt;
  };
  const colour = str(raw['notAttestedColor'], d.notAttestedColor).replace(/^#/, '').toUpperCase();
  if (colour && !/^[0-9A-F]{6}$/.test(colour)) errors.push('notAttestedColor must be a hex colour like BFBFBF or empty');

  const template: GuidoTemplate = {
    id,
    name,
    glyphTable,
    codeFont: str(raw['codeFont'], d.codeFont),
    layout: {
      siglumColumn: col(layout['siglumColumn'], d.layout.siglumColumn),
      firstCodeColumn: col(layout['firstCodeColumn'], d.layout.firstCodeColumn),
    },
    notAttestedColor: /^[0-9A-F]{6}$/.test(colour) || colour === '' ? colour : d.notAttestedColor,
    title: {
      paragraph: col(title['paragraph'], d.title.paragraph),
      pattern: patternOf(title['pattern'], d.title.pattern, 'title.pattern'),
    },
    document: {
      idPattern: patternOf(doc['idPattern'], d.document.idPattern, 'document.idPattern'),
      textinitium: patternOf(doc['textinitium'], d.document.textinitium, 'document.textinitium'),
      custom,
    },
    symbols: {
      join: str(sym['join'], d.symbols.join).slice(0, 1) || d.symbols.join,
      shortGap: str(sym['shortGap'], d.symbols.shortGap).slice(0, 1) || d.symbols.shortGap,
      phrasingMarks: phrasing === 'text' ? 'text' : phrasing === 'report' ? 'report' : d.symbols.phrasingMarks,
    },
    mapping: {
      shapes,
      plicaFlag: flagLetter(map['plicaFlag'], d.mapping.plicaFlag, 'mapping.plicaFlag'),
      accidentalFlags: {
        flat: flagLetter(accRaw['flat'], d.mapping.accidentalFlags.flat, 'mapping.accidentalFlags.flat'),
        sharp: flagLetter(accRaw['sharp'], d.mapping.accidentalFlags.sharp, 'mapping.accidentalFlags.sharp'),
        natural: flagLetter(accRaw['natural'], d.mapping.accidentalFlags.natural, 'mapping.accidentalFlags.natural'),
      },
      clef: clef === 'none' ? 'none' : 'source',
    },
    ensureFlags: raw['ensureFlags'] === undefined ? d.ensureFlags.map(f => ({ ...f })) : sanitizeNoteFlags(raw['ensureFlags']),
  };
  return { template, errors };
}

/** The list stored in the project settings: invalid entries and duplicate ids are dropped. */
export function sanitizeGuidoTemplates(raw: unknown): GuidoTemplate[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>([BUILTIN_TEMPLATE_ID]);
  const out: GuidoTemplate[] = [];
  for (const r of raw) {
    const { template, errors } = parseGuidoTemplate(r);
    if (!template || errors.length || seen.has(template.id)) continue;
    seen.add(template.id);
    out.push(template);
  }
  return out;
}

/** All templates a user can pick: the built-in one first. */
export function allGuidoTemplates(stored: GuidoTemplate[] | undefined): GuidoTemplate[] {
  return [BUILTIN_GUIDO_TEMPLATE, ...(stored ?? [])];
}

/** Replaces {name} in a pattern; unknown names become ''. */
export function fillPattern(pattern: string, vars: { [name: string]: string }): string {
  return pattern.replace(/\{(\w+)\}/g, (_, n: string) => vars[n] ?? '');
}

/** Reads `text` with a pattern like "{id}_{incipit}"; null when the text does not fit. */
export function matchPattern(pattern: string, text: string): { [name: string]: string } | null {
  const names: string[] = [];
  const source = pattern
    .split(/(\{\w+\})/)
    .map(part => {
      const m = /^\{(\w+)\}$/.exec(part);
      if (m) { names.push(m[1]); return '(.*?)'; }
      return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('');
  const m = new RegExp(`^\\s*${source}\\s*$`).exec(text);
  if (!m) return null;
  const out: { [name: string]: string } = {};
  names.forEach((n, i) => { out[n] = (m[i + 1] ?? '').trim(); });
  return out;
}
