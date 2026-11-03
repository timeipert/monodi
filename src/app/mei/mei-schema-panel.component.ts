import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { MeiMappingProfileV2 } from '@monodi/core/mei';
import { targetElements } from './mei-annotation-check';
import { DEFAULT_SCHEMA_ID, MeiSchemaRegistry, SchemaInfo } from './schema/mei-schema-registry.service';

/**
 * Settings tab "Schema": which MEI schema the annotations are checked against, how strictly, which
 * schemas can be loaded, the project's own additions to the schema, and the favourite attributes of
 * the annotation dialog.
 */
@Component({
  selector: 'app-mei-schema-panel',
  templateUrl: './mei-schema-panel.component.html',
  standalone: false
})
export class MeiSchemaPanelComponent implements OnInit {
  @Input() profile!: MeiMappingProfileV2;
  @Output() changed = new EventEmitter<void>();

  schemas: SchemaInfo[] = [];
  loadError = '';
  message = '';
  busy = false;
  upload = { id: '', label: '', version: '5.0' };
  newExt = { element: 'nc', name: '', values: '', doc: '' };
  newFav = { element: 'nc', name: '' };

  constructor(private registry: MeiSchemaRegistry) {}

  async ngOnInit(): Promise<void> {
    try { await this.registry.ready(); } catch { this.loadError = 'The bundled schema could not be loaded.'; }
    this.refresh();
  }

  private refresh(): void { this.schemas = this.registry.list(); }

  get schemaId(): string { return this.profile.schemaId ?? DEFAULT_SCHEMA_ID; }
  set schemaId(v: string) {
    if (v === DEFAULT_SCHEMA_ID) delete this.profile.schemaId; else this.profile.schemaId = v;
    this.changed.emit();
  }

  get strict(): boolean { return this.profile.attributePolicy === 'strict'; }
  set strict(v: boolean) {
    if (v) this.profile.attributePolicy = 'strict'; else delete this.profile.attributePolicy;
    this.changed.emit();
  }

  get selectedInfo(): SchemaInfo | undefined { return this.schemas.find(s => s.id === this.schemaId); }
  get selectedIsUser(): boolean { return this.selectedInfo?.origin === 'user'; }

  /** Element names that can carry annotations, as the profile maps them (for the extension and favourite pickers). */
  get elements(): string[] {
    const t = targetElements(this.profile);
    return [...new Set([t.nc, t.neume, t.syllable, 'neume', 'nc', 'syllable', 'syl', 'clef', 'section', 'layer', 'staff'])];
  }

  // ---- loading schemas ------------------------------------------------------------------

  async onFile(ev: Event): Promise<void> {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.busy = true;
    this.message = '';
    this.loadError = '';
    try {
      const text = await file.text();
      if (file.name.toLowerCase().endsWith('.json')) {
        const c = this.registry.addFromCatalogJson(text);
        this.message = `Loaded "${c.label}" (${Object.keys(c.elements).length} elements).`;
        this.schemaId = c.id;
      } else {
        const base = file.name.replace(/\.[^.]+$/, '');
        const id = (this.upload.id.trim() || base).toLowerCase().replace(/[^a-z0-9.-]+/g, '-');
        const c = this.registry.addFromRng(text, {
          id, label: this.upload.label.trim() || base, schemaVersion: this.upload.version.trim() || '5.0', source: file.name
        });
        this.message = `Loaded "${c.label}" (${Object.keys(c.elements).length} elements).`;
        this.schemaId = c.id;
      }
      this.upload = { id: '', label: '', version: this.upload.version };
    } catch (e: any) {
      this.loadError = e?.message ?? String(e);
    } finally {
      this.busy = false;
      this.refresh();
    }
  }

  removeSchema(): void {
    const info = this.selectedInfo;
    if (!info || info.origin !== 'user') return;
    this.registry.remove(info.id);
    this.schemaId = DEFAULT_SCHEMA_ID;
    this.refresh();
  }

  // ---- project extensions ---------------------------------------------------------------

  get extensions() { return this.profile.schemaExtensions ?? []; }

  addExtension(): void {
    const name = this.newExt.name.trim();
    if (!name) return;
    const values = this.newExt.values.split(',').map(v => v.trim()).filter(Boolean);
    (this.profile.schemaExtensions ??= []).push({
      element: this.newExt.element.trim() || '*', name,
      ...(values.length ? { values } : {}), ...(this.newExt.doc.trim() ? { doc: this.newExt.doc.trim() } : {})
    });
    this.newExt = { element: this.newExt.element, name: '', values: '', doc: '' };
    this.changed.emit();
  }

  removeExtension(i: number): void {
    this.profile.schemaExtensions!.splice(i, 1);
    if (this.profile.schemaExtensions!.length === 0) delete this.profile.schemaExtensions;
    this.changed.emit();
  }

  // ---- favourites -----------------------------------------------------------------------

  get favorites(): string[] { return this.profile.favoriteAttributes ?? []; }

  addFavorite(): void {
    const name = this.newFav.name.trim();
    if (!name) return;
    const key = `${this.newFav.element}@${name}`;
    if (!this.favorites.includes(key)) (this.profile.favoriteAttributes ??= []).push(key);
    this.newFav.name = '';
    this.changed.emit();
  }

  removeFavorite(f: string): void {
    this.profile.favoriteAttributes = this.favorites.filter(x => x !== f);
    if (this.profile.favoriteAttributes.length === 0) delete this.profile.favoriteAttributes;
    this.changed.emit();
  }
}
