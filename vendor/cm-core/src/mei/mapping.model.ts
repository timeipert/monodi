export interface MeiAttributeRule {
  name: string;                       // attribute name, e.g. "pname"
  source: 'static' | 'field';
  value: string;                      // static text, OR a field key from ENTITY_FIELDS
  omitIfEmpty?: boolean;
}

export interface MeiEntityRule {
  enabled: boolean;
  tag: string;                        // emitted element name
  wrappers: string[];                 // wrapper chain around each instance, outermost first
  attributes: MeiAttributeRule[];
  textFrom?: string | null;           // field key whose value becomes the text content
}

export type MeiEntityKey =
  'formteil' | 'zeile' | 'paratext' | 'syllable' | 'syllableText' | 'neume' |
  'note' | 'clef' | 'oriscus' | 'quilisma' | 'strophicus' | 'liquescent';

/**
 * MEI attributes attached to a neume pattern (e.g. `[*ud]`), optionally only for
 * one manuscript (`sigle`). `nc` holds one attribute object per note of the
 * pattern, in the format of the Neume Viewer's pattern library (`mei`).
 * pname/oct are never taken from a rule — they come from the notes.
 */
export interface MeiPatternRule {
  id: string;
  pattern: string;                       // base code, e.g. "[*ud]"
  sigle?: string;                        // manuscript siglum; empty/undefined = all manuscripts
  enabled: boolean;
  neume?: Record<string, string>;        // extra attributes on <neume>
  nc: Record<string, string>[];          // one entry per note
}

/** Pattern code without a trailing variant label (`*dd b` → `*dd`). */
export function patternBaseCode(pattern: string | undefined): string {
  return String(pattern ?? '').trim().split(' ')[0];
}

/** Number of notes in a pattern code: one `*` plus one u/d/e step per further note. */
export function patternNoteCount(pattern: string): number {
  return (patternBaseCode(pattern).match(/[*ude]/g) || []).length;
}

/** Resize `nc` to the pattern's note count (pad with {} / truncate). */
export function normalizePatternRule(rule: MeiPatternRule): MeiPatternRule {
  const n = patternNoteCount(rule.pattern);
  const nc = Array.from({ length: n }, (_, i) => ({ ...(rule.nc?.[i] || {}) }));
  return { ...rule, pattern: patternBaseCode(rule.pattern), nc };
}

/** Manuscript-specific rule beats a global one; disabled rules are ignored. */
export function resolvePatternRule(
  rules: MeiPatternRule[] | undefined, pattern: string, sigle?: string
): MeiPatternRule | undefined {
  if (!rules || !pattern) return undefined;
  const code = patternBaseCode(pattern);
  const live = rules.filter(r => r.enabled && patternBaseCode(r.pattern) === code);
  return (sigle ? live.find(r => r.sigle === sigle) : undefined) || live.find(r => !r.sigle);
}

/** Which MEI element an annotation (a hand-set attribute or a rule) writes to. */
export type AnnotationTarget = 'nc' | 'neume' | 'syllable';

/**
 * Rule that sets MEI attributes where its conditions all hold ("annotation rule"). Conditions that are
 * left out do not restrict. Rules run in list order at export; a later rule overrides an earlier one
 * for the same attribute, and an attribute set by hand on a note always wins.
 */
export interface MeiAnnotationRule {
  id: string;
  name: string;
  enabled: boolean;
  /** Manuscript siglum; empty or missing = every manuscript. */
  sigle?: string;
  /** Element that receives `set`: every matching note (`nc`), the neume of a matching note, or its syllable. */
  target: AnnotationTarget;
  match: {
    /** Pattern code of the neume, in the syntax of the pattern tool (`*u`, `[*ud]`, `ud`, `*??`). */
    neume?: { text: string; mode: 'whole' | 'contains'; ignoreShapes: boolean };
    /** Which notes of the matched pattern count (default: all). */
    position?: { which: 'first' | 'last' | 'all' | 'nth'; nth?: number };
    /** JavaScript regular expression tested on the syllable text, case-insensitive. */
    syllableText?: string;
    /** Note types (`Normal`, `Oriscus`, ...); the note must be one of them. */
    noteTypes?: string[];
    /** JavaScript regular expression tested on the pitch written as letter and octave, for example `G4`. */
    pitch?: string;
    liquescent?: boolean;
    /** Key of a note flag that the note must carry. */
    flag?: string;
  };
  /** Attributes to set. A value may contain `{pname}`, `{oct}`, `{syllable}`, `{index}` (1-based position in the neume). */
  set: Record<string, string>;
}

/** How a syllable type of Monodi that is not `Normal` is written. */
export type MeiSyllableTypeForm =
  /** `<syllable type="…">`: the syllable stays where it is and carries the value. */
  | 'attribute'
  /** `<supplied type="…" reason="…">` around the syllable: the content is not (fully) in the source. */
  | 'supplied'
  /** `<gap type="…" reason="…"/>` as the first child of the syllable. */
  | 'gap'
  /** Nothing: the type is not written. */
  | 'none';

export interface MeiSyllableTypeRule {
  form: MeiSyllableTypeForm;
  /** Value of `@type`. */
  value: string;
  /** Value of `@reason` (forms `supplied` and `gap`). */
  reason?: string;
}

export type MeiSyllableTypeKey = 'WithoutNotes' | 'SourceEllipsis' | 'EditorialEllipsis';

/**
 * Defaults of the syllable types (state 2026-11-02). MEI neume notation has no element for the type of a syllable:
 * a syllable without notes needs no wrapper (a syllable may hold only `syl`), the two ellipses are material that is not
 * (fully) written in the source and are marked with `supplied`, which the neume schema allows around a syllable.
 */
export const DEFAULT_SYLLABLE_TYPES: Record<MeiSyllableTypeKey, MeiSyllableTypeRule> = {
  WithoutNotes: { form: 'attribute', value: 'withoutNotes' },
  SourceEllipsis: { form: 'supplied', value: 'sourceEllipsis', reason: 'ellipsis in the source' },
  EditorialEllipsis: { form: 'supplied', value: 'editorialEllipsis', reason: 'ellipsis made by the edition' }
};

export function syllableTypeRule(profile: MeiMappingProfileV2, type: string): MeiSyllableTypeRule | undefined {
  const key = type as MeiSyllableTypeKey;
  return profile.syllableTypes?.[key] ?? DEFAULT_SYLLABLE_TYPES[key];
}

/** The staff of the score: the editor draws five lines and, at a line start, a G clef on the second line from the bottom. */
export interface MeiStaffSettings {
  lines: number;
  clefShape: string;
  clefLine: number;
}

export const DEFAULT_STAFF: MeiStaffSettings = { lines: 5, clefShape: 'G', clefLine: 2 };

export interface MeiMappingProfileV2 {
  version: 2;
  id: string;
  name: string;
  /** Set on the profiles that are built in (see `MEI_PRESETS`): the id of the preset. A copy made by a person has none. */
  presetId?: string;
  skeleton: string[];                 // element chain inside <mei> around the content, e.g. ['music','body','mdiv','score']
  emitHeader: boolean;                // emit the meiHead block
  /** Header level: 1 Minimal (baseline, default), 2 Standard, 3 Extended. See mei-header.ts and CM-hub/docs/METADATA-STANDARDS.md. */
  headerLevel?: 1 | 2 | 3;
  /**
   * Body structure that follows the MEI 5.0 schema of the app (mei-all.rng): a line is a <staff><layer> of its own after an <sb> in the
   * section, ornaments (oriscus, quilisma, strophicus, liquescent) are empty children of <nc>, and commentary copies of notes get their
   * own xml:id. Off by default so existing exports stay as they are; see CM-hub/docs/MEI-BODY-MAPPING.md.
   */
  schemaConformant?: boolean;
  /** How the syllable types `WithoutNotes`, `SourceEllipsis` and `EditorialEllipsis` are written; missing entries use `DEFAULT_SYLLABLE_TYPES`. */
  syllableTypes?: Partial<Record<MeiSyllableTypeKey, MeiSyllableTypeRule>>;
  /** Lines and clef of the `staffDef` of the score (conformant structure); missing = `DEFAULT_STAFF`. */
  staff?: MeiStaffSettings;
  /** A change of manuscript line inside a Monodi line becomes `<sb type="manuscriptLine"/>` in the layer (conformant structure); default on. */
  lineBreaks?: boolean;
  /** The additional melodies of a syllable become one `<staff n="2">` and so on per voice, aligned by `@corresp` or `@sameas` and `@synch` (conformant structure); default on. */
  voices?: boolean;
  /**
   * Notation of the body. `neume` (default): `syllable`, `neume`, `nc`. `premensural`: no syllable; a neume of several notes is a
   * `ligature` of `note`s, a neume of one note is a `note`, the text is a `verse` with a `syl` in the first of them, the staff has
   * `notationtype="premensural"` and the file names the MEI Mensural schema. Not yet valid against that schema (state 2026-11-05).
   */
  notation?: 'neume' | 'premensural';
  /** Which voice of a syllable with several voices carries the text: the `first` (default) or the `last` voice that has notes. */
  voiceText?: 'first' | 'last';
  /**
   * How the other voices refer to the text: `corresp` (default): `syllable/@corresp` to the syllable of the text voice and no `syl`;
   * `sameas`: a `syl/@sameas` to the `syl` of the text voice (that `syl` gets an `xml:id`).
   */
  voiceLink?: 'corresp' | 'sameas';
  /** Names of the voices, in staff order, written as `<label>` of the `staffDef` (for example `triplum`, `duplum`). */
  voiceLabels?: string[];
  /** The staves of several voices are grouped with a bracket (`staffGrp/@symbol="bracket"`); default off. */
  voiceBracket?: boolean;
  /** Write an `<sb/>` before the first staff of a section; default on. Off: only the lines after the first start with one. */
  firstLineBreak?: boolean;
  /** Write `@wordpos` and `@con` on the `syl` (conformant structure); default on. */
  wordPosition?: boolean;
  /** Notes of a line of adiastematic notation: `contour` writes `@intm` (u, d or s) and no pitch, `pitch` writes the stored pitches; default `contour`. */
  adiastematic?: 'contour' | 'pitch';
  /**
   * How a flat, sharp or natural of the Monodi data is written. `accid` (default): an `<accid>` of the syllable at its place
   * between the neumes, with the pitch position in `@ploc` and `@oloc`; it adds no note to the melody. `note`: a note `<nc>`
   * with pitch, as earlier exports did (Monodi-Zero 0.9.1).
   */
  accidentals?: 'accid' | 'note';
  inlineInterventions?: boolean;       // encode interventions inline
  /** Pattern → MEI attribute rules ("transcription equivalents"), optionally per manuscript. */
  patternRules?: MeiPatternRule[];
  /** Rules that set MEI attributes by pattern, text, pitch, note type or flag (see MeiAnnotationRule). */
  annotationRules?: MeiAnnotationRule[];
  /** Id of the schema catalog that annotations are checked against (see mei/schema); default `mei-5.0-all`. */
  schemaId?: string;
  /** `strict`: an attribute that the schema does not allow on its element is an error; `warn` (default): a warning. */
  attributePolicy?: 'warn' | 'strict';
  /** Project-specific attributes that the schema does not contain, offered and accepted like schema attributes. */
  schemaExtensions?: { element: string; name: string; values?: string[]; doc?: string }[];
  /** Attributes shown first in the annotation dialog, written `element@name` (for example `nc@tilt`). */
  favoriteAttributes?: string[];
  entities: Record<MeiEntityKey, MeiEntityRule>;
}

export const ENTITY_FIELDS: Record<MeiEntityKey, { key: string; label: string; example: string }[]> = {
  formteil: [
    { key: 'signature', label: 'Signature', example: 'A' },
    { key: 'status', label: 'Status', example: 'Draft' },
    { key: 'uuid', label: 'UUID', example: 'formteil-123' }
  ],
  zeile: [
    { key: 'uuid', label: 'UUID', example: 'zeile-123' }
  ],
  paratext: [
    { key: 'text', label: 'Text', example: 'Rubric' },
    { key: 'paratextType', label: 'Paratext Type', example: 'Formteil' },
    { key: 'uuid', label: 'UUID', example: 'paratext-123' }
  ],
  syllable: [
    { key: 'text', label: 'Syllable Text', example: 'Glo' },
    { key: 'uuid', label: 'UUID', example: 'syllable-123' }
  ],
  syllableText: [
    { key: 'text', label: 'Text', example: 'Glo' },
    { key: 'uuid', label: 'UUID', example: 'syl-123' }
  ],
  neume: [
    { key: 'uuid', label: 'UUID', example: 'neume-123' }
  ],
  note: [
    { key: 'base', label: 'Pitch Name', example: 'g' },
    { key: 'octave', label: 'Octave', example: '4' },
    { key: 'connectionGap', label: 'Connection Gap Flag', example: 'true' },
    { key: 'flags', label: 'Note flags (keys, space-separated)', example: 'V' },
    { key: 'uuid', label: 'UUID', example: 'note-123' }
  ],
  clef: [
    { key: 'shape', label: 'Clef Shape', example: 'C' },
    { key: 'line', label: 'Clef Line', example: '1' },
    { key: 'uuid', label: 'UUID', example: 'clef-123' }
  ],
  // The ornament entities are emitted AS notes (the emitter routes a Note
  // instance to one of these rules based on its noteType), so they share the
  // note field vocabulary — pitch and octave must be bindable here too.
  oriscus: [
    { key: 'base', label: 'Pitch Name', example: 'g' },
    { key: 'octave', label: 'Octave', example: '4' },
    { key: 'connectionGap', label: 'Connection Gap Flag', example: 'true' },
    { key: 'flags', label: 'Note flags (keys, space-separated)', example: 'V' },
    { key: 'uuid', label: 'UUID', example: 'oriscus-123' }
  ],
  quilisma: [
    { key: 'base', label: 'Pitch Name', example: 'g' },
    { key: 'octave', label: 'Octave', example: '4' },
    { key: 'connectionGap', label: 'Connection Gap Flag', example: 'true' },
    { key: 'flags', label: 'Note flags (keys, space-separated)', example: 'V' },
    { key: 'uuid', label: 'UUID', example: 'quilisma-123' }
  ],
  strophicus: [
    { key: 'base', label: 'Pitch Name', example: 'g' },
    { key: 'octave', label: 'Octave', example: '4' },
    { key: 'connectionGap', label: 'Connection Gap Flag', example: 'true' },
    { key: 'flags', label: 'Note flags (keys, space-separated)', example: 'V' },
    { key: 'uuid', label: 'UUID', example: 'strophicus-123' }
  ],
  liquescent: [
    { key: 'base', label: 'Pitch Name', example: 'g' },
    { key: 'octave', label: 'Octave', example: '4' },
    { key: 'connectionGap', label: 'Connection Gap Flag', example: 'true' },
    { key: 'flags', label: 'Note flags (keys, space-separated)', example: 'V' },
    { key: 'uuid', label: 'UUID', example: 'liquescent-123' }
  ]
};

export const MEI_ELEMENT_SUGGESTIONS: string[] = [
  'music', 'body', 'mdiv', 'score', 'scoreDef', 'section', 'staff', 'layer',
  'sb', 'pb', 'syllable', 'syl', 'neume', 'nc', 'ncGrp', 'clef', 'dir',
  'annot', 'liquescent', 'oriscus', 'quilisma', 'strophicus', 'episema',
  'custos', 'divLine', 'accid'
];

/** Section attributes: the signature of the form part is its label (it may hold spaces, `@n` may not), the status its type. */
const FORMTEIL_ATTRIBUTES: MeiAttributeRule[] = [
  { name: 'label', source: 'field', value: 'signature', omitIfEmpty: true },
  { name: 'type', source: 'field', value: 'status', omitIfEmpty: true }
];
/** Paratext (text written in the manuscript next to the music): an `annot` of the section; `dir` is not allowed there. */
const PARATEXT_ATTRIBUTES: MeiAttributeRule[] = [
  { name: 'type', source: 'static', value: 'paratext' },
  { name: 'label', source: 'field', value: 'paratextType', omitIfEmpty: true }
];

function buildEntities(v1: any): Record<MeiEntityKey, MeiEntityRule> {
  const formteilTag = v1?.formteilContainer?.tag || 'section';
  const zeileTag = v1?.zeileContainer?.tag || 'sb';
  
  const syllableTag = v1?.syllable?.tag || 'syllable';
  const syllableTextTag = v1?.syllable?.textTag || 'syl';
  
  const neumeTag = v1?.neume?.tag || 'neume';
  
  const noteTag = v1?.note?.tag || 'nc';
  const notePitchAttr = v1?.note?.pitchAttr || 'pname';
  const noteOctaveAttr = v1?.note?.octaveAttr || 'oct';
  const noteLiquescentAttr = v1?.note?.liquescentAttr || 'curve';
  const noteLiquescentValue = v1?.note?.liquescentValue || 'c';
  const noteConnectionAttr = v1?.note?.connectionAttr || 'con';
  const noteConnectionGapValue = v1?.note?.connectionGapValue || 'g';
  
  const clefTag = v1?.clef?.tag || 'clef';
  const clefShapeAttr = v1?.clef?.shapeAttr || 'shape';
  const clefLineAttr = v1?.clef?.lineAttr || 'line';
  const clefDefaultLine = v1?.clef?.defaultLine || '1';
  
  // `dir` was the default of earlier versions; the schema does not allow it in a section, so it counts as "not set".
  const paratextTag = (v1?.paratextContainer?.tag && v1.paratextContainer.tag !== 'dir') ? v1.paratextContainer.tag : 'annot';
  const oriscusTag = v1?.oriscus?.tag || 'oriscus';
  const quilismaTag = v1?.quilisma?.tag || 'quilisma';
  const strophicusTag = v1?.strophicus?.tag || 'strophicus';
  const liquescentTag = v1?.liquescentElement?.tag || 'liquescent';

  return {
    formteil: {
      enabled: true,
      tag: formteilTag,
      wrappers: [],
      attributes: [...FORMTEIL_ATTRIBUTES.map(a => ({ ...a }))]
    },
    zeile: {
      enabled: true,
      tag: zeileTag,
      wrappers: ['staff', 'layer'],
      attributes: []
    },
    paratext: {
      enabled: true,
      tag: paratextTag,
      wrappers: [],
      attributes: PARATEXT_ATTRIBUTES.map(a => ({ ...a })),
      textFrom: 'text'
    },
    syllable: {
      enabled: true,
      tag: syllableTag,
      wrappers: [],
      attributes: []
    },
    syllableText: {
      enabled: true,
      tag: syllableTextTag,
      wrappers: [],
      attributes: [],
      textFrom: 'text'
    },
    neume: {
      enabled: true,
      tag: neumeTag,
      wrappers: [],
      attributes: []
    },
    note: {
      enabled: true,
      tag: noteTag,
      wrappers: [],
      attributes: [
        {
          name: notePitchAttr,
          source: 'field',
          value: 'base'
        },
        {
          name: noteOctaveAttr,
          source: 'field',
          value: 'octave'
        },
        {
          name: noteLiquescentAttr,
          source: 'static',
          value: noteLiquescentValue,
          omitIfEmpty: true
        },
        {
          name: noteConnectionAttr,
          source: 'static',
          value: noteConnectionGapValue,
          omitIfEmpty: true
        }
      ]
    },
    clef: {
      enabled: true,
      tag: clefTag,
      wrappers: [],
      attributes: [
        {
          name: clefShapeAttr,
          source: 'field',
          value: 'shape'
        },
        {
          name: clefLineAttr,
          // `1` was the fixed default of earlier versions; now the line is taken from the position of the clef.
          source: clefDefaultLine !== '1' ? 'static' : 'field',
          value: clefDefaultLine !== '1' ? clefDefaultLine : 'line'
        }
      ]
    },
    oriscus: {
      enabled: true,
      tag: oriscusTag,
      wrappers: [],
      attributes: [
        {
          name: notePitchAttr,
          source: 'field',
          value: 'base'
        },
        {
          name: noteOctaveAttr,
          source: 'field',
          value: 'octave'
        },
        {
          name: noteLiquescentAttr,
          source: 'static',
          value: noteLiquescentValue,
          omitIfEmpty: true
        },
        {
          name: noteConnectionAttr,
          source: 'static',
          value: noteConnectionGapValue,
          omitIfEmpty: true
        }
      ]
    },
    quilisma: {
      enabled: true,
      tag: quilismaTag,
      wrappers: [],
      attributes: [
        {
          name: notePitchAttr,
          source: 'field',
          value: 'base'
        },
        {
          name: noteOctaveAttr,
          source: 'field',
          value: 'octave'
        },
        {
          name: noteLiquescentAttr,
          source: 'static',
          value: noteLiquescentValue,
          omitIfEmpty: true
        },
        {
          name: noteConnectionAttr,
          source: 'static',
          value: noteConnectionGapValue,
          omitIfEmpty: true
        }
      ]
    },
    strophicus: {
      enabled: true,
      tag: strophicusTag,
      wrappers: [],
      attributes: [
        {
          name: notePitchAttr,
          source: 'field',
          value: 'base'
        },
        {
          name: noteOctaveAttr,
          source: 'field',
          value: 'octave'
        },
        {
          name: noteLiquescentAttr,
          source: 'static',
          value: noteLiquescentValue,
          omitIfEmpty: true
        },
        {
          name: noteConnectionAttr,
          source: 'static',
          value: noteConnectionGapValue,
          omitIfEmpty: true
        }
      ]
    },
    liquescent: {
      enabled: true,
      tag: liquescentTag,
      wrappers: [],
      attributes: [
        {
          name: notePitchAttr,
          source: 'field',
          value: 'base'
        },
        {
          name: noteOctaveAttr,
          source: 'field',
          value: 'octave'
        },
        {
          name: noteLiquescentAttr,
          source: 'static',
          value: noteLiquescentValue,
          omitIfEmpty: true
        },
        {
          name: noteConnectionAttr,
          source: 'static',
          value: noteConnectionGapValue,
          omitIfEmpty: true
        }
      ]
    }
  };
}

export function defaultMeiProfile(): MeiMappingProfileV2 {
  return {
    version: 2,
    id: 'default',
    name: 'Default MEI Profile',
    skeleton: ['music', 'body', 'mdiv', 'score'],
    emitHeader: true,
    inlineInterventions: false,
    entities: buildEntities(null)
  };
}

/**
 * Brings a stored profile to the defaults of state 2026-11-02 where it still holds the earlier defaults: the paratext
 * (it was off and named the element `dir`, which the schema does not allow in a section), the clef line (it was a fixed 1) and
 * the section attributes (there were none). A setting that a person changed is left as it is.
 */
export function upgradeMeiProfile(profile: MeiMappingProfileV2): MeiMappingProfileV2 {
  const e = profile.entities;
  if (!e) return profile;
  const p = e.paratext;
  if (p && !p.enabled && p.tag === 'dir' && p.attributes.length === 0) {
    e.paratext = { ...p, enabled: true, tag: 'annot', attributes: PARATEXT_ATTRIBUTES.map(a => ({ ...a })) };
  }
  const line = e.clef?.attributes.find(a => a.name === 'line');
  if (line && line.source === 'static' && line.value === '1') { line.source = 'field'; line.value = 'line'; }
  if (e.formteil && e.formteil.attributes.length === 0) e.formteil.attributes = FORMTEIL_ATTRIBUTES.map(a => ({ ...a }));
  return profile;
}

/** A named starting point for a profile (the editor offers them under *New profile from preset*). */
export interface MeiProfilePreset {
  id: string;
  name: string;
  description: string;
  build: () => MeiMappingProfileV2;
}

/** Settings shared by the presets of several voices as staves (state 2026-11-05): text in the last voice, `sameas`, bracket, no first `sb`, no word position. */
function staffPerVoice(profile: MeiMappingProfileV2): MeiMappingProfileV2 {
  profile.schemaConformant = true;
  profile.voices = true;
  profile.voiceText = 'last';
  profile.voiceLink = 'sameas';
  profile.voiceBracket = true;
  profile.voiceLabels = [];
  profile.firstLineBreak = false;
  profile.wordPosition = false;
  return profile;
}

export const MEI_PRESETS: MeiProfilePreset[] = [
  {
    id: 'neumes-staves',
    name: 'Neumes, one staff per voice',
    description: 'syllable / neume / nc. The text stands in the last voice, the other voices point to it with syl/@sameas; neumes that align are tied with @synch. Checked against the MEI 5.0 neumes schema.',
    build: () => {
      const p = staffPerVoice(defaultMeiProfile());
      p.name = 'Neumes, one staff per voice';
      p.presetId = 'neumes-staves';
      return p;
    }
  },
  {
    id: 'premensural-staves',
    name: 'Premensural, one staff per voice',
    description: 'ligature / note / verse instead of syllable / neume / nc, notationtype="premensural" (attributes such as lig="conjunctura" are set by hand on the notes). Not yet valid against the MEI Mensural schema.',
    build: () => {
      const p = staffPerVoice(defaultMeiProfile());
      p.name = 'Premensural, one staff per voice';
      p.presetId = 'premensural-staves';
      p.notation = 'premensural';
      p.entities.neume.tag = 'ligature';
      p.entities.note.tag = 'note';
      return p;
    }
  }
];

/**
 * The profiles of a project plus the built-in ones (`MEI_PRESETS`), so that they are there without being created first. A built-in
 * profile is a profile like any other (it can be edited and duplicated); it carries the id of its preset as `id` and `presetId`.
 * One that a person deleted (its preset id is in `removed`) is not added again. Returns a new list; the given profiles are kept.
 */
export function withBuiltInProfiles(profiles: MeiMappingProfileV2[], removed: string[] = []): MeiMappingProfileV2[] {
  const out = [...profiles];
  for (const preset of MEI_PRESETS) {
    if (removed.includes(preset.id) || out.some(p => p.presetId === preset.id || p.id === preset.id)) continue;
    const profile = preset.build();
    profile.id = preset.id;
    out.push(profile);
  }
  return out;
}

export function migrateV1MeiMappings(v1: any): MeiMappingProfileV2 {
  return {
    version: 2,
    id: 'migrated',
    name: 'Migrated Profile',
    skeleton: ['music', 'body', 'mdiv', 'score'],
    emitHeader: true,
    inlineInterventions: false,
    entities: buildEntities(v1)
  };
}
