import { Component, EventEmitter, Input, OnChanges, OnInit, Output } from '@angular/core';
import * as VM from '../types/model';
import { AnnotationTarget, MeiAnnotationRule, MeiMappingProfileV2, conditionProblem, previewRule, ruleProblem, AttrIssue, MeiAttrDef, MeiSchemaCatalog, attributesOf, checkAttribute } from '@monodi/core/mei';
import { newAnnotationRule } from './mei-annotation-rules';
import { targetElements } from './mei-annotation-check';
import { MeiSchemaRegistry } from './schema/mei-schema-registry.service';
import { getNoteFlagDefs } from '@monodi/core/document';

export const NOTE_TYPES = ['Normal', 'Oriscus', 'Quilisma', 'Strophicus', 'Liquescent', 'Ascending', 'Descending', 'Flat', 'Natural', 'Sharp'];

/**
 * Editor for the annotation rules of a MEI profile: "where these conditions hold, set these attributes".
 * Lives in the MEI settings tab "Rules". Each rule shows how many places it matches in the preview
 * document, so a rule can be checked before an export.
 */
@Component({
  selector: 'app-mei-rules-panel',
  templateUrl: './mei-rules-panel.component.html',
  standalone: false
})
export class MeiRulesPanelComponent implements OnInit, OnChanges {
  @Input() profile!: MeiMappingProfileV2;
  /** Document that the match counts are computed on (the editor's preview document). */
  @Input() previewRoot!: VM.RootContainer;
  @Output() changed = new EventEmitter<void>();

  selectedId: string | null = null;
  readonly noteTypes = NOTE_TYPES;
  readonly flags = getNoteFlagDefs();
  catalog?: MeiSchemaCatalog;
  private previewCache = new Map<string, { count: number; samples: string[] }>();
  private suggestionCache = new Map<AnnotationTarget, MeiAttrDef[]>();

  constructor(private registry: MeiSchemaRegistry) {}

  async ngOnInit(): Promise<void> {
    try { await this.registry.ready(); } catch { /* attributes are then not suggested or checked */ }
    this.loadCatalog();
  }

  ngOnChanges(): void {
    this.previewCache.clear();
    this.loadCatalog();
    if (!this.selectedId && this.rules.length > 0) this.selectedId = this.rules[0].id;
  }

  private loadCatalog(): void {
    this.catalog = this.profile ? this.registry.forProfile(this.profile.schemaId, this.profile.schemaExtensions) : undefined;
    this.suggestionCache.clear();
  }

  get rules(): MeiAnnotationRule[] {
    return this.profile.annotationRules ?? (this.profile.annotationRules = []);
  }

  get selected(): MeiAnnotationRule | undefined {
    return this.rules.find(r => r.id === this.selectedId);
  }

  select(id: string): void { this.selectedId = id; }

  add(): void {
    const r = newAnnotationRule();
    this.rules.push(r);
    this.selectedId = r.id;
    this.touch();
  }

  duplicate(r: MeiAnnotationRule): void {
    const copy: MeiAnnotationRule = { ...JSON.parse(JSON.stringify(r)), id: newAnnotationRule().id, name: r.name + ' (copy)' };
    this.rules.splice(this.rules.indexOf(r) + 1, 0, copy);
    this.selectedId = copy.id;
    this.touch();
  }

  remove(r: MeiAnnotationRule): void {
    const i = this.rules.indexOf(r);
    this.rules.splice(i, 1);
    this.selectedId = this.rules[Math.min(i, this.rules.length - 1)]?.id ?? null;
    this.touch();
  }

  move(r: MeiAnnotationRule, delta: number): void {
    const i = this.rules.indexOf(r);
    const j = i + delta;
    if (j < 0 || j >= this.rules.length) return;
    this.rules.splice(i, 1);
    this.rules.splice(j, 0, r);
    this.touch();
  }

  touch(): void {
    this.previewCache.clear();
    this.changed.emit();
  }

  // ---- conditions -------------------------------------------------------------------------

  /** The less common conditions are folded away unless one of them is set. */
  moreConditionsSet(r: MeiAnnotationRule): boolean {
    const m = r.match;
    return !!(m.position || m.noteTypes?.length || m.liquescent !== undefined || m.flag || r.sigle);
  }

  get neumeText(): string { return this.selected?.match.neume?.text ?? ''; }
  set neumeText(v: string) {
    const r = this.selected!;
    if (v.trim()) r.match.neume = { text: v, mode: r.match.neume?.mode ?? 'whole', ignoreShapes: r.match.neume?.ignoreShapes ?? true };
    else delete r.match.neume;
    this.touch();
  }

  get neumeMode(): string { return this.selected?.match.neume?.mode ?? 'whole'; }
  set neumeMode(v: string) {
    const n = this.selected?.match.neume;
    if (n) { n.mode = v === 'contains' ? 'contains' : 'whole'; this.touch(); }
  }

  set ignoreShapes(v: boolean) {
    const n = this.selected?.match.neume;
    if (n) { n.ignoreShapes = !!v; this.touch(); }
  }

  set nth(v: number) {
    const p = this.selected?.match.position;
    if (p) { p.nth = Math.max(1, Math.floor(Number(v) || 1)); this.touch(); }
  }

  get position(): string { return this.selected?.match.position?.which ?? 'all'; }
  set position(v: string) {
    const r = this.selected!;
    if (v === 'all') delete r.match.position; else r.match.position = { which: v as 'first' | 'last' | 'nth', ...(v === 'nth' ? { nth: r.match.position?.nth ?? 2 } : {}) };
    this.touch();
  }

  setText(key: 'syllableText' | 'pitch' | 'flag' | 'sigle', value: string): void {
    const r = this.selected!;
    if (key === 'sigle') { if (value.trim()) r.sigle = value.trim(); else delete r.sigle; }
    else if (value.trim()) r.match[key] = value; else delete r.match[key];
    this.touch();
  }

  hasType(t: string): boolean { return !!this.selected?.match.noteTypes?.includes(t); }
  toggleType(t: string): void {
    const m = this.selected!.match;
    const list = new Set(m.noteTypes ?? []);
    if (list.has(t)) list.delete(t); else list.add(t);
    if (list.size > 0) m.noteTypes = [...list]; else delete m.noteTypes;
    this.touch();
  }

  get liquescent(): string { const v = this.selected?.match.liquescent; return v === undefined ? 'any' : v ? 'yes' : 'no'; }
  set liquescent(v: string) {
    if (v === 'any') delete this.selected!.match.liquescent; else this.selected!.match.liquescent = v === 'yes';
    this.touch();
  }

  // ---- attributes to set ------------------------------------------------------------------

  get setNames(): string[] { return Object.keys(this.selected?.set ?? {}); }

  get setRows(): { name: string; value: string }[] {
    return Object.entries(this.selected?.set ?? {}).map(([name, value]) => ({ name, value }));
  }

  /** Rows are keyed by name; renaming rebuilds the map in the same order. */
  renameAttr(oldName: string, newName: string): void {
    const set = this.selected!.set;
    const n = newName.trim();
    if (!n || n === oldName || n in set) return;
    const next: Record<string, string> = {};
    for (const [k, v] of Object.entries(set)) next[k === oldName ? n : k] = v;
    this.selected!.set = next;
    this.touch();
  }

  setAttrValue(name: string, value: string): void {
    this.selected!.set[name] = value;
    this.touch();
  }

  addAttr(name: string): void {
    const n = name.trim();
    if (!n || n in this.selected!.set) return;
    this.selected!.set[n] = '';
    this.touch();
  }

  removeAttr(name: string): void {
    delete this.selected!.set[name];
    this.touch();
  }

  suggestions(): MeiAttrDef[] {
    const r = this.selected;
    if (!r || !this.catalog) return [];
    let list = this.suggestionCache.get(r.target);
    if (!list) { list = attributesOf(this.catalog, targetElements(this.profile)[r.target]); this.suggestionCache.set(r.target, list); }
    return list;
  }

  valueOptions(name: string): string[] {
    return this.suggestions().find(a => a.name === name)?.values?.map(v => v.value) ?? [];
  }

  issue(name: string, value: string): AttrIssue | null {
    const r = this.selected!;
    return checkAttribute(this.catalog, targetElements(this.profile)[r.target], name, value.includes('{') ? null : value, this.profile.attributePolicy ?? 'warn');
  }

  get elementDoc(): string { return this.catalog?.elements[this.element]?.doc ?? ''; }
  get elementChildren(): string[] { return this.catalog?.elements[this.element]?.children ?? []; }

  get element(): string { return this.selected ? targetElements(this.profile)[this.selected.target] : ''; }

  problem(r: MeiAnnotationRule): string | null { return ruleProblem(r); }
  conditionProblem(r: MeiAnnotationRule): string | null { return conditionProblem(r); }

  preview(r: MeiAnnotationRule): { count: number; samples: string[] } {
    let p = this.previewCache.get(r.id);
    if (!p) { p = previewRule(this.previewRoot, r); this.previewCache.set(r.id, p); }
    return p;
  }
}
