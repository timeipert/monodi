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

export interface MeiMappingProfileV2 {
  version: 2;
  id: string;
  name: string;
  skeleton: string[];                 // element chain inside <mei> around the content, e.g. ['music','body','mdiv','score']
  emitHeader: boolean;                // emit the meiHead block
  inlineInterventions?: boolean;       // encode interventions inline
  /** Pattern → MEI attribute rules ("transcription equivalents"), optionally per manuscript. */
  patternRules?: MeiPatternRule[];
  entities: Record<MeiEntityKey, MeiEntityRule>;
}

export const ENTITY_FIELDS: Record<MeiEntityKey, { key: string; label: string; example: string }[]> = {
  formteil: [
    { key: 'signature', label: 'Signature', example: 'A' },
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
  
  const paratextTag = v1?.paratextContainer?.tag || 'dir';
  const oriscusTag = v1?.oriscus?.tag || 'oriscus';
  const quilismaTag = v1?.quilisma?.tag || 'quilisma';
  const strophicusTag = v1?.strophicus?.tag || 'strophicus';
  const liquescentTag = v1?.liquescentElement?.tag || 'liquescent';

  return {
    formteil: {
      enabled: true,
      tag: formteilTag,
      wrappers: [],
      attributes: []
    },
    zeile: {
      enabled: true,
      tag: zeileTag,
      wrappers: ['staff', 'layer'],
      attributes: []
    },
    paratext: {
      enabled: false,
      tag: paratextTag,
      wrappers: [],
      attributes: [],
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
          source: 'static',
          value: clefDefaultLine
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
