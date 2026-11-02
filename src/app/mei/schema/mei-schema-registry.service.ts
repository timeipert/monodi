import { Injectable } from '@angular/core';
import { MeiSchemaCatalog, MeiSchemaExtension, subsetCatalog, withExtensions } from './mei-schema-catalog';
import { rngTextToCatalog } from './rng-to-catalog';

export const BUNDLED_ALL_ID = 'mei-5.0-all';
export const BUNDLED_NEUMES_ID = 'mei-5.0-neumes-view';
/** Catalog used when a profile names none. */
export const DEFAULT_SCHEMA_ID = BUNDLED_ALL_ID;

const USER_STORAGE_KEY = 'monodi.mei.userSchemas';

/**
 * Elements of the neume part of MEI, for the derived view `BUNDLED_NEUMES_ID`: the structure around a
 * syllable (score down to layer), the neume elements, and the elements a neume layer usually carries.
 * An approximation of the MEI neume customization; the exact one is `mei-Neumes.rng`, which a person
 * can load as a schema of its own.
 */
const NEUMES_VIEW_ELEMENTS = [
  'mei', 'meiHead', 'music', 'body', 'mdiv', 'score', 'scoreDef', 'staffDef', 'staffGrp', 'section', 'staff', 'layer',
  'syllable', 'syl', 'neume', 'nc', 'ncGrp', 'oriscus', 'quilisma', 'strophicus', 'liquescent', 'episema', 'hispanTick',
  'signifLet', 'accid', 'clef', 'custos', 'divLine', 'sb', 'pb', 'annot', 'dir', 'app', 'lem', 'rdg', 'gap', 'supplied',
  'unclear', 'sic', 'corr', 'add', 'del', 'orig', 'reg', 'choice', 'subst', 'damage', 'restore', 'handShift'
];

export interface SchemaInfo {
  id: string;
  label: string;
  schemaVersion: string;
  origin: MeiSchemaCatalog['origin'];
  elementCount: number;
}

/**
 * The set of schema catalogs the app can check MEI against: the bundled MEI 5.0 schema, a derived
 * view on its neume part, and any schema a person loads (a RelaxNG file such as `mei-Neumes.rng`, a
 * later MEI release, or a catalog JSON made with `scripts/build-mei-catalog.mjs`). Loaded schemas stay
 * in the browser's local storage; they are not part of the project settings because of their size.
 */
@Injectable({ providedIn: 'root' })
export class MeiSchemaRegistry {
  private readonly catalogs = new Map<string, MeiSchemaCatalog>();
  private bundledLoad?: Promise<void>;

  constructor() {
    this.restoreUserCatalogs();
  }

  /** Resolves when the bundled catalog is available (it is fetched on first use). */
  ready(): Promise<void> {
    if (!this.bundledLoad) this.bundledLoad = this.loadBundled();
    return this.bundledLoad;
  }

  private async loadBundled(): Promise<void> {
    try {
      const res = await fetch('assets/mei/mei-5.0-all.catalog.json');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const all = (await res.json()) as MeiSchemaCatalog;
      this.catalogs.set(all.id, all);
      this.catalogs.set(BUNDLED_NEUMES_ID, subsetCatalog(all, {
        id: BUNDLED_NEUMES_ID,
        label: 'MEI 5.0 neumes (view on the full schema)',
        roots: [],
        extra: NEUMES_VIEW_ELEMENTS,
        stop: NEUMES_VIEW_ELEMENTS
      }));
    } catch (e) {
      // Without a catalog the dialog and the check still work: every attribute is then reported as unchecked.
      this.bundledLoad = undefined;
      throw e;
    }
  }

  list(): SchemaInfo[] {
    return [...this.catalogs.values()].map(c => ({
      id: c.id, label: c.label, schemaVersion: c.schemaVersion, origin: c.origin, elementCount: Object.keys(c.elements).length
    }));
  }

  /** The catalog with this id if it is loaded; call `ready()` first for the bundled ones. */
  get(id: string | undefined): MeiSchemaCatalog | undefined {
    return this.catalogs.get(id || DEFAULT_SCHEMA_ID);
  }

  /** The catalog of a profile with the profile's own additions applied. */
  forProfile(schemaId: string | undefined, extensions: MeiSchemaExtension[] | undefined): MeiSchemaCatalog | undefined {
    const base = this.get(schemaId) ?? this.get(DEFAULT_SCHEMA_ID);
    return base ? withExtensions(base, extensions) : undefined;
  }

  /** Adds a schema from RelaxNG text; an existing user schema with the same id is replaced. */
  addFromRng(text: string, meta: { id: string; label: string; schemaVersion: string; source?: string }): MeiSchemaCatalog {
    this.assertFreeId(meta.id);
    const catalog = rngTextToCatalog(text, { ...meta, origin: 'user' });
    if (Object.keys(catalog.elements).length === 0) throw new Error('The schema defines no elements.');
    this.catalogs.set(catalog.id, catalog);
    this.persistUserCatalogs();
    return catalog;
  }

  /** Adds a catalog JSON file (see `scripts/build-mei-catalog.mjs`). */
  addFromCatalogJson(text: string): MeiSchemaCatalog {
    const parsed = JSON.parse(text) as MeiSchemaCatalog;
    if (parsed?.format !== 1 || !parsed.id || typeof parsed.elements !== 'object' || typeof parsed.attrDefs !== 'object') {
      throw new Error('The file is not a schema catalog (format 1).');
    }
    this.assertFreeId(parsed.id);
    const catalog: MeiSchemaCatalog = { ...parsed, origin: 'user' };
    this.catalogs.set(catalog.id, catalog);
    this.persistUserCatalogs();
    return catalog;
  }

  remove(id: string): void {
    const c = this.catalogs.get(id);
    if (!c || c.origin !== 'user') return;
    this.catalogs.delete(id);
    this.persistUserCatalogs();
  }

  private assertFreeId(id: string): void {
    const existing = this.catalogs.get(id);
    if (existing && existing.origin !== 'user') throw new Error(`"${id}" is the id of a bundled schema; choose another id.`);
  }

  private restoreUserCatalogs(): void {
    try {
      const raw = localStorage.getItem(USER_STORAGE_KEY);
      if (!raw) return;
      for (const c of JSON.parse(raw) as MeiSchemaCatalog[]) {
        if (c?.format === 1 && c.id) this.catalogs.set(c.id, { ...c, origin: 'user' });
      }
    } catch { /* storage unavailable or damaged: the schemas can be loaded again */ }
  }

  private persistUserCatalogs(): void {
    try {
      const users = [...this.catalogs.values()].filter(c => c.origin === 'user');
      localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(users));
    } catch { /* quota exceeded or storage unavailable: the schema stays available until the page is closed */ }
  }
}
