/**
 * Schema catalog: a compact, JSON-serialisable description of which attributes and child elements a
 * set of MEI (Music Encoding Initiative, an XML standard for music) elements allows.
 *
 * Purpose: the MEI annotation dialog, the mapping editor and the export check ask "is attribute X
 * allowed on element Y, and which values are valid?" without loading or running a RelaxNG schema.
 * A catalog is produced from a RelaxNG file by `rng-to-catalog.ts`, so any MEI customization
 * (the full schema `mei-all`, the neume customization `mei-Neumes`, a later release, a project's own
 * ODD output) becomes a catalog the same way. Angular-free: the build script and the unit tests use it too.
 *
 * Where to start: `checkAttribute` (validation), `attributesOf` (what can be offered in a menu),
 * `subsetCatalog` (a view on part of a catalog), `withExtensions` (project-specific additions that
 * the schema does not know).
 */

export type MeiAttrType = 'enum' | 'string' | 'token' | 'integer' | 'decimal' | 'boolean' | 'uri' | 'id' | 'datetime' | 'other';

/** One way a value can be valid. An attribute with several (a union in the schema) lists them in `alternatives`. */
export interface MeiAttrAlternative {
  type: MeiAttrType;
  /** Allowed values of an `enum` (or `boolean`) attribute, with the schema's description of each value. */
  values?: { value: string; doc?: string }[];
  /** The value is a whitespace-separated list of items of `type`. */
  list?: boolean;
  /** XML Schema pattern (implicitly anchored) that the value, or each item of a list, must match. */
  pattern?: string;
  /** Inclusive bounds of an `integer` or `decimal`. */
  min?: number;
  max?: number;
}

export interface MeiAttrDef extends MeiAttrAlternative {
  name: string;
  /**
   * Set when the schema allows a union of several types (for example an integer or the word "unknown").
   * `type` is then `other`, and `values` holds the union of the listed values as suggestions for a menu.
   */
  alternatives?: MeiAttrAlternative[];
  /** Name of the MEI data type in the schema, for display (for example `data.DURATION`). */
  typeName?: string;
  doc?: string;
  /** Attribute class of the schema that defines it (for example `ncForm`, `nc.log`, `common`); missing for attributes defined on the element itself. */
  group?: string;
}

export interface MeiElementDef {
  doc?: string;
  /** Keys into `MeiSchemaCatalog.attrDefs`. */
  attrs: string[];
  /** Local names of the elements allowed as children. */
  children: string[];
  /** Character data is allowed as content. */
  text?: boolean;
}

export interface MeiSchemaCatalog {
  format: 1;
  /** Stable id, referenced from the MEI profile (for example `mei-5.0-all`). */
  id: string;
  label: string;
  /** MEI version the schema describes, as written in `@meiversion` (for example `5.0`). */
  schemaVersion: string;
  /** `bundled` ships with the app, `derived` is a view on another catalog, `user` was loaded by a person. */
  origin: 'bundled' | 'derived' | 'user';
  /** File or URL the catalog was built from. */
  source?: string;
  attrDefs: Record<string, MeiAttrDef>;
  elements: Record<string, MeiElementDef>;
}

/** A project-specific addition that the schema does not contain. */
export interface MeiSchemaExtension {
  /** Element local name, or `*` for every element. */
  element: string;
  name: string;
  /** Allowed values; empty or missing means free text. */
  values?: string[];
  doc?: string;
}

export interface AttrIssue {
  level: 'error' | 'warning';
  message: string;
}

/** `strict`: an attribute that the catalog does not know is an error; otherwise it is a warning. */
export type AttributePolicy = 'warn' | 'strict';

const XML_NAME = /^[A-Za-z_][\w.-]*(:[A-Za-z_][\w.-]*)?$/;

/** Attributes the export writes itself; an annotation must not set them. */
export const RESERVED_ATTRIBUTES = ['xml:id'];

export function isValidAttributeName(name: string): boolean {
  return XML_NAME.test(name) && !RESERVED_ATTRIBUTES.includes(name);
}

const attrCache = new WeakMap<MeiSchemaCatalog, Map<string, MeiAttrDef[]>>();

/** Attributes the schema allows on `element`, sorted by name; empty for an unknown element. */
export function attributesOf(catalog: MeiSchemaCatalog, element: string): MeiAttrDef[] {
  let perElement = attrCache.get(catalog);
  if (!perElement) { perElement = new Map(); attrCache.set(catalog, perElement); }
  const cached = perElement.get(element);
  if (cached) return cached;
  const def = catalog.elements[element];
  const seen = new Set<string>();
  const list = def
    ? def.attrs.map(k => catalog.attrDefs[k]).filter((a): a is MeiAttrDef => !!a && !seen.has(a.name) && !!seen.add(a.name)).sort((a, b) => a.name.localeCompare(b.name))
    : [];
  perElement.set(element, list);
  return list;
}

export function findAttribute(catalog: MeiSchemaCatalog, element: string, name: string): MeiAttrDef | undefined {
  return attributesOf(catalog, element).find(a => a.name === name);
}

function anchored(pattern: string): RegExp | null {
  try { return new RegExp(`^(?:${pattern})$`); } catch { return null; }
}

function alternativeProblem(def: MeiAttrAlternative, value: string): string | null {
  const items = def.list ? value.trim().split(/\s+/).filter(Boolean) : [value];
  if (def.list && items.length === 0) return 'The value is empty.';
  for (const item of items) {
    switch (def.type) {
      case 'enum':
      case 'boolean':
        if (def.values && def.values.length > 0 && !def.values.some(v => v.value === item)) {
          return `"${item}" is not one of: ${def.values.map(v => v.value).join(', ')}.`;
        }
        break;
      case 'integer':
      case 'decimal': {
        const ok = def.type === 'integer' ? /^[+-]?\d+$/.test(item) : /^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(item);
        if (!ok) return `"${item}" is not ${def.type === 'integer' ? 'an integer' : 'a number'}.`;
        const n = Number(item);
        if (def.min !== undefined && n < def.min) return `"${item}" is below the minimum ${def.min}.`;
        if (def.max !== undefined && n > def.max) return `"${item}" is above the maximum ${def.max}.`;
        break;
      }
      case 'id':
        if (!/^[A-Za-z_][\w.-]*$/.test(item)) return `"${item}" is not a valid id.`;
        break;
      case 'token':
        if (/\s/.test(item)) return 'The value must not contain spaces.';
        break;
      default:
        break;
    }
    if (def.pattern) {
      const re = anchored(def.pattern);
      if (re && !re.test(item)) return `"${item}" does not match the pattern ${def.pattern}.`;
    }
  }
  return null;
}

/** Why `value` does not fit `def` (null = fine). Unknown or free types accept every value. */
export function valueProblem(def: MeiAttrDef, value: string): string | null {
  if (def.alternatives && def.alternatives.length > 0) {
    const problems = def.alternatives.map(a => alternativeProblem(a, value));
    if (problems.some(p => p === null)) return null;
    return `"${value}" fits none of the allowed forms of this attribute (${problems.join(' ')}).`;
  }
  return alternativeProblem(def, value);
}

/**
 * Checks one attribute on one element. An attribute or element that the catalog does not know is not
 * rejected outright: MEI is extended in practice, and the person may work with a newer schema than
 * the loaded catalog. `policy` decides whether that is a warning or an error. A `null` value checks the
 * name only (for a template value that is filled in at export).
 */
export function checkAttribute(
  catalog: MeiSchemaCatalog | undefined, element: string, name: string, value: string | null, policy: AttributePolicy = 'warn'
): AttrIssue | null {
  if (!isValidAttributeName(name)) {
    return { level: 'error', message: RESERVED_ATTRIBUTES.includes(name)
      ? `"${name}" is written by the export and cannot be set.`
      : `"${name}" is not a valid XML attribute name.` };
  }
  if (!catalog) return null;
  if (!catalog.elements[element]) {
    return { level: policy === 'strict' ? 'error' : 'warning', message: `<${element}> is not in the schema "${catalog.label}".` };
  }
  const def = findAttribute(catalog, element, name);
  if (!def) {
    return { level: policy === 'strict' ? 'error' : 'warning', message: `@${name} is not allowed on <${element}> in the schema "${catalog.label}".` };
  }
  const problem = value === null ? null : valueProblem(def, value);
  return problem ? { level: 'error', message: `@${name}: ${problem}` } : null;
}

/**
 * A view on part of a catalog: the elements reachable from `roots` through the child relation (not
 * following the children of `stop` elements), plus `extra` elements, with child lists cut to the kept elements. Used for customizations whose real
 * schema file is not at hand (for example the neume parts of the full schema).
 */
export function subsetCatalog(
  source: MeiSchemaCatalog, options: { id: string; label: string; roots: string[]; extra?: string[]; stop?: string[] }
): MeiSchemaCatalog {
  const keep = new Set<string>();
  const queue = [...options.roots, ...(options.extra ?? [])];
  while (queue.length) {
    const name = queue.pop()!;
    if (keep.has(name) || !source.elements[name]) continue;
    keep.add(name);
    // `stop` elements are kept but not followed: the full schema lets a layer contain nearly everything.
    if (!options.stop?.includes(name)) for (const c of source.elements[name].children) queue.push(c);
  }
  const elements: Record<string, MeiElementDef> = {};
  const usedAttrs = new Set<string>();
  for (const name of keep) {
    const e = source.elements[name];
    elements[name] = { ...e, children: e.children.filter(c => keep.has(c)) };
    e.attrs.forEach(k => usedAttrs.add(k));
  }
  const attrDefs: Record<string, MeiAttrDef> = {};
  usedAttrs.forEach(k => { attrDefs[k] = source.attrDefs[k]; });
  return {
    format: 1, id: options.id, label: options.label, schemaVersion: source.schemaVersion,
    origin: 'derived', source: source.id, attrDefs, elements
  };
}

/** A copy of `catalog` with the project's own attributes added (see MeiSchemaExtension). */
export function withExtensions(catalog: MeiSchemaCatalog, extensions: MeiSchemaExtension[] | undefined): MeiSchemaCatalog {
  const exts = (extensions ?? []).filter(e => e.element && isValidAttributeName(e.name));
  if (exts.length === 0) return catalog;
  const attrDefs = { ...catalog.attrDefs };
  const elements: Record<string, MeiElementDef> = {};
  for (const [k, v] of Object.entries(catalog.elements)) elements[k] = { ...v, attrs: [...v.attrs] };
  exts.forEach((e, i) => {
    const key = `ext:${i}:${e.name}`;
    const values = (e.values ?? []).filter(v => v !== '');
    attrDefs[key] = {
      name: e.name,
      type: values.length > 0 ? 'enum' : 'string',
      ...(values.length > 0 ? { values: values.map(value => ({ value })) } : {}),
      doc: e.doc ? `${e.doc} (project extension)` : 'Project extension, not part of the schema.'
    };
    const targets = e.element === '*' ? Object.keys(elements) : elements[e.element] ? [e.element] : [];
    for (const t of targets) {
      // An extension replaces a schema attribute of the same name, so the project's value list wins.
      elements[t].attrs = elements[t].attrs.filter(k => attrDefs[k]?.name !== e.name);
      elements[t].attrs.push(key);
    }
  });
  return { ...catalog, attrDefs, elements, id: catalog.id };
}
