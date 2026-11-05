import { Component, Input, OnInit } from '@angular/core';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { AnnotationTarget, AttrIssue, MeiAttrDef, MeiSchemaCatalog, attributesOf, checkAttribute, findAttribute, isValidAttributeName } from '@monodi/core/mei';
import { getActiveMeiProfile } from './mei-annotation-context';
import { targetElements } from './mei-annotation-check';
import { MeiSchemaRegistry } from './schema/mei-schema-registry.service';
import { glyphFor, linkPath } from './mei-attribute-glyphs';
import { GLYPH_PATHS } from '../notes/glyph-paths';

/** The shapes of a neume component that can be picked by looking at them (see `mei-attribute-glyphs.ts`). */
const SHAPE_GROUPS: { attr: string; label: string; values: string[] }[] = [
  { attr: 'tilt', label: 'Tilt (direction of the stroke)', values: ['nw', 'n', 'ne', 'w', 'e', 'sw', 's', 'se'] },
  { attr: 'curve', label: 'Curve', values: ['a', 'c'] },
  { attr: 'rellen', label: 'Length of the stroke', values: ['s', 'l'] },
  { attr: 'con', label: 'Connection to the previous note', values: ['g', 'l', 'e'] },
  { attr: 'angled', label: 'Angled', values: ['true'] },
  { attr: 'hooked', label: 'Hooked', values: ['true'] },
  { attr: 'ligated', label: 'Ligated', values: ['true'] }
];

interface Row { name: string; value: string }

/**
 * Edit the MEI attributes that are set by hand on a note (`<nc>`), a neume or a syllable. The
 * attributes offered and the values accepted come from the schema catalog of the active MEI profile;
 * an attribute the schema does not know can still be added (a warning, or an error in strict mode).
 * Returns the new attribute map through `modal.close`.
 */
@Component({
  selector: 'app-mei-annotation-dialog',
  templateUrl: './mei-annotation-dialog.component.html',
  standalone: false
})
export class MeiAnnotationDialogComponent implements OnInit {
  @Input() target: AnnotationTarget = 'nc';
  /** Attributes set by hand so far. */
  @Input() attrs: Record<string, string> = {};
  /** Attributes that rules would set on this element, shown for information. */
  @Input() fromRules: Record<string, string> = {};
  /** Attributes the export mapping generates for this element; shown locked. Setting the same name overrides them. */
  @Input() generated: Record<string, string> = {};
  /** What is being edited, for the title (for example `Note G4 in "Glo"`). */
  @Input() subject = '';
  /** MEI element to edit when it is not the one the profile maps the target to (an accidental is an `accid`, not an `nc`). */
  @Input() elementName = '';

  rows: Row[] = [];
  newName = '';
  loading = true;
  loadError = '';
  catalog?: MeiSchemaCatalog;
  element = 'nc';
  readonly profile = getActiveMeiProfile();
  readonly strict = this.profile?.attributePolicy === 'strict';
  available: MeiAttrDef[] = [];
  favorites: string[] = [];

  constructor(public modal: NgbActiveModal, private registry: MeiSchemaRegistry) {}

  async ngOnInit(): Promise<void> {
    this.rows = Object.entries(this.attrs).map(([name, value]) => ({ name, value }));
    if (this.elementName) this.element = this.elementName;
    else if (this.profile) this.element = targetElements(this.profile)[this.target];
    else this.element = this.target;
    try {
      await this.registry.ready();
    } catch (e) {
      this.loadError = 'The bundled schema could not be loaded; attributes are not checked.';
    }
    this.catalog = this.registry.forProfile(this.profile?.schemaId, this.profile?.schemaExtensions);
    this.available = this.catalog ? attributesOf(this.catalog, this.element) : [];
    const prefix = this.element + '@';
    this.favorites = (this.profile?.favoriteAttributes ?? []).filter(f => f.startsWith(prefix)).map(f => f.slice(prefix.length));
    this.loading = false;
  }

  get schemaLabel(): string { return this.catalog?.label ?? 'no schema'; }

  def(name: string): MeiAttrDef | undefined {
    return this.catalog ? findAttribute(this.catalog, this.element, name) : undefined;
  }

  issue(row: Row): AttrIssue | null {
    if (this.rows.filter(r => r.name === row.name).length > 1) return { level: 'error', message: `@${row.name} appears twice.` };
    return checkAttribute(this.catalog, this.element, row.name, row.value, this.profile?.attributePolicy ?? 'warn');
  }

  /** Suggested values for the attribute, from the schema. */
  valueOptions(row: Row): string[] {
    return this.def(row.name)?.values?.map(v => v.value) ?? [];
  }

  valueTitle(name: string): string {
    const d = this.def(name);
    if (!d) return '';
    const kind = d.typeName ?? d.type;
    return `${kind}${d.list ? ' (list)' : ''}${d.min !== undefined || d.max !== undefined ? ` ${d.min ?? ''}–${d.max ?? ''}` : ''}`;
  }

  get newNameProblem(): string {
    const n = this.newName.trim();
    if (!n) return '';
    if (!isValidAttributeName(n)) return `"${n}" is not a valid attribute name.`;
    if (this.rows.some(r => r.name === n)) return `@${n} is already set.`;
    return '';
  }

  /** The typed name is not in the schema (it can still be added unless strict). */
  get newNameUnknown(): boolean {
    const n = this.newName.trim();
    return !!n && !!this.catalog && !this.newNameProblem && !this.def(n);
  }

  get newNameDoc(): string { return this.def(this.newName.trim())?.doc ?? ''; }

  add(name: string = this.newName): void {
    const n = name.trim();
    if (!n || this.rows.some(r => r.name === n) || !isValidAttributeName(n)) return;
    this.rows.push({ name: n, value: '' });
    this.newName = '';
  }

  remove(i: number): void {
    this.rows.splice(i, 1);
  }

  /** The shape groups the element has attributes for (only a note, `nc`, has them). */
  get shapeGroups() {
    return this.target === 'nc' ? SHAPE_GROUPS.filter(g => this.available.some(a => a.name === g.attr)) : [];
  }

  shapeValue(attr: string): string | undefined {
    return this.rows.find(r => r.name === attr)?.value.trim() || undefined;
  }

  /** Picks a shape; picking the one that is set removes it. */
  setShape(attr: string, value: string): void {
    const row = this.rows.find(r => r.name === attr);
    if (row && row.value.trim() === value) { this.rows.splice(this.rows.indexOf(row), 1); return; }
    if (row) row.value = value; else this.rows.push({ name: attr, value });
  }

  /** Path data of the drawing for a shape, relative to the centre of the note head. */
  shapePath(attr: string, value: string): string { return glyphFor(attr, value)?.d ?? ''; }

  /** The outline of Monodi's normal note head, centred on the origin (the head glyph is drawn at 24..36 × 0..60, centre 30, 30). */
  readonly headPath = GLYPH_PATHS['Normal'];

  /**
   * For a shape that joins two heads (`ligated`, `con="e"`): the place of the other head in the button (relative to the first) and the
   * band between them, as the staff draws it; null for the other shapes.
   */
  shapeLink(attr: string, value: string): { x: number; y: number; band: string } | null {
    const link = glyphFor(attr, value)?.link;
    if (link === 'next') return { x: 13, y: 5, band: linkPath({ x: 0, y: 0 }, { x: 13, y: 5 }) };
    if (link === 'previous') return { x: -13, y: -5, band: linkPath({ x: -13, y: -5 }, { x: 0, y: 0 }) };
    return null;
  }

  shapeLabel(attr: string, value: string): string { return value === 'true' ? attr : `${attr}="${value}"`; }

  get elementDoc(): string { return this.catalog?.elements[this.element]?.doc ?? ''; }
  get elementChildren(): string[] { return this.catalog?.elements[this.element]?.children ?? []; }

  get rowNames(): string[] { return this.rows.map(r => r.name); }

  get canApply(): boolean {
    return this.rows.every(r => r.value.trim() === '' || this.issue(r)?.level !== 'error');
  }

  apply(): void {
    const out: Record<string, string> = {};
    for (const r of this.rows) if (r.value.trim() !== '') out[r.name] = r.value.trim();
    this.modal.close(out);
  }

  get generatedEntries(): { name: string; value: string }[] {
    return Object.entries(this.generated).filter(([n]) => !this.rows.some(r => r.name === n)).map(([name, value]) => ({ name, value }));
  }

  get ruleEntries(): { name: string; value: string }[] {
    return Object.entries(this.fromRules).map(([name, value]) => ({ name, value }));
  }
}
