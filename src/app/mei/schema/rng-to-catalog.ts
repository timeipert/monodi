/**
 * Builds a schema catalog (see packages/core/src/mei/schema-catalog.ts) from a RelaxNG schema, as MEI publishes it
 * (`mei-all.rng`, `mei-Neumes.rng`, a project's own customization).
 *
 * The parser takes an already parsed XML `Document`, so it runs in the browser (`DOMParser`), in
 * Node (`@xmldom/xmldom`) and in tests alike. It reads only what the catalog needs:
 *   - every `<define>` whose body is an `<element name="...">` is an MEI element;
 *   - the attributes of an element are the `<attribute>` nodes in its body, followed through
 *     `<ref>`s to the attribute classes (`att.*`);
 *   - the children of an element are the elements reachable through `<ref>`s to content models
 *     (`model.*`) without passing through another element;
 *   - the type of an attribute is read from its content: a choice of values, a reference to a data
 *     type, an XML Schema datatype, a list.
 * Schematron rules in the schema are not evaluated.
 */
import { MeiAttrAlternative, MeiAttrDef, MeiAttrType, MeiElementDef, MeiSchemaCatalog } from '@monodi/core/mei';

const MAX_TYPE_DEPTH = 8;

function kids(node: Node): Element[] {
  const out: Element[] = [];
  for (let c = node.firstChild; c; c = c.nextSibling) if (c.nodeType === 1) out.push(c as Element);
  return out;
}

const local = (e: Element) => e.localName || e.nodeName.replace(/^.*:/, '');

function cleanText(s: string | null): string {
  return (s ?? '').replace(/\s+/g, ' ').trim();
}

/** Text of the first `documentation` child, empty string if none. */
function docOf(node: Element): string {
  const d = kids(node).find(k => local(k) === 'documentation');
  return d ? cleanText(d.textContent) : '';
}

interface TypeInfo extends MeiAttrAlternative {
  values: { value: string; doc?: string }[];
  list: boolean;
  alternatives?: MeiAttrAlternative[];
  typeName?: string;
}

const DATATYPE: Record<string, MeiAttrType> = {
  string: 'string', normalizedString: 'string',
  token: 'token', NMTOKEN: 'token', NMTOKENS: 'token', NCName: 'token', Name: 'token', language: 'token',
  integer: 'integer', positiveInteger: 'integer', nonNegativeInteger: 'integer', negativeInteger: 'integer', int: 'integer',
  decimal: 'decimal', float: 'decimal', double: 'decimal',
  anyURI: 'uri', ID: 'id', IDREF: 'id', IDREFS: 'id',
  boolean: 'boolean',
  date: 'datetime', dateTime: 'datetime', time: 'datetime', duration: 'datetime',
  gYear: 'datetime', gYearMonth: 'datetime', gMonth: 'datetime', gMonthDay: 'datetime', gDay: 'datetime'
};
const LIST_DATATYPES = new Set(['NMTOKENS', 'IDREFS']);

export interface RngCatalogMeta {
  id: string;
  label: string;
  schemaVersion: string;
  origin?: 'bundled' | 'derived' | 'user';
  source?: string;
}

export function rngToCatalog(doc: Document, meta: RngCatalogMeta): MeiSchemaCatalog {
  const defines = new Map<string, Element>();
  const all = doc.getElementsByTagName('define');
  for (let i = 0; i < all.length; i++) {
    const name = all[i].getAttribute('name');
    if (name) defines.set(name, all[i]);
  }

  /** define name → the `<element>` node, for defines that are elements. */
  const elementNodes = new Map<string, Element>();
  /** define name → element local name. */
  const elementNames = new Map<string, string>();
  defines.forEach((def, defName) => {
    const body = kids(def).filter(k => !['documentation', 'annotation'].includes(local(k)));
    if (body.length === 1 && local(body[0]) === 'element' && body[0].getAttribute('name')) {
      elementNodes.set(defName, body[0]);
      elementNames.set(defName, body[0].getAttribute('name')!);
    }
  });

  // ---- attribute types -------------------------------------------------------------------------

  function typeOfNodes(nodes: Element[], depth: number, typeName?: string): TypeInfo {
    const info: TypeInfo = { type: 'other', values: [], list: false, typeName };
    if (depth > MAX_TYPE_DEPTH) return info;
    const content = nodes.filter(n => !['documentation', 'annotation'].includes(local(n)));
    if (content.length === 0) return info;

    /** Value alternatives written directly in this node (`<value>`), and typed alternatives (data, ref, list, text). */
    const directValues: { value: string; doc?: string }[] = [];
    const typed: TypeInfo[] = [];
    const collect = (node: Element, nextDoc?: string) => {
      switch (local(node)) {
        case 'value':
          directValues.push({ value: cleanText(node.textContent), ...(nextDoc ? { doc: nextDoc } : {}) });
          break;
        case 'text':
          typed.push({ type: 'string', values: [], list: false });
          break;
        case 'data': {
          const dt = node.getAttribute('type') ?? 'string';
          const t: TypeInfo = { type: DATATYPE[dt] ?? 'string', values: [], list: LIST_DATATYPES.has(dt) };
          for (const p of kids(node)) {
            if (local(p) !== 'param') continue;
            const pn = p.getAttribute('name');
            const pv = cleanText(p.textContent);
            if (pn === 'pattern') t.pattern = pv;
            else if ((pn === 'minInclusive' || pn === 'maxInclusive') && pv !== '' && !isNaN(Number(pv))) {
              if (pn === 'minInclusive') t.min = Number(pv); else t.max = Number(pv);
            }
          }
          typed.push(t);
          break;
        }
        case 'ref': {
          const refName = node.getAttribute('name') ?? '';
          const def = defines.get(refName);
          if (def && !elementNodes.has(refName)) typed.push(typeOfNodes(kids(def), depth + 1, refName.replace(/^mei_/, '')));
          break;
        }
        case 'list': {
          const inner = typeOfNodes(kids(node), depth + 1);
          typed.push({ ...inner, list: true });
          break;
        }
        case 'choice': case 'group': case 'interleave': case 'optional': case 'oneOrMore': case 'zeroOrMore': {
          const subs = kids(node);
          for (let i = 0; i < subs.length; i++) {
            const next = subs[i + 1] && local(subs[i + 1]) === 'documentation' ? cleanText(subs[i + 1].textContent) : undefined;
            collect(subs[i], next);
          }
          break;
        }
        default:
          break;
      }
    };
    for (const n of content) collect(n);
    // Flatten: a part that is itself a union contributes its alternatives.
    const alts: MeiAttrAlternative[] = [];
    if (directValues.length > 0) alts.push({ type: 'enum', values: directValues });
    for (const t of typed) {
      if (t.alternatives) alts.push(...t.alternatives);
      else alts.push(toAlternative(t));
    }
    if (alts.length === 1) {
      Object.assign(info, alts[0]);
      info.values = alts[0].values ?? [];
      info.list = !!alts[0].list;
      info.typeName = typeName ?? typed.find(t => t.typeName)?.typeName;
    } else if (alts.length > 1) {
      info.type = 'other';
      info.alternatives = alts;
      const seen = new Set<string>();
      for (const a of alts) for (const v of a.values ?? []) if (!seen.has(v.value)) { seen.add(v.value); info.values.push(v); }
      info.typeName = typeName ?? typed.find(t => t.typeName)?.typeName;
    }
    if (info.type === 'enum' && !info.alternatives) {
      const vs = new Set(info.values.map(v => v.value));
      if (vs.size === 2 && vs.has('true') && vs.has('false')) info.type = 'boolean';
    }
    return info;
  }

  function toAlternative(t: TypeInfo): MeiAttrAlternative {
    const a: MeiAttrAlternative = { type: t.type };
    if (t.values.length > 0) a.values = t.values;
    if (t.list) a.list = true;
    if (t.pattern) a.pattern = t.pattern;
    if (t.min !== undefined) a.min = t.min;
    if (t.max !== undefined) a.max = t.max;
    return a;
  }

  /** Name of the `<define>` being walked; the attribute class is read from it (`mei_att.ncForm.attribute.con` → `ncForm`). */
  let currentDefine = '';

  function attrDefOf(attr: Element): MeiAttrDef | null {
    const name = attr.getAttribute('name');
    if (!name) return null;                      // `<anyName/>` attributes carry no fixed name
    const info = typeOfNodes(kids(attr), 0);
    const doc = docOf(attr);
    const def: MeiAttrDef = { name, ...toAlternative(info) };
    if (info.alternatives) def.alternatives = info.alternatives;
    if (info.typeName) def.typeName = info.typeName;
    if (doc) def.doc = doc;
    const group = /^mei_att\.(.+?)\.attribute\./.exec(currentDefine)?.[1];
    if (group) def.group = group;
    return def;
  }

  // ---- interning of attribute definitions ------------------------------------------------------

  const attrDefs: Record<string, MeiAttrDef> = {};
  const internIndex = new Map<string, string>();
  const perName = new Map<string, number>();
  function intern(def: MeiAttrDef): string {
    const json = JSON.stringify(def);
    const hit = internIndex.get(json);
    if (hit) return hit;
    const n = (perName.get(def.name) ?? 0) + 1;
    perName.set(def.name, n);
    const key = n === 1 ? def.name : `${def.name}#${n}`;
    attrDefs[key] = def;
    internIndex.set(json, key);
    return key;
  }

  // ---- content walk ----------------------------------------------------------------------------

  interface Acc { attrs: Set<string>; children: Set<string>; text: boolean }
  const memo = new Map<string, Acc>();
  const inProgress = new Set<string>();

  function merge(into: Acc, from: Acc) {
    from.attrs.forEach(a => into.attrs.add(a));
    from.children.forEach(c => into.children.add(c));
    if (from.text) into.text = true;
  }

  function walk(node: Element, acc: Acc) {
    for (const k of kids(node)) {
      switch (local(k)) {
        case 'documentation': case 'annotation': case 'value': case 'data': case 'empty': case 'param':
        case 'anyName': case 'nsName': case 'name': case 'except': case 'notAllowed':
          break;
        case 'attribute': {
          const def = attrDefOf(k);
          if (def) acc.attrs.add(intern(def));
          break;
        }
        case 'text':
          acc.text = true;
          break;
        case 'mixed':
          acc.text = true;
          walk(k, acc);
          break;
        case 'element': {
          const n = k.getAttribute('name');
          if (n) acc.children.add(n);
          break;
        }
        case 'ref': {
          const refName = k.getAttribute('name') ?? '';
          const el = elementNames.get(refName);
          if (el) { acc.children.add(el); break; }
          const sub = collectDefine(refName);
          if (sub) merge(acc, sub);
          break;
        }
        default:
          walk(k, acc);
      }
    }
  }

  function collectDefine(defName: string): Acc | null {
    const cached = memo.get(defName);
    if (cached) return cached;
    const def = defines.get(defName);
    if (!def || inProgress.has(defName)) return null;
    inProgress.add(defName);
    const acc: Acc = { attrs: new Set(), children: new Set(), text: false };
    const outer = currentDefine;
    currentDefine = defName;
    walk(def, acc);
    currentDefine = outer;
    inProgress.delete(defName);
    memo.set(defName, acc);
    return acc;
  }

  // ---- elements --------------------------------------------------------------------------------

  const elements: Record<string, MeiElementDef> = {};
  elementNodes.forEach((node, defName) => {
    const name = elementNames.get(defName)!;
    const acc: Acc = { attrs: new Set(), children: new Set(), text: false };
    currentDefine = defName;
    walk(node, acc);
    currentDefine = '';
    const doc = docOf(node);
    const prev = elements[name];
    if (prev) {
      // The same element may be defined twice in a customization; the definitions add up.
      acc.attrs.forEach(a => { if (!prev.attrs.includes(a)) prev.attrs.push(a); });
      acc.children.forEach(c => { if (!prev.children.includes(c)) prev.children.push(c); });
      if (acc.text) prev.text = true;
      return;
    }
    elements[name] = {
      ...(doc ? { doc } : {}),
      attrs: [...acc.attrs],
      children: [...acc.children].sort(),
      ...(acc.text ? { text: true } : {})
    };
  });

  return {
    format: 1,
    id: meta.id,
    label: meta.label,
    schemaVersion: meta.schemaVersion,
    origin: meta.origin ?? 'bundled',
    ...(meta.source ? { source: meta.source } : {}),
    attrDefs,
    elements
  };
}

/** Parses RelaxNG text in the browser and builds the catalog. */
export function rngTextToCatalog(text: string, meta: RngCatalogMeta): MeiSchemaCatalog {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0 || doc.documentElement?.localName !== 'grammar') {
    throw new Error('The file is not a RelaxNG schema (no <grammar> root element).');
  }
  return rngToCatalog(doc, meta);
}
