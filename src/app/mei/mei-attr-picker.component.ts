import { Component, ElementRef, EventEmitter, HostListener, Input, Output } from '@angular/core';
import { MeiAttrDef, isValidAttributeName } from '@monodi/core/mei';
import { groupInfo } from './schema/mei-attr-groups';

type Kind = 'all' | 'values' | 'number' | 'text';

interface Section { key: string; label: string; order: number; items: MeiAttrDef[] }

/**
 * Searchable, browsable list of the attributes a schema allows on one element.
 *  - Typing searches names and descriptions (all words must occur; a name match ranks first).
 *  - *Browse* lists every attribute in sections by attribute class of the schema (common, logical, gestural,
 *    visual, analytical, defined on the element), each section collapsible.
 *  - A row opens a detail view: full description, type, range or pattern, every allowed value with its meaning.
 *  - The chips narrow the list by kind of value. A name that is not in the list can be added as a custom attribute.
 * Emits the chosen attribute name.
 */
@Component({
  selector: 'app-mei-attr-picker',
  templateUrl: './mei-attr-picker.component.html',
  styleUrls: ['./mei-attr-picker.component.css'],
  standalone: false
})
export class MeiAttrPickerComponent {
  @Input() attributes: MeiAttrDef[] = [];
  /** Names that are already set; they are left out of the list. */
  @Input() exclude: string[] = [];
  @Input() placeholder = 'Search attributes by name or meaning, e.g. tilt or "pen stroke"';
  @Input() favorites: string[] = [];
  /** The element the attributes belong to, with its description and the elements it may contain (shown as background). */
  @Input() element = '';
  @Input() elementDoc = '';
  @Input() children: string[] = [];
  @Output() picked = new EventEmitter<string>();

  query = '';
  open = false;
  browse = false;
  aboutOpen = false;
  kind: Kind = 'all';
  /** Attribute whose details are open. */
  detail: string | null = null;
  private collapsed = new Set<string>();
  readonly kinds: { id: Kind; label: string }[] = [
    { id: 'all', label: 'All' }, { id: 'values', label: 'With fixed values' }, { id: 'number', label: 'Numbers' }, { id: 'text', label: 'Text' }
  ];

  constructor(private host: ElementRef<HTMLElement>) {}

  @HostListener('document:mousedown', ['$event'])
  outside(e: MouseEvent): void {
    if (!this.host.nativeElement.contains(e.target as Node)) { this.open = false; this.browse = false; }
  }

  private kindOf(a: MeiAttrDef): Kind {
    if (a.type === 'enum' || a.type === 'boolean' || (a.values?.length ?? 0) > 0) return 'values';
    if (a.type === 'integer' || a.type === 'decimal') return 'number';
    return 'text';
  }

  get results(): MeiAttrDef[] {
    const words = this.query.toLowerCase().split(/\s+/).filter(Boolean);
    const scored: { a: MeiAttrDef; s: number }[] = [];
    for (const a of this.attributes) {
      if (this.exclude.includes(a.name)) continue;
      if (this.kind !== 'all' && this.kindOf(a) !== this.kind) continue;
      const name = a.name.toLowerCase();
      const doc = (a.doc ?? '').toLowerCase() + ' ' + (a.values ?? []).map(v => v.value + ' ' + (v.doc ?? '')).join(' ').toLowerCase();
      let s = this.favorites.includes(a.name) ? 5 : 0;
      let ok = true;
      for (const w of words) {
        if (name === w) s += 100; else if (name.startsWith(w)) s += 60; else if (name.includes(w)) s += 40;
        else if (doc.includes(w)) s += 10; else { ok = false; break; }
      }
      if (ok) scored.push({ a, s });
    }
    scored.sort((x, y) => y.s - x.s || x.a.name.localeCompare(y.a.name));
    return scored.map(x => x.a);
  }

  get searching(): boolean { return !!this.query.trim(); }

  /** Flat list for a search, or the first few attributes before anything is typed. */
  get shown(): MeiAttrDef[] {
    const all = this.results;
    return this.searching ? all : all.slice(0, 8);
  }

  /** Sections for browsing, in the order common, defined on the element, logical, gestural, visual, analytical, general. */
  get sections(): Section[] {
    const by = new Map<string, Section>();
    for (const a of this.results) {
      const info = groupInfo(a.group, this.element);
      const key = a.group ?? '';
      let s = by.get(key);
      if (!s) { s = { key, label: info.label, order: info.order, items: [] }; by.set(key, s); }
      s.items.push(a);
    }
    return [...by.values()].sort((x, y) => x.order - y.order || x.label.localeCompare(y.label));
  }

  groupLabel(a: MeiAttrDef): string { return groupInfo(a.group, this.element).label; }

  isCollapsed(key: string): boolean { return this.collapsed.has(key); }
  toggleSection(key: string): void { if (!this.collapsed.delete(key)) this.collapsed.add(key); }
  setAllSections(collapse: boolean): void {
    this.collapsed = collapse ? new Set(this.sections.map(s => s.key)) : new Set();
  }

  get customName(): string {
    const n = this.query.trim();
    return n && isValidAttributeName(n) && !this.attributes.some(a => a.name === n) && !this.exclude.includes(n) ? n : '';
  }

  badge(a: MeiAttrDef): string {
    if (a.values && a.values.length > 0 && !a.alternatives) return `${a.values.length} values`;
    if (a.alternatives) return a.alternatives.map(x => x.type === 'token' && x.pattern ? `“${x.pattern}”` : x.type).join(' or ');
    return a.typeName?.replace(/^data\./, '') ?? a.type;
  }

  hint(a: MeiAttrDef): string {
    return (a.values ?? []).slice(0, 6).map(v => v.value).join(' · ') + ((a.values?.length ?? 0) > 6 ? ' …' : '');
  }

  /** Short statements about what a value must look like, for the detail view. */
  constraints(a: MeiAttrDef): string[] {
    const out: string[] = [];
    const parts = a.alternatives ?? [a];
    for (const p of parts) {
      let t: string = p.type;
      if (p.list) t += ' list';
      if (p.min !== undefined || p.max !== undefined) t += ` (${p.min ?? '…'} to ${p.max ?? '…'})`;
      if (p.pattern) t += `, pattern ${p.pattern}`;
      if (p.type === 'enum' || p.type === 'boolean') t = `one of the values below${p.list ? ' (several allowed, separated by spaces)' : ''}`;
      out.push(t);
    }
    return a.alternatives ? [`either ${out.join(' or ')}`] : out;
  }

  toggleDetail(name: string): void { this.detail = this.detail === name ? null : name; }

  toggleBrowse(): void {
    this.browse = !this.browse;
    this.open = true;
    if (!this.browse) this.detail = null;
  }

  pick(name: string): void {
    this.picked.emit(name);
    this.query = '';
    this.detail = null;
    this.browse = false;
    this.open = false;
  }

  enter(): void {
    const first = this.results[0];
    if (this.customName && (!first || first.name !== this.customName)) { this.pick(this.customName); return; }
    if (first) this.pick(first.name);
  }
}
