/**
 * Structure of the MEI body: which MEI element each level of a Monodi transcription becomes, how the levels nest, where the text of
 * a syllable stands, and how an accidental and a note head with a stem are written. MEI is the Music Encoding Initiative's XML
 * standard for music. State 2026-11-05.
 *
 * Who it is for: the MEI export (`emitter.ts`), the MEI import of Monodi-Zero (`apps/monodi/src/app/mei/mei-import.ts`) and the
 * profile editor, which shows and edits it (Settings → MEI Mapping → Export format → Levels).
 *
 * The levels of a Monodi transcription, outermost first (names of the data model in brackets):
 *
 *   part (FormteilContainer) > line (ZeileContainer) > voice (the first melody or one of `additionalMelodies`) > syllable (Syllable)
 *   > neume (a spaced unit: notes written without a space) > group (a non-spaced group: notes written as one ligature) > note (Note)
 *
 * plus the text of a syllable, the accidentals (Monodi note types Flat, Natural, Sharp) and the stem of a note head (note types
 * Ascending, Descending). The order of the levels follows the data and cannot be turned around: a neume belongs to one syllable, a
 * note to one group. What can be chosen is the element of each level, whether a level is written at all, the elements around the
 * text and on which level the text stands.
 *
 * Where the settings live: element names and attributes of part, line, syllable, text, neume and note are the entity rules of the
 * profile (`MeiMappingProfileV2.entities`, edited on the Elements tab as well); everything else is `MeiBodyStructure` below
 * (`MeiMappingProfileV2.structure`). A profile stored before 2026-11-05 has no `structure`; it had the fixed switch `notation`
 * (`neume` or `premensural`), and `bodyStructureOf` reads it as the matching built-in structure, so its export stays the same.
 *
 * The two built-in structures (`BODY_STRUCTURE_PRESETS`): `neume` (MEI neume notation: `syllable` > `syl` + `neume` > `nc`) and
 * `premensural` (no syllable element; a neume of several notes is a `ligature` of `note`s, a neume of one note is that `note`, the text
 * is a `verse/syl` in the first of them). `bodyStructureIssues` lists what makes a structure invalid MEI or unreadable for the import;
 * the export writes it anyway, unknown element names included.
 */
import type { MeiAttributeRule, MeiMappingProfileV2 } from './mapping.model';
import type { MeiSchemaCatalog } from './schema-catalog';

/**
 * Whether the element of a level is written. `always`: for every instance. `several`: only when it would hold more than one element;
 * otherwise its one child stands in its place (premensural: a neume of one note is that note). `never`: not written; its children
 * stand in the element of the level above.
 */
export type MeiLevelMode = 'always' | 'several' | 'never';

/** Where the text of a syllable stands. */
export interface MeiTextPlacement {
  /**
   * The element that holds the text element (`entities.syllableText`, `syl` by default): `syllable` the element of the syllable,
   * `neume` the first element of the neume level of the syllable (after `several` has replaced a neume of one note by its note), `note`
   * the first note of the syllable. When that element is not written, the text is not written either; a syllable without notes has no
   * neume and no note, so its text is written only with the holder `syllable`.
   */
  holder: 'syllable' | 'neume' | 'note';
  /** `first`: before the music of the holder (after a `<gap>` of the syllable type); `last`: after it. */
  position: 'first' | 'last';
  /** Elements around the text element, outermost first, made anew for every syllable (premensural: `['verse']`). */
  wrappers: string[];
}

/** How a note head with a stem (Monodi note types Ascending, Descending) is written. Only with the schema-conformant structure. */
export interface MeiStemForm {
  /** `attribute`: an attribute of the note (`nc/@tilt`); `element`: a child element of the note (`note/plica/@dir`); `none`: not written. */
  form: 'attribute' | 'element' | 'none';
  /** Name of the child element (form `element`), for example `plica`. */
  element: string;
  /** Name of the attribute: on the note (form `attribute`) or on the child element (form `element`). */
  attribute: string;
  /** Value for a stem up (Ascending) and down (Descending). */
  up: string;
  down: string;
}

export interface MeiBodyStructure {
  /** Value of `staffDef/@notationtype`; empty: not written. Only with the schema-conformant structure, which writes the `staffDef`. */
  notationType: string;
  /**
   * Schema named in the two `<?xml-model?>` lines at the top of the file. Empty: the MEI 5.0 neume customization with the
   * schema-conformant structure, its development version without it (as before 2026-11-05).
   */
  schemaUrl: string;
  /** Elements of a voice: one staff per voice (the line's first voice included), each holding one layer. */
  voice: { staff: string; layer: string };
  /** The syllable element (`entities.syllable`): written or not. `entities.syllable.enabled = false` means `never` too. */
  syllable: 'always' | 'never';
  /** The neume element (`entities.neume`). `entities.neume.enabled = false` means `never` too. */
  neume: MeiLevelMode;
  /** A group of notes written together (Monodi: one `grouped` list). Not written by the built-in structures. */
  group: { element: string; mode: MeiLevelMode; attributes: MeiAttributeRule[] };
  text: MeiTextPlacement;
  /** A flat, natural or sharp: one element next to the neume it stands before or after, in the syllable (in the layer without one). */
  accid: { element: string; attributes: MeiAttributeRule[] };
  stem: MeiStemForm;
}

/** Data fields that the attributes of the group and accidental levels can be bound to (like `ENTITY_FIELDS` for the entities). */
export const STRUCTURE_FIELDS: Record<'group' | 'accid', { key: string; label: string; example: string }[]> = {
  group: [
    { key: 'index', label: 'Number of the group in its neume (1-based)', example: '2' },
    { key: 'uuid', label: 'UUID of its first note', example: 'note-123' }
  ],
  accid: [
    { key: 'accid', label: 'Accidental (f flat, n natural, s sharp)', example: 'f' },
    { key: 'base', label: 'Pitch name it is written at', example: 'b' },
    { key: 'octave', label: 'Octave it is written at', example: '4' },
    { key: 'uuid', label: 'UUID', example: 'note-123' }
  ]
};

const ACCID_ATTRIBUTES: MeiAttributeRule[] = [
  { name: 'accid', source: 'field', value: 'accid' },
  { name: 'ploc', source: 'field', value: 'base', omitIfEmpty: true },
  { name: 'oloc', source: 'field', value: 'octave', omitIfEmpty: true }
];

export const MEI_NEUMES_SCHEMA_URL = 'https://music-encoding.org/schema/5.0/mei-Neumes.rng';
export const MEI_MENSURAL_SCHEMA_URL = 'https://music-encoding.org/schema/5.0/mei-Mensural.rng';

/** MEI neume notation: `syllable` > `syl` + `neume` > `nc`, stems as `nc/@tilt`. The default. */
export function neumeBodyStructure(): MeiBodyStructure {
  return {
    notationType: 'neume',
    schemaUrl: '',
    voice: { staff: 'staff', layer: 'layer' },
    syllable: 'always',
    neume: 'always',
    group: { element: '', mode: 'never', attributes: [] },
    text: { holder: 'syllable', position: 'first', wrappers: [] },
    accid: { element: 'accid', attributes: ACCID_ATTRIBUTES.map(a => ({ ...a })) },
    stem: { form: 'attribute', element: '', attribute: 'tilt', up: 'n', down: 's' }
  };
}

/**
 * Premensural notation as the trial files of 2026-11-05 write it: no syllable element; a neume of several notes is a `ligature` of
 * `note`s, a neume of one note is that `note`; the text is `verse/syl` in the first of them; a stem is `note/plica/@dir`. Not yet
 * valid against the MEI Mensural schema (state 2026-11-05: `premensural` is not a value of `@notationtype`, ornaments such as
 * `oriscus` are not allowed in a `note`).
 */
export function premensuralBodyStructure(): MeiBodyStructure {
  return {
    ...neumeBodyStructure(),
    notationType: 'premensural',
    schemaUrl: MEI_MENSURAL_SCHEMA_URL,
    syllable: 'never',
    neume: 'several',
    text: { holder: 'neume', position: 'first', wrappers: ['verse'] },
    stem: { form: 'element', element: 'plica', attribute: 'dir', up: 'up', down: 'down' }
  };
}

/** Element names of the entity rules that a built-in structure sets as well (the structure itself holds no names of entities). */
export interface BodyStructurePreset {
  id: 'neume' | 'premensural';
  name: string;
  description: string;
  build: () => MeiBodyStructure;
  /** `entities.<key>.tag` that the structure expects. */
  tags: { syllable: string; syllableText: string; neume: string; note: string };
}

export const BODY_STRUCTURE_PRESETS: BodyStructurePreset[] = [
  {
    id: 'neume', name: 'Neumes', build: neumeBodyStructure,
    description: 'MEI neume notation: syllable > syl + neume > nc; a stem is nc/@tilt.',
    tags: { syllable: 'syllable', syllableText: 'syl', neume: 'neume', note: 'nc' }
  },
  {
    id: 'premensural', name: 'Premensural', build: premensuralBodyStructure,
    description: 'No syllable element; a neume of several notes is a ligature of notes, a neume of one note is that note; the text is verse/syl in the first of them; a stem is note/plica/@dir.',
    tags: { syllable: 'syllable', syllableText: 'syl', neume: 'ligature', note: 'note' }
  }
];

/**
 * The structure of a profile, complete: a stored structure with missing parts filled from the neume structure, or, for a profile
 * stored before 2026-11-05 without one, the built-in structure its field `notation` named.
 */
export function bodyStructureOf(profile: Pick<MeiMappingProfileV2, 'structure' | 'notation'>): MeiBodyStructure {
  const base = neumeBodyStructure();
  const s = profile.structure;
  if (!s) return profile.notation === 'premensural' ? premensuralBodyStructure() : base;
  return {
    notationType: s.notationType ?? base.notationType,
    schemaUrl: s.schemaUrl ?? base.schemaUrl,
    voice: { ...base.voice, ...s.voice },
    syllable: s.syllable ?? base.syllable,
    neume: s.neume ?? base.neume,
    group: { ...base.group, ...s.group, attributes: s.group?.attributes ?? base.group.attributes },
    text: { ...base.text, ...s.text, wrappers: s.text?.wrappers ?? base.text.wrappers },
    accid: { ...base.accid, ...s.accid, attributes: s.accid?.attributes ?? base.accid.attributes },
    stem: { ...base.stem, ...s.stem }
  };
}

/** Sets a built-in structure on a profile: the structure and the element names of syllable, text, neume and note, all switched on. */
export function applyBodyStructurePreset(profile: MeiMappingProfileV2, id: BodyStructurePreset['id']): MeiMappingProfileV2 {
  const preset = BODY_STRUCTURE_PRESETS.find(p => p.id === id);
  if (!preset) return profile;
  profile.structure = preset.build();
  delete profile.notation;
  for (const key of ['syllable', 'syllableText', 'neume', 'note'] as const) {
    profile.entities[key].tag = preset.tags[key];
    profile.entities[key].enabled = true;
  }
  return profile;
}

function stable(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  const obj = value as Record<string, unknown>;
  return '{' + Object.keys(obj).sort().filter(k => obj[k] !== undefined).map(k => JSON.stringify(k) + ':' + stable(obj[k])).join(',') + '}';
}

/**
 * A structure without the settings that write nothing: the name and attributes of a group level that is not written, and the element
 * of a stem that is not written as an element (the editor keeps them, so that switching a level off and on again keeps its name).
 */
function effectiveStructure(s: MeiBodyStructure): MeiBodyStructure {
  const out: MeiBodyStructure = JSON.parse(JSON.stringify(s));
  if (effectiveGroupMode(out) === 'never') out.group = { element: '', mode: 'never', attributes: [] };
  if (out.stem.form !== 'element') out.stem.element = '';
  return out;
}

/** The built-in structure that a profile writes exactly (structure and element names), or null for a structure of its own. */
export function matchingBodyStructurePreset(profile: MeiMappingProfileV2): BodyStructurePreset | null {
  const own = stable(effectiveStructure(bodyStructureOf(profile)));
  return BODY_STRUCTURE_PRESETS.find(p =>
    stable(effectiveStructure(p.build())) === own &&
    (['syllable', 'syllableText', 'neume', 'note'] as const).every(k => profile.entities[k].tag === p.tags[k] && profile.entities[k].enabled)
  ) ?? null;
}

/** Whether a level is written, with the switch of its entity rule taken into account. */
export function effectiveSyllableMode(profile: MeiMappingProfileV2, s: MeiBodyStructure = bodyStructureOf(profile)): 'always' | 'never' {
  return profile.entities.syllable.enabled && s.syllable !== 'never' ? 'always' : 'never';
}
export function effectiveNeumeMode(profile: MeiMappingProfileV2, s: MeiBodyStructure = bodyStructureOf(profile)): MeiLevelMode {
  return profile.entities.neume.enabled ? s.neume : 'never';
}
export function effectiveGroupMode(s: MeiBodyStructure): MeiLevelMode {
  return s.group.element.trim() ? s.group.mode : 'never';
}

/** A problem of a structure. `error`: the export fails. `mei`: the file is not valid MEI. `import`: the import does not read it back. */
export interface BodyStructureIssue {
  kind: 'error' | 'mei' | 'import';
  /**
   * Level of the structure the issue is about: `staff`, `layer`, `syllable`, `neume`, `group`, `note`, `text`, `accid`, `stem`, or
   * `staffDef` (the value of `staffDef/@notationtype`).
   */
  level: string;
  message: string;
}

/** An XML name without a namespace prefix (what `createElementNS` accepts in the MEI namespace without a declared prefix). */
const XML_NAME = /^[A-Za-z_][A-Za-z0-9_.-]*$/;

/**
 * What makes the structure of a profile invalid MEI or unreadable for the import (state 2026-11-05). A structure of its own is read
 * back only when its profile is chosen as the format of the import (detection knows the two built-in structures); that is not listed
 * here. The export writes the structure
 * anyway; only a name that is not an XML name stops it. With `catalog` (a schema catalog, see schema-catalog.ts) element names and
 * the nesting are checked against the schema: every element of the chain from the layer to the note and the text must be allowed as
 * a child of the element around it, and `@notationtype` must be one of the values of the schema. Only the schema-conformant structure
 * is checked for the nesting of staff and layer, stem and ornaments (the earlier structure is not valid MEI anyway).
 */
export function bodyStructureIssues(profile: MeiMappingProfileV2, catalog?: MeiSchemaCatalog): BodyStructureIssue[] {
  const s = bodyStructureOf(profile);
  const e = profile.entities;
  const out: BodyStructureIssue[] = [];
  const syllableMode = effectiveSyllableMode(profile, s);
  const neumeMode = effectiveNeumeMode(profile, s);
  const groupMode = effectiveGroupMode(s);
  const conformant = profile.schemaConformant !== false;

  // 1. Names that the export cannot write
  const names: { level: string; name: string; used: boolean }[] = [
    { level: 'staff', name: s.voice.staff, used: conformant },
    { level: 'layer', name: s.voice.layer, used: conformant },
    { level: 'syllable', name: e.syllable.tag, used: syllableMode !== 'never' },
    { level: 'neume', name: e.neume.tag, used: neumeMode !== 'never' },
    { level: 'group', name: s.group.element, used: groupMode !== 'never' },
    { level: 'note', name: e.note.tag, used: e.note.enabled },
    { level: 'text', name: e.syllableText.tag, used: e.syllableText.enabled },
    ...s.text.wrappers.map(w => ({ level: 'text', name: w, used: e.syllableText.enabled })),
    { level: 'accid', name: s.accid.element, used: profile.accidentals !== 'note' },
    { level: 'stem', name: s.stem.element, used: conformant && s.stem.form === 'element' }
  ];
  for (const n of names.filter(x => x.used)) {
    if (!XML_NAME.test(n.name.trim())) {
      out.push({ kind: 'error', level: n.level, message: n.name.trim() ? `"${n.name}" is not an XML element name (letters, digits, "_", "-", "."; no space, no colon): the export fails.` : 'The element name is empty: the export fails.' });
    }
  }
  if (s.group.mode !== 'never' && !s.group.element.trim()) {
    out.push({ kind: 'mei', level: 'group', message: 'The group level is switched on but has no element name; it is not written.' });
  }

  // 2. Valid MEI: element names and nesting in the schema
  if (catalog) {
    const known = (name: string) => !!catalog.elements[name];
    const allows = (parent: string, child: string) => !known(parent) || !known(child) || catalog.elements[parent].children.includes(child);
    for (const n of names.filter(x => x.used && x.name.trim() && XML_NAME.test(x.name.trim()))) {
      if (!known(n.name)) out.push({ kind: 'mei', level: n.level, message: `<${n.name}> is not an element of the schema "${catalog.label}"; it is written as given.` });
    }
    const check = (level: string, parent: string, child: string, why = '') => {
      if (parent && child && !allows(parent, child)) out.push({ kind: 'mei', level, message: `The schema "${catalog.label}" does not allow <${child}> in <${parent}>${why}.` });
    };
    const layer = conformant ? s.voice.layer : 'layer';
    if (conformant) {
      check('staff', 'section', s.voice.staff);
      check('layer', s.voice.staff, s.voice.layer);
    }
    // The chain from the layer to the note, level by level, with the wrappers of the entity rules. A level written only with several
    // children puts its single child into its own parent: both places are checked.
    let parents = [layer];
    const descend = (level: string, element: string, wrappers: string[], mode: MeiLevelMode): void => {
      if (mode === 'never') return;
      for (const p of parents) {
        let q = p;
        for (const w of wrappers) { check(level, q, w); q = w; }
        check(level, q, element);
      }
      parents = mode === 'several' ? [...parents, element] : [element];
    };
    descend('syllable', e.syllable.tag, e.syllable.wrappers, syllableMode);
    const syllableParent = syllableMode === 'never' ? layer : e.syllable.tag;
    descend('neume', e.neume.tag, e.neume.wrappers, neumeMode);
    descend('group', s.group.element.trim(), [], groupMode);
    for (const p of parents) {
      let q = p;
      for (const w of e.note.wrappers) { check('note', q, w); q = w; }
      check('note', q, e.note.tag);
    }
    // The text: in its holder, inside its wrappers.
    if (e.syllableText.enabled) {
      const holders = s.text.holder === 'syllable' ? (syllableMode === 'never' ? [] : [e.syllable.tag])
        : s.text.holder === 'neume' ? (neumeMode === 'never' ? (groupMode === 'never' ? [e.note.tag] : [s.group.element]) : neumeMode === 'several' ? [e.neume.tag, groupMode === 'never' ? e.note.tag : s.group.element] : [e.neume.tag])
        : [e.note.tag];
      for (const h of holders) {
        let q = h;
        for (const w of s.text.wrappers) { check('text', q, w); q = w; }
        check('text', q, e.syllableText.tag);
      }
    }
    if (profile.accidentals !== 'note') check('accid', syllableParent, s.accid.element);
    if (conformant && s.stem.form === 'element') check('stem', e.note.tag, s.stem.element);
    if (conformant) {
      for (const k of ['oriscus', 'quilisma', 'strophicus', 'liquescent'] as const) {
        if (e[k].enabled) check('note', e.note.tag, e[k].tag, ' (ornaments are written inside the note)');
      }
      const notationTypes = catalog.elements['staffDef'] && Object.values(catalog.attrDefs).length
        ? (catalog.elements['staffDef'].attrs.map(k => catalog.attrDefs[k]).find(d => d?.name === 'notationtype')?.values ?? []).map(v => v.value)
        : [];
      if (s.notationType && notationTypes.length > 0 && !notationTypes.includes(s.notationType)) {
        out.push({ kind: 'mei', level: 'staffDef', message: `"${s.notationType}" is not a value of staffDef/@notationtype in the schema "${catalog.label}" (allowed: ${notationTypes.join(', ')}).` });
      }
    }
  }

  // 3. What the import cannot read back
  if (syllableMode === 'never' && s.text.holder === 'syllable') {
    out.push({ kind: 'import', level: 'text', message: 'The syllable is not written and the text stands in it, so no text is written and the import cannot tell the syllables apart: it reads each line as one syllable. Put the text in the first neume or the first note.' });
  }
  if (syllableMode === 'never') {
    out.push({ kind: 'import', level: 'syllable', message: 'Without a syllable element, a syllable without notes (and an ellipsis without notes) has no element to stand in: it is not written, and the import cannot restore it. The type of a syllable (ellipses) is not written either.' });
  }
  if (neumeMode === 'never') {
    out.push({ kind: 'import', level: 'neume', message: groupMode === 'never'
      ? 'Without a neume element the import reads all notes of a syllable as one neume: the boundaries between neumes are lost; a break inside a neume (con="g") is kept as a group.'
      : 'Without a neume element the import reads all groups and notes of a syllable as one neume: the groups are kept, the boundaries between neumes are lost.' });
  }
  for (const [level, key, written] of [['syllable', 'syllable', syllableMode !== 'never'], ['neume', 'neume', neumeMode !== 'never'], ['note', 'note', true]] as const) {
    if (written && e[key].wrappers.some(w => w.trim())) {
      out.push({ kind: 'import', level, message: `The import does not look inside the elements around each ${level} (${e[key].wrappers.map(w => `<${w}>`).join(' > ')}); what stands in them is skipped.` });
    }
  }
  const levelNames: { level: string; name: string }[] = [
    { level: 'syllable', name: syllableMode === 'never' ? '' : e.syllable.tag },
    { level: 'neume', name: neumeMode === 'never' ? '' : e.neume.tag },
    { level: 'group', name: groupMode === 'never' ? '' : s.group.element.trim() },
    { level: 'note', name: e.note.tag },
    { level: 'text', name: e.syllableText.tag },
    ...s.text.wrappers.map(w => ({ level: 'text', name: w })),
    { level: 'accid', name: profile.accidentals === 'note' ? '' : s.accid.element },
    { level: 'stem', name: conformant && s.stem.form === 'element' ? s.stem.element : '' }
  ].filter(n => n.name);
  const seen = new Map<string, string>();
  for (const n of levelNames) {
    const other = seen.get(n.name);
    if (other && other !== n.level) out.push({ kind: 'import', level: n.level, message: `<${n.name}> stands for two levels (${other} and ${n.level}); the import cannot tell them apart.` });
    else seen.set(n.name, n.level);
  }
  if (conformant && s.stem.form === 'none') {
    out.push({ kind: 'import', level: 'stem', message: 'Note heads with a stem are written as plain notes; the import reads them as normal notes.' });
  }
  if (conformant && s.stem.form !== 'none' && (!s.stem.attribute.trim() || !s.stem.up.trim() || !s.stem.down.trim() || s.stem.up === s.stem.down)) {
    out.push({ kind: 'import', level: 'stem', message: 'A stem needs an attribute name and two different values for up and down; otherwise the import cannot tell the directions apart.' });
  }
  return out;
}
