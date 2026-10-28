/**
 * Small DOM writer for the mapped MEI header: creates elements from the spec's path strings, then repairs the result
 * (drops empty elements, adds the few elements the MEI schema requires, sorts children into schema order).
 *
 * Path syntax (see CM-hub/docs/METADATA-STANDARDS.md, section 4): steps separated by `/`, each step an element name with
 * optional predicates `[@name='value']`; the last step may be an attribute `@name`. A path that starts with `@` sets an
 * attribute on the root element (meiHead). The last element step always creates a new element; earlier steps reuse an
 * existing child with the same name and predicate attributes.
 */
export const MEI_NS = 'http://www.music-encoding.org/ns/mei';

interface Step { name: string; attrs: [string, string][] }

const STEP = /^([A-Za-z][A-Za-z0-9]*)((?:\[@[A-Za-z:.]+(?:='[^']*')?\])*)$/;
const PRED = /\[@([A-Za-z:.]+)(?:='([^']*)')?\]/g;

export function parsePath(path: string): { steps: Step[]; attr?: string } {
  const parts = path.split('/').filter(p => p.length > 0);
  let attr: string | undefined;
  if (parts.length && parts[parts.length - 1].startsWith('@')) {
    attr = parts.pop()!.slice(1);
  }
  const steps = parts.map(p => {
    const m = STEP.exec(p);
    if (!m) throw new Error(`Unsupported path step "${p}" in "${path}"`);
    const attrs: [string, string][] = [];
    let pm: RegExpExecArray | null;
    PRED.lastIndex = 0;
    // A predicate without a value (for example [@startid]) only states that the attribute exists; it sets nothing.
    while ((pm = PRED.exec(m[2])) !== null) if (pm[2] !== undefined) attrs.push([pm[1], pm[2]]);
    return { name: m[1], attrs };
  });
  return { steps, attr };
}

/** Child order required by the bundled MEI 5.0 schema (mei-all.rng) for the parents the header writes. Unknown names keep their place behind the known ones. */
export const CHILD_ORDER: Record<string, string[]> = {
  meiHead: ['altId', 'fileDesc', 'encodingDesc', 'workList', 'manifestationList', 'extMeta', 'revisionDesc'],
  fileDesc: ['titleStmt', 'editionStmt', 'extent', 'pubStmt', 'seriesStmt', 'notesStmt', 'sourceDesc'],
  titleStmt: ['title', 'respStmt'],
  work: ['identifier', 'title', 'respStmt', 'incip', 'otherChar', 'creation', 'history', 'langUsage', 'perfMedium', 'perfDuration',
    'audience', 'contents', 'context', 'biblList', 'notesStmt', 'classification', 'expressionList', 'componentList', 'relationList', 'extMeta'],
  manifestation: ['identifier', 'titleStmt', 'creation', 'history', 'langUsage', 'contents', 'biblList', 'notesStmt', 'classification', 'itemList',
    'componentList', 'relationList', 'extMeta'],
  item: ['identifier', 'availability', 'physDesc', 'physLoc', 'history', 'notesStmt', 'classification', 'componentList', 'relationList', 'extMeta'],
  encodingDesc: ['appInfo', 'editorialDecl', 'projectDesc', 'samplingDecl', 'domainsDecl', 'tagsDecl', 'classDecls'],
  seriesStmt: ['title', 'respStmt', 'funder', 'identifier', 'biblScope', 'contents', 'seriesStmt']
};

export class HeaderWriter {
  readonly root: Element;

  constructor(readonly doc: Document, rootName: string, private readonly aliases: Record<string, string>) {
    this.root = doc.createElementNS(MEI_NS, rootName);
  }

  el(name: string, text?: string, attrs?: Record<string, string>): Element {
    const e = this.doc.createElementNS(MEI_NS, name);
    if (text !== undefined) e.textContent = text;
    if (attrs) for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    return e;
  }

  /** Expands `{alias}` placeholders. */
  expand(path: string): string {
    return path.replace(/\{([^{}]+)\}/g, (_m, name: string) => {
      const target = this.aliases[name];
      if (target === undefined) throw new Error(`Unknown alias {${name}} in "${path}"`);
      return target;
    });
  }

  /** Finds or creates the element for all steps; `createLast` forces a new element for the last step. */
  ensure(path: string, createLast: boolean): Element {
    const { steps } = parsePath(this.expand(path));
    let cur = this.root;
    steps.forEach((step, i) => {
      const last = i === steps.length - 1;
      let next: Element | undefined;
      if (!(last && createLast)) {
        next = Array.from(cur.children).find(c => c.localName === step.name && step.attrs.every(([k, v]) => c.getAttribute(k) === v));
      }
      if (!next) {
        next = this.el(step.name);
        step.attrs.forEach(([k, v]) => next!.setAttribute(k, v));
        cur.appendChild(next);
      }
      cur = next;
    });
    return cur;
  }

  /** Writes a text value (or an attribute, if the path ends in `@name`). Returns the element written to. */
  put(path: string, value: string, extraAttrs?: Record<string, string>): Element {
    const { attr } = parsePath(this.expand(path));
    if (attr !== undefined) {
      const owner = this.ensure(path.replace(/\/?@[A-Za-z:.]+$/, ''), false);
      owner.setAttribute(attr, value);
      return owner;
    }
    const e = this.ensure(path, true);
    e.textContent = value;
    if (extraAttrs) for (const [k, v] of Object.entries(extraAttrs)) e.setAttribute(k, v);
    return e;
  }

  /** Drops empty elements, adds the elements the schema requires, sorts children into schema order. */
  finish(fallbackTitle: string): void {
    this.prune(this.root);
    this.ensureRequired(fallbackTitle);
    this.sort(this.root);
  }

  private isEmpty(e: Element): boolean {
    return e.children.length === 0 && (e.textContent ?? '').trim() === '' && e.attributes.length === 0;
  }

  private prune(e: Element): void {
    for (const child of Array.from(e.children)) {
      this.prune(child);
      if (this.isEmpty(child)) e.removeChild(child);
    }
  }

  private child(parent: Element, name: string): Element | undefined {
    return Array.from(parent.children).find(c => c.localName === name);
  }

  private ensureRequired(fallbackTitle: string): void {
    const fileDesc = this.child(this.root, 'fileDesc') ?? this.root.appendChild(this.el('fileDesc'));
    const titleStmt = this.child(fileDesc as Element, 'titleStmt') ?? (fileDesc as Element).appendChild(this.el('titleStmt'));
    if (!this.child(titleStmt as Element, 'title')) (titleStmt as Element).appendChild(this.el('title', fallbackTitle));
    if (!this.child(fileDesc as Element, 'pubStmt')) (fileDesc as Element).appendChild(this.el('pubStmt'));

    const work = this.child(this.child(this.root, 'workList') ?? this.root, 'work');
    if (work && !this.child(work, 'title')) {
      const id = this.child(work, 'identifier')?.textContent?.trim();
      work.appendChild(this.el('title', id || fallbackTitle));
    }
    const series = this.child(fileDesc as Element, 'seriesStmt');
    if (series && !this.child(series, 'title')) (fileDesc as Element).removeChild(series);
  }

  private sort(e: Element): void {
    const order = CHILD_ORDER[e.localName];
    Array.from(e.children).forEach(c => this.sort(c));
    if (!order) return;
    const rank = (c: Element) => { const i = order.indexOf(c.localName); return i < 0 ? order.length : i; };
    const sorted = Array.from(e.children).map((c, i) => ({ c, i })).sort((a, b) => rank(a.c) - rank(b.c) || a.i - b.i);
    sorted.forEach(({ c }) => e.appendChild(c));
  }
}
