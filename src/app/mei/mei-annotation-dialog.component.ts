import { Component, Input, OnInit } from '@angular/core';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { AnnotationTarget, AttrIssue, MeiAttrDef, MeiSchemaCatalog, attributesOf, checkAttribute, findAttribute, isValidAttributeName } from '@monodi/core/mei';
import { getActiveMeiProfile } from './mei-annotation-context';
import { targetElements } from './mei-annotation-check';
import { MeiSchemaRegistry } from './schema/mei-schema-registry.service';

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
