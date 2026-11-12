import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import {
  BODY_STRUCTURE_PRESETS, ENTITY_FIELDS, MEI_ELEMENT_SUGGESTIONS, MEI_MENSURAL_SCHEMA_URL, MEI_NEUMES_SCHEMA_URL, STRUCTURE_FIELDS,
  applyBodyStructurePreset, bodyStructureIssues, bodyStructureOf, effectiveGroupMode, effectiveNeumeMode, effectiveSyllableMode,
  emitMei, findAttribute, matchingBodyStructurePreset
} from '@monodi/core/mei';
import type {
  BodyStructureIssue, BodyStructurePreset, MeiAttributeRule, MeiBodyStructure, MeiEntityKey, MeiLevelMode, MeiMappingProfileV2,
  MeiSchemaCatalog
} from '@monodi/core/mei';
import { BaseNote, DocumentType, LinePartKind, NoteType, SyllableType, emptyFormteilContainer, emptyRootContainer, emptyZeileContainer } from '../types/model';
import type { RootContainer } from '../types/model';
import { MeiSchemaRegistry } from './schema/mei-schema-registry.service';

/** A level of the transcription as the tab "Levels" shows it. */
interface LevelView {
  key: 'part' | 'line' | 'staff' | 'layer' | 'syllable' | 'neume' | 'group' | 'note' | 'accid';
  label: string;
  hint: string;
  /** Entity rule that holds the element name and attributes (the others are in `MeiBodyStructure`). */
  entity?: MeiEntityKey;
  /** The modes the level offers; none: always written. */
  modes?: MeiLevelMode[];
  depth: number;
}

const MODE_LABELS: Record<MeiLevelMode, string> = {
  always: 'written',
  several: 'only with several children',
  never: 'not written'
};

/**
 * Settings tab "Levels" of the MEI export profile: the structure of the body (`MeiBodyStructure`, structure.ts in `@monodi/core/mei`).
 * For each level of the transcription it shows the element written, whether it is written, its attributes, where the text stands and
 * how accidentals and stems are written, with a sketch of the written MEI and the warnings of `bodyStructureIssues` (invalid MEI, not
 * read back by the import). Nothing is refused: unknown element names are written as given.
 */
@Component({
  selector: 'app-mei-structure-panel',
  templateUrl: './mei-structure-panel.component.html',
  styleUrls: ['./mei-mapping-editor.component.css'],
  standalone: false
})
export class MeiStructurePanelComponent implements OnInit {
  @Input() profile!: MeiMappingProfileV2;
  @Output() changed = new EventEmitter<void>();

  readonly presets = BODY_STRUCTURE_PRESETS;
  readonly suggestions = MEI_ELEMENT_SUGGESTIONS;
  readonly modeLabels = MODE_LABELS;
  readonly schemaUrls = [
    { url: '', label: 'Default: MEI 5.0 neumes (development version without the schema-conformant structure)' },
    { url: MEI_NEUMES_SCHEMA_URL, label: 'MEI 5.0 neumes' },
    { url: MEI_MENSURAL_SCHEMA_URL, label: 'MEI 5.0 mensural' },
    { url: 'https://music-encoding.org/schema/5.0/mei-all.rng', label: 'MEI 5.0 all' },
    { url: 'https://music-encoding.org/schema/5.0/mei-CMN.rng', label: 'MEI 5.0 common music notation' }
  ];
  readonly textHolders: { value: MeiBodyStructure['text']['holder']; label: string }[] = [
    { value: 'syllable', label: 'the syllable' },
    { value: 'neume', label: 'the first neume of the syllable' },
    { value: 'note', label: 'the first note of the syllable' }
  ];

  private catalog?: MeiSchemaCatalog;

  constructor(private schemas: MeiSchemaRegistry) {}

  ngOnInit(): void {
    this.schemas.ready().then(() => { this.catalog = this.schemas.forProfile(this.profile.schemaId, this.profile.schemaExtensions); this.memo = undefined; }, () => {});
  }

  /** The structure of the profile, complete: a profile without one (or with an incomplete one, e.g. from a JSON file) gets the one it means. */
  get st(): MeiBodyStructure {
    const s = this.profile.structure;
    if (!s || !s.voice || !s.group || !s.text || !s.accid || !s.stem) {
      this.profile.structure = bodyStructureOf(this.profile);
      delete this.profile.notation;
    }
    return this.profile.structure!;
  }

  get conformant(): boolean { return this.profile.schemaConformant !== false; }

  /** Every change: the structure is data of the profile; the parent saves the settings. */
  emit(): void {
    delete this.profile.notation;
    this.memo = undefined;
    this.changed.emit();
  }

  // ---- built-in structures ---------------------------------------------------------------

  get matching(): BodyStructurePreset | null { return this.computed().matching; }

  applyPreset(id: BodyStructurePreset['id']): void {
    const preset = this.presets.find(p => p.id === id);
    if (!preset || this.matching?.id === id) return;
    if (!this.matching && !confirm(`Replace the levels of this profile with the built-in structure "${preset.name}"? The element names of syllable, text, neume and note are set too.`)) return;
    applyBodyStructurePreset(this.profile, id);
    this.emit();
  }

  // ---- levels ----------------------------------------------------------------------------

  /** The levels, outermost first, indented by the levels written around them. */
  get levels(): LevelView[] { return this.computed().levels; }

  private buildLevels(): LevelView[] {
    const syllableWritten = effectiveSyllableMode(this.profile, this.st) !== 'never';
    const neumeWritten = effectiveNeumeMode(this.profile, this.st) !== 'never';
    const groupWritten = effectiveGroupMode(this.st) !== 'never';
    const syllableDepth = 4;
    const neumeDepth = syllableDepth + (syllableWritten ? 1 : 0);
    const groupDepth = neumeDepth + (neumeWritten ? 1 : 0);
    const noteDepth = groupDepth + (groupWritten ? 1 : 0);
    return [
      { key: 'part', label: 'Part', hint: 'A form part of the chant (Formteil).', entity: 'formteil', depth: 0 },
      { key: 'line', label: 'Line', hint: 'A line of the transcription: the line break before the staves of the line.', entity: 'zeile', depth: 1 },
      { key: 'staff', label: 'Voice: staff', hint: 'One per voice of the line, numbered with @n (the first voice and the additional melodies).', depth: 2 },
      { key: 'layer', label: 'Voice: layer', hint: 'The one layer of each staff.', depth: 3 },
      { key: 'syllable', label: 'Syllable', hint: 'A syllable with its neumes. Not written: its neumes stand in the layer.', entity: 'syllable', modes: ['always', 'never'], depth: syllableDepth },
      { key: 'accid', label: 'Accidental', hint: 'A flat, natural or sharp: next to the neume it stands before or after, in the syllable (in the layer without one).', depth: neumeDepth },
      { key: 'neume', label: 'Neume', hint: 'Notes written without a space. "Only with several children": a neume of one note is that note (premensural).', entity: 'neume', modes: ['always', 'several', 'never'], depth: neumeDepth },
      { key: 'group', label: 'Group', hint: 'Notes written together as one ligature inside a neume ("[*u]" in the code of a neume); a break inside a neume ("*u") starts a new group and is also marked with con="g" on the note.', modes: ['never', 'always', 'several'], depth: groupDepth },
      { key: 'note', label: 'Note', hint: 'A note with pitch (pname, oct); ornaments are empty children of it.', entity: 'note', depth: noteDepth }
    ];
  }

  mode(lv: LevelView): MeiLevelMode {
    if (lv.key === 'syllable') return effectiveSyllableMode(this.profile, this.st);
    if (lv.key === 'neume') return effectiveNeumeMode(this.profile, this.st);
    if (lv.key === 'group') return this.st.group.mode;
    return 'always';
  }

  setMode(lv: LevelView, mode: MeiLevelMode): void {
    const s = this.st;
    if (lv.key === 'syllable') {
      s.syllable = mode === 'never' ? 'never' : 'always';
      if (mode !== 'never') this.profile.entities.syllable.enabled = true;
    } else if (lv.key === 'neume') {
      s.neume = mode;
      if (mode !== 'never') this.profile.entities.neume.enabled = true;
    } else if (lv.key === 'group') {
      s.group.mode = mode;
      if (mode !== 'never' && !s.group.element.trim()) s.group.element = this.profile.entities.neume.tag === 'ligature' ? 'ligature' : 'ncGrp';
    }
    this.emit();
  }

  written(lv: LevelView): boolean {
    if (lv.key === 'staff' || lv.key === 'layer') return this.conformant;
    if (lv.key === 'accid') return this.profile.accidentals !== 'note';
    if (lv.entity && !this.profile.entities[lv.entity].enabled) return false;
    return this.mode(lv) !== 'never';
  }

  elementOf(lv: LevelView): string {
    const s = this.st;
    if (lv.entity) return this.profile.entities[lv.entity].tag;
    if (lv.key === 'staff') return s.voice.staff;
    if (lv.key === 'layer') return s.voice.layer;
    if (lv.key === 'group') return s.group.element;
    return s.accid.element;
  }

  setElement(lv: LevelView, name: string): void {
    const s = this.st;
    const v = name.trim();
    if (lv.entity) this.profile.entities[lv.entity].tag = v;
    else if (lv.key === 'staff') s.voice.staff = v;
    else if (lv.key === 'layer') s.voice.layer = v;
    else if (lv.key === 'group') s.group.element = v;
    else s.accid.element = v;
    this.emit();
  }

  /** The attribute rules of a level, or null for a level without any (staff and layer: `@n` only). */
  attributesOf(lv: LevelView): MeiAttributeRule[] | null {
    if (lv.entity) return this.profile.entities[lv.entity].attributes;
    if (lv.key === 'group') return this.st.group.attributes;
    if (lv.key === 'accid') return this.st.accid.attributes;
    return null;
  }

  fieldsOf(lv: LevelView | 'text'): { key: string; label: string }[] {
    if (lv === 'text') return ENTITY_FIELDS.syllableText;
    if (lv.entity) return ENTITY_FIELDS[lv.entity];
    if (lv.key === 'group' || lv.key === 'accid') return STRUCTURE_FIELDS[lv.key];
    return [];
  }

  addAttribute(rules: MeiAttributeRule[]): void {
    rules.push({ name: '', source: 'static', value: '', omitIfEmpty: true });
    this.emit();
  }

  removeAttribute(rules: MeiAttributeRule[], i: number): void {
    rules.splice(i, 1);
    this.emit();
  }

  /** A short form of an attribute rule: `pname={base}`, `type="paratext"`. */
  attrSummary(a: MeiAttributeRule): string {
    return `${a.name || '?'}=${a.source === 'field' ? '{' + a.value + '}' : '"' + a.value + '"'}`;
  }

  /** Elements written around each instance of a level (entity rules only), outermost first. */
  wrappersOf(lv: LevelView): string[] | null {
    return lv.entity && ['syllable', 'neume', 'note'].includes(lv.entity) ? this.profile.entities[lv.entity].wrappers : null;
  }

  // ---- text ------------------------------------------------------------------------------

  get textRule() { return this.profile.entities.syllableText; }

  setTextHolder(holder: MeiBodyStructure['text']['holder']): void {
    this.st.text.holder = holder;
    this.emit();
  }

  /** Moves the text one level out (-1: towards the syllable) or in (+1: towards the note). */
  moveText(direction: -1 | 1): void {
    const order: MeiBodyStructure['text']['holder'][] = ['syllable', 'neume', 'note'];
    const i = order.indexOf(this.st.text.holder) + direction;
    if (i < 0 || i >= order.length) return;
    this.setTextHolder(order[i]);
  }

  /** The element that will hold the text, in words, for the line under the text settings. */
  get textHolderNote(): string {
    const s = this.st;
    const syl = this.textRule.tag || 'syl';
    const chain = [...s.text.wrappers, syl].map(n => `<${n}>`).join(' > ');
    if (s.text.holder === 'syllable' && effectiveSyllableMode(this.profile, s) === 'never') return `${chain}: not written, because the syllable is not written.`;
    const holder = s.text.holder === 'syllable' ? `<${this.profile.entities.syllable.tag}>`
      : s.text.holder === 'neume' ? 'the first element of the neume level' : `the first <${this.profile.entities.note.tag}>`;
    return `${chain} stands ${s.text.position === 'first' ? 'at the start' : 'at the end'} of ${holder}.`;
  }

  addWrapper(list: string[], value: string): void {
    const v = value.trim();
    if (!v) return;
    list.push(v);
    this.emit();
  }

  removeWrapper(list: string[], i: number): void {
    list.splice(i, 1);
    this.emit();
  }

  moveWrapper(list: string[], i: number, direction: -1 | 1): void {
    const j = i + direction;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    this.emit();
  }

  // ---- staff definition --------------------------------------------------------------------

  /** Values of `staffDef/@notationtype` in the schema of the profile. */
  get notationTypes(): string[] {
    return (this.catalog ? findAttribute(this.catalog, 'staffDef', 'notationtype')?.values ?? [] : []).map(v => v.value);
  }

  // ---- checks and sketch ---------------------------------------------------------------------

  get issues(): BodyStructureIssue[] { return this.computed().issues; }
  issuesOf(level: string): BodyStructureIssue[] { return this.issues.filter(i => i.level === level); }
  get issueCount(): { error: number; mei: number; import: number } {
    const c = { error: 0, mei: 0, import: 0 };
    for (const i of this.issues) c[i.kind]++;
    return c;
  }

  /** The written MEI of a small sample (one line, two syllables, a flat, a neume of three notes in two groups, a neume of one note). */
  get sketch(): string { return this.computed().sketch; }

  private memo?: { key: string; levels: LevelView[]; issues: BodyStructureIssue[]; sketch: string; matching: BodyStructurePreset | null };

  /** Levels, issues and sketch, computed once per state of the profile (change detection reads them many times). */
  private computed() {
    const key = JSON.stringify([this.st, this.profile.entities, this.profile.schemaConformant, this.profile.accidentals, this.profile.schemaId, !!this.catalog]);
    if (!this.memo || this.memo.key !== key) {
      this.memo = {
        key,
        levels: this.buildLevels(),
        issues: bodyStructureIssues(this.profile, this.catalog),
        sketch: this.makeSketch(),
        matching: matchingBodyStructurePreset(this.profile)
      };
    }
    return this.memo;
  }

  private makeSketch(): string {
    try {
      const xml = emitMei(sketchDocument(), { ...this.profile, emitHeader: false, annotationRules: [], patternRules: [] });
      const doc = new DOMParser().parseFromString(xml, 'application/xml');
      if (doc.getElementsByTagName('parsererror').length > 0) return '(the sample could not be written)';
      const s = this.st;
      const NS = 'http://www.music-encoding.org/ns/mei';
      const staff = (this.conformant ? doc.getElementsByTagNameNS(NS, s.voice.staff.trim() || 'staff')[0] : undefined) ?? doc.getElementsByTagNameNS(NS, 'section')[1] ?? doc.documentElement;
      return pretty(staff, '');
    } catch (e) {
      return `(the export fails: ${e instanceof Error ? e.message : String(e)})`;
    }
  }
}

/** Indented XML of an element, without the namespace declaration. */
function pretty(el: Element, indent: string): string {
  const attrs = Array.from(el.attributes).filter(a => a.name !== 'xmlns').map(a => ` ${a.name}="${a.value}"`).join('');
  const children = Array.from(el.children);
  if (children.length === 0) {
    const text = (el.textContent ?? '').trim();
    return text ? `${indent}<${el.localName}${attrs}>${text}</${el.localName}>` : `${indent}<${el.localName}${attrs}/>`;
  }
  return [`${indent}<${el.localName}${attrs}>`, ...children.map(c => pretty(c, indent + '  ')), `${indent}</${el.localName}>`].join('\n');
}

/** The sample of the sketch: syllable "Ky-" with a flat, a neume `*u` with a stem up (two groups) and a neume of one note; syllable "e". */
function sketchDocument(): RootContainer {
  const note = (uuid: string, base: BaseNote, octave: number, noteType = NoteType.Normal): any => ({ uuid, base, octave, noteType, liquescent: false, focus: false });
  const root = emptyRootContainer();
  root.uuid = 'sketch';
  const part = emptyFormteilContainer(DocumentType.Level1, []);
  part.uuid = 'part';
  part.data = [];
  const line = emptyZeileContainer(1);
  line.uuid = 'line';
  line.children = [
    { kind: LinePartKind.Syllable, uuid: 's1', text: 'Ky-', syllableType: SyllableType.Normal, notes: { spaced: [
      { nonSpaced: [{ grouped: [note('flat', BaseNote.B, 4, NoteType.Flat), note('n1', BaseNote.G, 4)] }, { grouped: [note('n2', BaseNote.A, 4, NoteType.Ascending), note('n3', BaseNote.B, 4)] }] },
      { nonSpaced: [{ grouped: [note('n4', BaseNote.A, 4)] }] }
    ] } },
    { kind: LinePartKind.Syllable, uuid: 's2', text: 'e', syllableType: SyllableType.Normal, notes: { spaced: [{ nonSpaced: [{ grouped: [note('n5', BaseNote.G, 4)] }] }] } }
  ] as any;
  part.children = [line];
  root.children = [part];
  return root;
}
