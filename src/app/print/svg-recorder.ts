import type { jsPDF } from 'jspdf';
import type { PathOp } from './svg-path';

/**
 * Turns the drawing calls of a PDF export into a compact SVG, so that a picture of a chant is exactly what
 * Monodi-Zero prints: the PDF export lays everything out and draws it with jsPDF; this file wraps that jsPDF
 * document, records every drawing call (text, lines, rectangles, outlines) and writes the record as SVG.
 * Pure: no DOM, no Angular (jsPDF itself is handed in).
 *
 * Output (all lengths in pt, the unit of the PDF):
 *  - the root `<svg>` has a viewBox that fits the drawing, `fill="currentColor"` (the page's CSS colour decides),
 *    and the font size and family of most of the text;
 *  - straight lines (staff lines, ticks) of one stroke width are merged into one `<path>`;
 *  - filled rectangles (ledger lines) are merged into one `<path>`;
 *  - an outline that is drawn at least twice (note heads, clefs) is defined once in `<defs>` and placed with `<use x y>`;
 *    its `id` is derived from its shape, so two SVGs inlined in one page never clash;
 *  - text is plain `<text>`.
 * The notation colour of the export (setting `notationColor`), black and other dark colours (up to #333333 in every channel)
 * become `currentColor`; lighter colours (the grey of comment brackets) stay explicit.
 */

export interface SvgOptions {
  /** Hex colour of the notation in the export (default `#333333`); drawn as `currentColor`. */
  notationColor?: string;
  /** Space around the drawing in pt. */
  padding?: number;
  /** Pages are stacked: the ink of a page starts this far (pt) below the ink of the page before. Default 12. */
  pageGap?: number;
}

type Style = { color: string; width: number };

type Item =
  | ({ t: 'line'; page: number; x1: number; y1: number; x2: number; y2: number } & Style)
  | ({ t: 'rect'; page: number; x: number; y: number; w: number; h: number; fill: boolean; stroke: boolean } & Style)
  | ({ t: 'path'; page: number; ops: PathOp[]; fill: boolean; stroke: boolean } & Style)
  | { t: 'text'; page: number; x: number; y: number; text: string; size: number; font: string; style: string; color: string; anchor: string; charSpace: number; width: number };

/** Records what is drawn on a jsPDF document. Use `wrap()` to get the document the export draws on. */
export class SvgRecorder {
  private items: Item[] = [];
  private pending: { page: number; ops: PathOp[] } | null = null;
  private real!: jsPDF;

  /** Wraps `real`: every call goes to it unchanged, drawing calls are recorded as well. */
  wrap(real: jsPDF): jsPDF {
    this.real = real;
    const hooks: { [name: string]: (...a: any[]) => void } = {
      text: (t, x, y, o) => this.onText(t, x, y, o),
      line: (x1, y1, x2, y2) => this.items.push({ t: 'line', page: this.page(), x1, y1, x2, y2, ...this.stroke() }),
      rect: (x, y, w, h, style) => this.onRect(x, y, w, h, style),
      path: (ops) => { this.pending = { page: this.page(), ops: ops as PathOp[] }; },
      fillEvenOdd: () => this.paintPath(true, false),
      fill: () => this.paintPath(true, false),
      stroke: () => this.paintPath(false, true),
    };
    return new Proxy(real, {
      get: (target, prop) => {
        const v = (target as any)[prop];
        if (typeof v !== 'function') return v;
        const hook = typeof prop === 'string' ? hooks[prop] : undefined;
        return (...args: any[]) => {
          if (hook) hook(...args);
          return v.apply(target, args);
        };
      },
    });
  }

  get isEmpty(): boolean { return this.items.length === 0; }

  private page(): number { return this.real.getCurrentPageInfo().pageNumber; }
  private stroke(): Style { return { color: this.real.getDrawColor(), width: this.real.getLineWidth() }; }

  private onRect(x: number, y: number, w: number, h: number, style?: string | null): void {
    const st = (style || 'S').toUpperCase();
    const fill = st.includes('F');
    const stroke = st === 'S' || st.includes('D');
    this.items.push({ t: 'rect', page: this.page(), x, y, w, h, fill, stroke, color: fill && !stroke ? this.real.getFillColor() : this.real.getDrawColor(), width: this.real.getLineWidth() });
  }

  private paintPath(fill: boolean, stroke: boolean): void {
    if (!this.pending) return;
    const { page, ops } = this.pending;
    this.pending = null;
    this.items.push({ t: 'path', page, ops, fill, stroke, color: fill ? this.real.getFillColor() : this.real.getDrawColor(), width: this.real.getLineWidth() });
  }

  private onText(text: string | string[], x: number, y: number, o?: { align?: string; charSpace?: number }): void {
    const d = this.real;
    const font = d.getFont();
    const size = d.getFontSize();
    const lines = Array.isArray(text) ? text : [String(text)];
    lines.forEach((line, i) => {
      if (line === '') return;
      this.items.push({
        t: 'text', page: this.page(), x, y: y + i * size * d.getLineHeightFactor(), text: line, size, font: font.fontName, style: font.fontStyle,
        color: d.getTextColor(), anchor: o?.align === 'center' ? 'middle' : o?.align === 'right' ? 'end' : 'start', charSpace: o?.charSpace ?? 0, width: d.getTextWidth(line),
      });
    });
  }

  /** The record as SVG text, or '' when nothing was drawn. */
  toSvg(opts: SvgOptions = {}): string { return buildSvg(this.items, opts); }
}

// ── number and path formatting ───────────────────────────────────────────────────────────────

const r2 = (v: number): number => Math.round(v * 100) / 100;

/**
 * A number with at most `decimals` decimals (shapes: 2; positions: 1, a tenth of a point is 0.035 mm), without a leading zero
 * (".5"): the shortest SVG spelling.
 */
export function fmt(v: number, decimals = 2): string {
  const k = 10 ** decimals;
  let s = String(Math.round(v * k) / k + 0);
  if (s === '-0') s = '0';
  return s.replace(/^(-?)0\./, '$1.');
}

/** Numbers joined with the shortest separators ("1-2", "1.5.5", "1 2"). */
function join(values: number[], decimals = 2): string {
  let out = '';
  for (const v of values) {
    const s = fmt(v, decimals);
    if (out === '') out = s;
    else if (s.startsWith('-')) out += s;
    else if (s.startsWith('.') && /\.\d*$/.test(out)) out += s;
    else out += ' ' + s;
  }
  return out;
}

/**
 * Path data of an outline without its first move, in relative commands (compact). The first point of `ops` is the origin,
 * so the same shape drawn at another place gives the same string; the caller supplies the start.
 */
function shapeRest(ops: PathOp[]): string {
  const [ox, oy] = ops[0].c;
  const at = (x: number, y: number): [number, number] => [r2(x - ox), r2(y - oy)];
  let out = '';
  let last = '';
  let cx = 0, cy = 0, sx = 0, sy = 0;   // current point and sub-path start, rounded like the output
  const emit = (cmd: string, values: number[]) => { out += (cmd === last && cmd !== 'z' ? ' ' : cmd) + join(values); last = cmd; };
  for (const o of ops.slice(1)) {
    if (o.op === 'm') {
      const [x, y] = at(o.c[0], o.c[1]);
      emit('m', [x - cx, y - cy]);
      cx = x; cy = y; sx = x; sy = y;
    } else if (o.op === 'l') {
      const [x, y] = at(o.c[0], o.c[1]);
      emit('l', [x - cx, y - cy]);
      cx = x; cy = y;
    } else if (o.op === 'c') {
      const p = [at(o.c[0], o.c[1]), at(o.c[2], o.c[3]), at(o.c[4], o.c[5])];
      emit('c', [p[0][0] - cx, p[0][1] - cy, p[1][0] - cx, p[1][1] - cy, p[2][0] - cx, p[2][1] - cy]);
      cx = p[2][0]; cy = p[2][1];
    } else {
      emit('z', []);
      cx = sx; cy = sy;
    }
  }
  return out;
}

/** Hash of a string as 6 base-36 characters, for ids that depend only on the shape. */
function shortHash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36).padStart(6, '0');
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const attr = (s: string) => esc(s).replace(/"/g, '&quot;');

/** `#rrggbb` as drawn: the notation colour, black and the other dark colours of the export (titles, running text) → null (= currentColor); greys stay explicit. */
function themed(hex: string, notation: string): string | null {
  const h = (hex || '').toLowerCase();
  if (h === notation) return null;
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/.exec(h);
  return m && Math.max(parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)) <= 0x33 ? null : h;
}

const FAMILIES: { [pdf: string]: string } = {
  crimsontext: '"Crimson Text",Georgia,serif', notosans: '"Noto Sans",sans-serif', helvetica: 'Helvetica,Arial,sans-serif', times: '"Times New Roman",Times,serif',
};
const familyOf = (pdfName: string) => FAMILIES[pdfName.replace(/\s+/g, '').toLowerCase()] ?? `${pdfName},serif`;

function buildSvg(itemsIn: Item[], opts: SvgOptions): string {
  if (itemsIn.length === 0) return '';
  const notation = (opts.notationColor ?? '#333333').toLowerCase();
  const pad = opts.padding ?? 4;
  const gap = opts.pageGap ?? 12;

  const boundsOf = (it: Item, grow: (x: number, y: number) => void): void => {
    if (it.t === 'line') { const h = it.width / 2; grow(it.x1 - h, it.y1 - h); grow(it.x2 + h, it.y2 + h); }
    else if (it.t === 'rect') { grow(it.x, it.y); grow(it.x + it.w, it.y + it.h); }
    else if (it.t === 'path') { const h = it.stroke ? it.width / 2 : 0; for (let k = 0; k < it.ops.length; k++) for (let j = 0; j < it.ops[k].c.length; j += 2) { grow(it.ops[k].c[j] - h, it.ops[k].c[j + 1] - h); grow(it.ops[k].c[j] + h, it.ops[k].c[j + 1] + h); } }
    else {
      const left = it.anchor === 'middle' ? it.x - it.width / 2 : it.anchor === 'end' ? it.x - it.width : it.x;
      grow(left, it.y - it.size * 0.75); grow(left + it.width, it.y + it.size * 0.25);
    }
  };

  // stack pages: the ink of each page starts `gap` below the ink of the page before (the page margins and the empty rest of a page are left out)
  const pageTop = new Map<number, number>(), pageBottom = new Map<number, number>();
  for (const it of itemsIn) {
    boundsOf(it, (_x, y) => {
      pageTop.set(it.page, Math.min(pageTop.get(it.page) ?? Infinity, y));
      pageBottom.set(it.page, Math.max(pageBottom.get(it.page) ?? -Infinity, y));
    });
  }
  const offset = new Map<number, number>();
  let bottom = 0, first = true;
  for (const pg of [...pageTop.keys()].sort((a, b) => a - b)) {
    const dy = first ? 0 : bottom + gap - pageTop.get(pg)!;
    offset.set(pg, dy);
    bottom = pageBottom.get(pg)! + dy;
    first = false;
  }
  const items = itemsIn.map((it) => {
    const dy = offset.get(it.page) ?? 0;
    if (!dy) return it;
    switch (it.t) {
      case 'line': return { ...it, y1: it.y1 + dy, y2: it.y2 + dy };
      case 'rect': return { ...it, y: it.y + dy };
      case 'path': return { ...it, ops: it.ops.map((o) => ({ op: o.op, c: o.c.map((v, k) => (k % 2 ? v + dy : v)) })) };
      default: return { ...it, y: it.y + dy };
    }
  });

  // bounding box
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const grow = (x: number, y: number) => { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); };
  for (const it of items) boundsOf(it, grow);
  const ox = Math.floor(x0 - pad), oy = Math.floor(y0 - pad);
  const W = Math.ceil(x1 + pad) - ox, H = Math.ceil(y1 + pad) - oy;
  const X = (v: number) => v - ox, Y = (v: number) => v - oy;

  const body: string[] = [];
  const defs: string[] = [];

  // straight lines: a run of equally spaced, equally long horizontal lines (a staff) is defined once per spacing and placed with
  // <use>; every other line goes into one path per (colour, width)
  const lineGroups = new Map<string, { color: string | null; width: number; d: string }>();
  const addTo = (map: Map<string, { color: string | null; width: number; d: string }>, color: string | null, width: number, extra: string, d: string) => {
    const key = `${color}|${width}|${extra}`;
    const g = map.get(key) ?? { color, width, d: '' };
    g.d += d;
    map.set(key, g);
  };
  const lines = items.filter((i): i is Extract<Item, { t: 'line' }> => i.t === 'line');
  const staffDefs = new Map<string, string>();
  const flushRun = (run: typeof lines) => {
    const color = themed(run[0].color, notation);
    if (run.length >= 3) {
      const step = r2(run[1].y1 - run[0].y1);
      const key = `${run.length}|${step}|${run[0].width}|${color}`;
      let id = staffDefs.get(key);
      if (!id) {
        id = 's' + shortHash(key).slice(0, 3);
        staffDefs.set(key, id);
        let d = '';
        for (let k = 0; k < run.length; k++) d += `M0 ${fmt(k * step)}H1`;
        defs.push(`<path id="${id}" d="${d}" fill="none" stroke="${color ?? 'currentColor'}"${run[0].width !== 1 ? ` stroke-width="${fmt(run[0].width)}"` : ''}/>`);
      }
      const w = run[0].x2 - run[0].x1;
      body.push(`<use href="#${id}" transform="matrix(${join([w], 2)} 0 0 1 ${join([X(run[0].x1), Y(run[0].y1)], 1)})"/>`);
    } else {
      for (const it of run) addTo(lineGroups, color, it.width, '', `M${join([X(it.x1), Y(it.y1)], 1)}` + (it.y1 === it.y2 ? `H${fmt(X(it.x2), 1)}` : it.x1 === it.x2 ? `V${fmt(Y(it.y2), 1)}` : `L${join([X(it.x2), Y(it.y2)], 1)}`));
    }
  };
  let run: typeof lines = [];
  for (const it of lines) {
    const prev = run[run.length - 1];
    const continues = prev && it.y1 === it.y2 && prev.y1 === prev.y2 && it.x1 === prev.x1 && it.x2 === prev.x2 && it.width === prev.width && it.color === prev.color
      && (run.length === 1 || Math.abs(it.y1 - prev.y1 - (prev.y1 - run[run.length - 2].y1)) < 0.005) && it.y1 > prev.y1;
    if (continues) run.push(it);
    else { if (run.length) flushRun(run); run = [it]; }
  }
  if (run.length) flushRun(run);
  for (const g of lineGroups.values()) {
    body.push(`<path d="${g.d}" fill="none" stroke="${g.color ?? 'currentColor'}"${g.width !== 1 ? ` stroke-width="${fmt(g.width)}"` : ''}/>`);
  }

  // filled rectangles: one path per colour; stroked rectangles are lines of their own outline
  const rectFills = new Map<string, { color: string | null; width: number; d: string }>();
  for (const it of items) {
    if (it.t !== 'rect') continue;
    if (it.fill && !it.stroke) addTo(rectFills, themed(it.color, notation), 0, '', `M${join([X(it.x), Y(it.y)], 1)}h${fmt(it.w)}v${fmt(it.h)}h${fmt(-it.w)}z`);
    else if (it.stroke) addTo(lineGroups, themed(it.color, notation), it.width, 'r', `M${join([X(it.x), Y(it.y)], 1)}h${fmt(it.w)}v${fmt(it.h)}h${fmt(-it.w)}z`);
  }
  for (const g of rectFills.values()) body.push(`<path d="${g.d}"${g.color ? ` fill="${g.color}"` : ''}/>`);

  // outlines
  const filled: { shape: string; x: number; y: number; color: string | null }[] = [];
  const stroked = new Map<string, { color: string | null; width: number; d: string }>();
  for (const it of items) {
    if (it.t !== 'path' || it.ops.length === 0 || it.ops[0].op !== 'm') continue;
    const [px, py] = it.ops[0].c;
    if (it.fill) filled.push({ shape: shapeRest(it.ops), x: X(px), y: Y(py), color: themed(it.color, notation) });
    if (it.stroke) addTo(stroked, themed(it.color, notation), it.width, '', `M${join([X(px), Y(py)], 1)}${shapeRest(it.ops)}`);
  }
  for (const g of stroked.values()) {
    body.push(`<path d="${g.d}" fill="none" stroke="${g.color ?? 'currentColor'}" stroke-width="${fmt(g.width)}" stroke-linejoin="round"/>`);
  }
  const uses = new Map<string, number>();
  for (const f of filled) uses.set(f.shape, (uses.get(f.shape) ?? 0) + 1);
  const defined = new Set<string>();
  for (const f of filled) {
    const color = f.color ? ` fill="${f.color}"` : '';
    if ((uses.get(f.shape) ?? 0) >= 2) {
      const id = 'g' + shortHash(f.shape).slice(0, 4);
      if (!defined.has(id)) { defined.add(id); defs.push(`<path id="${id}" fill-rule="evenodd" d="M0 0${f.shape}"/>`); }
      body.push(`<use href="#${id}"${f.x ? ` x="${fmt(f.x, 1)}"` : ''}${f.y ? ` y="${fmt(f.y, 1)}"` : ''}${color}/>`);
    } else {
      // a single outline: its first point is absolute
      body.push(`<path fill-rule="evenodd" d="M${join([f.x, f.y], 1)}${f.shape}"${color}/>`);
    }
  }

  // text: the most common size and family go on the root
  const texts = items.filter((i): i is Extract<Item, { t: 'text' }> => i.t === 'text');
  const mode = <T>(xs: T[]): T | undefined => { const m = new Map<T, number>(); for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1); return [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]; };
  const baseSize = mode(texts.map((t) => t.size)) ?? 10;
  const baseFont = mode(texts.map((t) => t.font)) ?? '';
  for (const t of texts) {
    const a: string[] = [`x="${fmt(X(t.x), 1)}"`, `y="${fmt(Y(t.y), 1)}"`];
    if (t.size !== baseSize) a.push(`font-size="${fmt(t.size)}"`);
    if (t.font !== baseFont) a.push(`font-family="${attr(familyOf(t.font))}"`);
    if (/bold/.test(t.style)) a.push('font-weight="bold"');
    if (/italic/.test(t.style)) a.push('font-style="italic"');
    if (t.anchor !== 'start') a.push(`text-anchor="${t.anchor}"`);
    if (t.charSpace) a.push(`letter-spacing="${fmt(t.charSpace)}"`);
    const c = themed(t.color, notation);
    if (c) a.push(`fill="${c}"`);
    body.push(`<text ${a.join(' ')}>${esc(t.text)}</text>`);
  }

  const rootText = texts.length ? ` font-size="${fmt(baseSize)}" font-family="${attr(familyOf(baseFont))}"` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" fill="currentColor"${rootText}>`
    + (defs.length ? `<defs>${defs.join('')}</defs>` : '') + body.join('') + '</svg>';
}
