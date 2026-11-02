import { Component, ElementRef, EventEmitter, HostListener, Input, Output } from '@angular/core';
import { MeiAttrDef, isValidAttributeName } from './schema/mei-schema-catalog';

type Kind = 'all' | 'values' | 'number' | 'text';

/**
 * Searchable list of the attributes a schema allows on one element. Typing filters by name and by description
 * (all words must occur, name matches first); "Browse" opens the whole list; the chips narrow it by kind of value.
 * A name that is not in the list can still be picked as a custom attribute. Emits the chosen attribute name.
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
  @Input() placeholder = 'Search attributes, e.g. tilt or "pen stroke"';
  @Input() favorites: string[] = [];
  @Output() picked = new EventEmitter<string>();

  query = '';
  open = false;
  browse = false;
  kind: Kind = 'all';
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

  get shown(): MeiAttrDef[] {
    const all = this.results;
    return this.browse || this.query.trim() ? all : all.slice(0, 12);
  }

  get customName(): string {
    const n = this.query.trim();
    return n && isValidAttributeName(n) && !this.attributes.some(a => a.name === n) && !this.exclude.includes(n) ? n : '';
  }

  badge(a: MeiAttrDef): string {
    if (a.values && a.values.length > 0 && !a.alternatives) return `${a.values.length} values`;
    return a.typeName?.replace(/^data\./, '') ?? a.type;
  }

  hint(a: MeiAttrDef): string {
    return (a.values ?? []).slice(0, 6).map(v => v.value).join(' · ') + ((a.values?.length ?? 0) > 6 ? ' …' : '');
  }

  toggleBrowse(): void {
    this.browse = !this.browse;
    this.open = this.browse || this.open;
  }

  pick(name: string): void {
    this.picked.emit(name);
    this.query = '';
    this.browse = false;
    this.open = false;
  }

  enter(): void {
    const first = this.results[0];
    if (this.customName && (!first || first.name !== this.customName)) { this.pick(this.customName); return; }
    if (first) this.pick(first.name);
  }
}
