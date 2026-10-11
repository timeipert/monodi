/**
 * A small Markdown subset shared by the editor preview (HTML) and the PDF (typeset from the
 * blocks), so both show the same thing. Supported: headings (#), paragraphs, bullet and numbered
 * lists (nested by indentation), block quotes, fenced code, horizontal rules, pipe tables, images
 * (`![caption](url)`; also by reference, `![caption][img-1]` with `[img-1]: data:image/…` at the end,
 * which is how the editor embeds uploaded pictures), and the inline forms **bold**, *italic*,
 * `code` and [links](url). Anything else stays plain text.
 */
export interface MdImage { src: string; alt: string; title?: string }
export interface MdInline { t: string; bold?: boolean; italic?: boolean; code?: boolean; href?: string; img?: MdImage }
export type MdAlign = 'left' | 'center' | 'right' | null;
type Refs = Map<string, { src: string; title?: string }>;

export interface MdListItem { inlines: MdInline[]; blocks: MdBlock[] }

export type MdBlock =
  | { kind: 'heading'; level: number; inlines: MdInline[] }
  | { kind: 'paragraph'; inlines: MdInline[] }
  | { kind: 'list'; ordered: boolean; start: number; items: MdListItem[] }
  | { kind: 'quote'; blocks: MdBlock[] }
  | { kind: 'code'; text: string }
  | { kind: 'table'; align: MdAlign[]; head: MdInline[][]; rows: MdInline[][][] }
  | { kind: 'image'; src: string; alt: string; title?: string }
  | { kind: 'rule' };

const ESCAPABLE = /[\\`*_{}\[\]()#+\-.!>~|]/;

/** Closing marker of an emphasis run: not preceded by whitespace, not part of a longer run. */
function findClose(s: string, mark: string, from: number): number {
  const c = mark[0];
  for (let j = from; j <= s.length - mark.length; j++) {
    if (s[j] === '\\') { j++; continue; }
    if (!s.startsWith(mark, j) || j === from || /\s/.test(s[j - 1])) continue;
    if (mark.length === 1 && (s[j + 1] === c || s[j - 1] === c)) continue;
    if (c === '_' && /[\p{L}\p{N}]/u.test(s[j + mark.length] ?? '')) continue;   // snake_case stays
    return j;
  }
  return -1;
}

/**
 * The address (and optional "title") inside `(…)` of a link or image. Whitespace in the address
 * is dropped: text copied from word processors wraps long addresses over several lines.
 */
function destination(raw: string): { url: string; title?: string } | null {
  const t = /\s+"([^"]*)"\s*$/.exec(raw);
  const url = (t ? raw.slice(0, t.index) : raw).replace(/\s+/g, '').replace(/^<|>$/g, '');
  return url ? { url, title: t?.[1] } : null;
}

export function parseInline(src: string, refs?: Refs): MdInline[] {
  const out: MdInline[] = [];
  const walk = (s: string, st: { bold?: boolean; italic?: boolean; href?: string }): void => {
    let buf = '';
    const flush = () => { if (buf) { out.push({ t: buf, ...st }); buf = ''; } };
    let i = 0;
    while (i < s.length) {
      const c = s[i];
      if (c === '\\' && i + 1 < s.length && ESCAPABLE.test(s[i + 1])) { buf += s[i + 1]; i += 2; continue; }
      if (c === '\\' && s[i + 1] === '\n') { flush(); out.push({ t: '\n' }); i += 2; continue; }
      if (c === '`') {
        const j = s.indexOf('`', i + 1);
        if (j > i + 1) { flush(); out.push({ t: s.slice(i + 1, j), ...st, code: true }); i = j + 1; continue; }
      }
      if ((c === '*' || c === '_') && !/\s/.test(s[i + 1] ?? ' ')
          && !(c === '_' && i > 0 && /[\p{L}\p{N}]/u.test(s[i - 1]))) {
        let done = false;
        for (const n of [3, 2, 1]) {
          const mark = c.repeat(n);
          if (!s.startsWith(mark, i)) continue;
          const j = findClose(s, mark, i + n);
          if (j < 0) continue;
          flush();
          walk(s.slice(i + n, j), { ...st, ...(n >= 2 ? { bold: true } : {}), ...(n !== 2 ? { italic: true } : {}) });
          i = j + n;
          done = true;
          break;
        }
        if (done) continue;
      }
      if (c === '!' && s[i + 1] === '[') {
        const rest = s.slice(i + 1);
        const m = /^\[([^\]]*)\]\(((?:[^()]|\([^()]*\))*)\)/.exec(rest);
        const d = m && destination(m[2]);
        if (m && d) { flush(); out.push({ t: '', img: { src: d.url, alt: m[1], title: d.title } }); i += 1 + m[0].length; continue; }
        const r = /^\[([^\]]*)\]\[([^\]]*)\]/.exec(rest);
        const ref = r && refs?.get((r[2] || r[1]).toLowerCase());
        if (r && ref) { flush(); out.push({ t: '', img: { src: ref.src, alt: r[1], title: ref.title } }); i += 1 + r[0].length; continue; }
      }
      if (c === '[') {
        const m = /^\[([^\]]+)\]\(((?:[^()]|\([^()]*\))*)\)/.exec(s.slice(i));
        const d = m && destination(m[2]);
        if (m && d) { flush(); walk(m[1], { ...st, href: d.url }); i += m[0].length; continue; }
        const r = /^\[([^\]]+)\]\[([^\]]*)\]/.exec(s.slice(i));
        const ref = r && refs?.get((r[2] || r[1]).toLowerCase());
        if (r && ref) { flush(); walk(r[1], { ...st, href: ref.src }); i += r[0].length; continue; }
      }
      if (c === '\n') {
        // two trailing spaces force a line break; otherwise the line break is a space
        if (/ {2,}$/.test(buf)) { buf = buf.replace(/ +$/, ''); flush(); out.push({ t: '\n' }); }
        else buf += ' ';
        i++;
        continue;
      }
      buf += c;
      i++;
    }
    flush();
  };
  walk(src, {});
  return out;
}

const indentOf = (l: string) => (/^[ \t]*/.exec(l)![0].replace(/\t/g, '    ')).length;
const LIST_RE = /^([ \t]*)([-*+]|\d{1,9}[.)])[ \t]+(.*)$/;
const isBlank = (l: string) => !l.trim();

const REF_DEF = /^ {0,3}\[([^\]^][^\]]*)\]:[ \t]*(\S+)(?:[ \t]+"([^"]*)")?[ \t]*$/;

export function parseMarkdown(text: string): MdBlock[] {
  const all = (text || '').replace(/\r\n?/g, '\n').split('\n');
  // reference definitions (`[id]: url`) are taken out first; they may stand anywhere outside code
  const refs: Refs = new Map();
  const lines: string[] = [];
  let fenced = false;
  for (const l of all) {
    if (/^\s*(```|~~~)/.test(l)) fenced = !fenced;
    const m = !fenced ? REF_DEF.exec(l) : null;
    if (m) refs.set(m[1].trim().toLowerCase(), { src: m[2].replace(/^<|>$/g, ''), title: m[3] });
    else lines.push(l);
  }
  return parseLines(unwrapTableRows(lines), refs);
}

/** An image in the middle of text becomes a picture of its own between two paragraphs. */
function paragraphBlocks(ins: MdInline[]): MdBlock[] {
  if (!ins.some((x) => x.img)) return [{ kind: 'paragraph', inlines: ins }];
  const out: MdBlock[] = [];
  let cur: MdInline[] = [];
  const flush = () => {
    if (cur.some((x) => x.t.trim() || x.code)) out.push({ kind: 'paragraph', inlines: cur.filter((x, k) => !(x.t === '\n' && (k === 0 || k === cur.length - 1))) });
    cur = [];
  };
  for (const x of ins) {
    if (x.img) { flush(); out.push({ kind: 'image', src: x.img.src, alt: x.img.alt, title: x.img.title }); }
    else cur.push(x);
  }
  flush();
  return out;
}

/** Images where only text fits (headings, table cells): their description stands in. */
function plainInlines(ins: MdInline[]): MdInline[] {
  return ins.map((x) => (x.img ? { t: x.img.alt || x.img.title || '' } : x));
}

// ── pipe tables ──

/**
 * A table row that was hard-wrapped (text copied from a word processor): a line that starts
 * with `|` but does not end with one runs on until a line that does. Such lines are joined with a
 * space. Left alone if no line closes the row soon, so ordinary text is never swallowed.
 */
function unwrapTableRows(lines: string[]): string[] {
  const closed = (l: string) => /(?<!\\)\|\s*$/.test(l);
  const out: string[] = [];
  let fenced = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^\s*(```|~~~)/.test(l)) fenced = !fenced;
    if (fenced || !/^\s*\|/.test(l) || closed(l)) { out.push(l); continue; }
    let j = i + 1;
    while (j < lines.length && j <= i + 12 && !isBlank(lines[j]) && !closed(lines[j])) j++;
    if (j < lines.length && j <= i + 12 && !isBlank(lines[j]) && closed(lines[j])) {
      out.push(lines.slice(i, j + 1).map((x) => x.trim()).join(' '));
      i = j;
    } else out.push(l);
  }
  return out;
}

const isSeparatorRow = (cells: string[]) => cells.length > 0 && cells.every((c) => SEP_CELL.test(c));
const SEP_CELL = /^:?-+:?$/;

function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const cells: string[] = [];
  let cur = '';
  let inCode = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '\\' && s[i + 1] === '|') { cur += '|'; i++; }
    else if (ch === '`') { inCode = !inCode; cur += ch; }
    else if (ch === '|' && !inCode) { cells.push(cur); cur = ''; }
    else cur += ch;
  }
  cells.push(cur);
  return cells.map((c) => c.trim());
}

function isTableStart(lines: string[], i: number): boolean {
  if (i + 1 >= lines.length || !lines[i].includes('|') || !lines[i + 1].includes('-')) return false;
  const sep = splitRow(lines[i + 1]);
  return sep.length > 0 && sep.every((c) => SEP_CELL.test(c)) && splitRow(lines[i]).length === sep.length;
}

function parseTable(lines: string[], from: number, refs: Refs): { block: MdBlock; next: number } {
  const sep = splitRow(lines[from + 1]);
  const align: MdAlign[] = sep.map((c) => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : c.startsWith(':') ? 'left' : null));
  const n = sep.length;
  const cell = (c: string) => plainInlines(parseInline(c, refs));
  const fit = (cells: string[]) => Array.from({ length: n }, (_, k) => cell(cells[k] ?? ''));
  const rows: MdInline[][][] = [];
  let i = from + 2;
  while (i < lines.length && !isBlank(lines[i]) && !/^\s{0,3}(#{1,6}[ \t]|>|```|~~~)/.test(lines[i])) {
    const cells = splitRow(lines[i++]);
    if (!isSeparatorRow(cells)) rows.push(fit(cells));    // a repeated "| --- | --- |" line is not a row
  }
  return { block: { kind: 'table', align, head: fit(splitRow(lines[from])), rows }, next: i };
}

function parseLines(lines: string[], refs: Refs): MdBlock[] {
  const blocks: MdBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) { i++; continue; }

    const fence = /^\s*(```|~~~)/.exec(line);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) body.push(lines[i++]);
      i++;
      blocks.push({ kind: 'code', text: body.join('\n') });
      continue;
    }
    const h = /^\s{0,3}(#{1,6})[ \t]+(.*?)[ \t]*#*[ \t]*$/.exec(line);
    if (h) { blocks.push({ kind: 'heading', level: h[1].length, inlines: plainInlines(parseInline(h[2], refs)) }); i++; continue; }
    if (/^\s{0,3}([-*_])([ \t]*\1){2,}[ \t]*$/.test(line)) { blocks.push({ kind: 'rule' }); i++; continue; }

    if (/^\s{0,3}>/.test(line)) {
      const inner: string[] = [];
      while (i < lines.length && /^\s{0,3}>/.test(lines[i])) inner.push(lines[i++].replace(/^\s{0,3}>[ ]?/, ''));
      blocks.push({ kind: 'quote', blocks: parseLines(inner, refs) });
      continue;
    }

    if (isTableStart(lines, i)) {
      const t = parseTable(lines, i, refs);
      blocks.push(t.block);
      i = t.next;
      continue;
    }

    const li = LIST_RE.exec(line);
    if (li) {
      const base = indentOf(line);
      const ordered = /\d/.test(li[2]);
      const items: MdListItem[] = [];
      const start = ordered ? parseInt(li[2], 10) : 1;
      while (i < lines.length) {
        const m = LIST_RE.exec(lines[i]);
        if (!m || indentOf(lines[i]) !== base || /\d/.test(m[2]) !== ordered) break;
        const first = m[3];
        i++;
        // the item goes on with deeper lines (nested lists, continued text)
        const rest: string[] = [];
        while (i < lines.length && (isBlank(lines[i]) ? (i + 1 < lines.length && indentOf(lines[i + 1]) > base && !isBlank(lines[i + 1])) : indentOf(lines[i]) > base)) rest.push(lines[i++]);
        // text continued without a marker belongs to the item's first paragraph
        let k = 0;
        const more: string[] = [];
        while (k < rest.length && !isBlank(rest[k]) && !LIST_RE.test(rest[k])) more.push(rest[k++].trim());
        const tail = rest.slice(k);
        const depths = tail.filter((l) => !isBlank(l)).map(indentOf);
        const cut = depths.length ? Math.min(...depths) : 0;
        const sub = parseLines(tail.map((l) => (isBlank(l) ? '' : l.replace(/\t/g, '    ').slice(cut))), refs);
        // pictures in the text of an item stand below it
        const lifted = paragraphBlocks(parseInline([first, ...more].join('\n'), refs));
        let inlines: MdInline[] = [];
        if (lifted[0]?.kind === 'paragraph') inlines = (lifted.shift() as { inlines: MdInline[] }).inlines;
        const blocksOut: MdBlock[] = [...lifted, ...sub];
        items.push({ inlines, blocks: blocksOut });
      }
      blocks.push({ kind: 'list', ordered, start, items });
      continue;
    }

    // paragraph: runs to the next blank line or the start of another block
    const para: string[] = [];
    while (i < lines.length && !isBlank(lines[i])
      && !/^\s{0,3}(#{1,6}[ \t]|>|```|~~~)/.test(lines[i]) && !LIST_RE.test(lines[i])
      && !/^\s{0,3}([-*_])([ \t]*\1){2,}[ \t]*$/.test(lines[i]) && !isTableStart(lines, i)) para.push(lines[i++].replace(/^\s+/, ''));
    if (!para.length) para.push(lines[i++]);
    blocks.push(...paragraphBlocks(parseInline(para.join('\n'), refs)));
  }
  return blocks;
}

// ── HTML (editor preview) ──────────────────────────────────────────────────────────────────

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Only web and mail links are made clickable; anything else (javascript: …) stays text. */
export function safeHref(href: string): string | null {
  return /^(https?:\/\/|mailto:|#|\/)/i.test(href.trim()) ? href.trim() : null;
}

/** Pictures: web addresses and embedded raster images only. */
export function safeSrc(src: string): string | null {
  return /^(https?:\/\/|data:image\/(png|jpe?g|gif|webp);base64,)/i.test(src.trim()) ? src.trim() : null;
}

function inlinesHtml(ins: MdInline[]): string {
  return ins.map((x) => {
    if (x.img) return esc(x.img.alt);
    if (x.t === '\n' && !x.bold && !x.italic && !x.code) return '<br>';
    let h = esc(x.t);
    if (x.code) h = '<code>' + h + '</code>';
    if (x.italic) h = '<em>' + h + '</em>';
    if (x.bold) h = '<strong>' + h + '</strong>';
    const href = x.href ? safeHref(x.href) : null;
    if (href) h = '<a href="' + esc(href) + '" target="_blank" rel="noopener noreferrer">' + h + '</a>';
    return h;
  }).join('');
}

export function blocksToHtml(blocks: MdBlock[]): string {
  return blocks.map((b) => {
    switch (b.kind) {
      case 'heading': return `<h${Math.min(6, b.level + 1)}>${inlinesHtml(b.inlines)}</h${Math.min(6, b.level + 1)}>`;
      case 'paragraph': return `<p>${inlinesHtml(b.inlines)}</p>`;
      case 'quote': return `<blockquote>${blocksToHtml(b.blocks)}</blockquote>`;
      case 'code': return `<pre><code>${esc(b.text)}</code></pre>`;
      case 'rule': return '<hr>';
      case 'image': {
        const src = safeSrc(b.src);
        const cap = b.title || b.alt;
        return src ? `<figure><img src="${esc(src)}" alt="${esc(b.alt)}">${cap ? `<figcaption>${esc(cap)}</figcaption>` : ''}</figure>` : `<p><em>[image: ${esc(b.alt || b.src.slice(0, 40))}]</em></p>`;
      }
      case 'table': {
        const cell = (tag: string, c: MdInline[], k: number) => `<${tag}${b.align[k] ? ` style="text-align:${b.align[k]}"` : ''}>${inlinesHtml(c)}</${tag}>`;
        return `<div class="md-table-wrap"><table><thead><tr>${b.head.map((c, k) => cell('th', c, k)).join('')}</tr></thead>`
          + `<tbody>${b.rows.map((r) => `<tr>${r.map((c, k) => cell('td', c, k)).join('')}</tr>`).join('')}</tbody></table></div>`;
      }
      case 'list': {
        const tag = b.ordered ? 'ol' : 'ul';
        const start = b.ordered && b.start !== 1 ? ` start="${b.start}"` : '';
        return `<${tag}${start}>${b.items.map((it) => `<li>${inlinesHtml(it.inlines)}${blocksToHtml(it.blocks)}</li>`).join('')}</${tag}>`;
      }
    }
  }).join('');
}

export function markdownToHtml(text: string): string {
  return blocksToHtml(parseMarkdown(text));
}

// ── embedded pictures: `[img-1]: data:image/…` lines at the end of the text ───────────────────

const DATA_DEF = /^\[([^\]]+)\]:[ \t]*data:image\/\S+[ \t]*$/;

/** The text without its embedded-picture definitions, and those definitions by id. */
export function splitImageDefs(text: string): { body: string; defs: { [id: string]: string } } {
  const defs: { [id: string]: string } = {};
  const keep: string[] = [];
  for (const l of (text || '').replace(/\r\n?/g, '\n').split('\n')) {
    const m = DATA_DEF.exec(l);
    if (m) defs[m[1]] = l.trim(); else keep.push(l);
  }
  return { body: keep.join('\n').replace(/\n+$/, ''), defs };
}

const refUsed = (body: string, id: string) => new RegExp('!?\\[[^\\]]*\\]\\[' + id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\]', 'i').test(body);

/** Puts the definitions back below the text; those nothing refers to any more are dropped. */
export function joinImageDefs(body: string, defs: { [id: string]: string }): string {
  const used = Object.keys(defs).filter((id) => refUsed(body, id));
  return used.length ? body.replace(/\n+$/, '') + '\n\n' + used.map((id) => defs[id]).join('\n') + '\n' : body;
}

/** The ids of the embedded pictures the text refers to. */
export function usedImageIds(body: string, defs: { [id: string]: string }): string[] {
  return Object.keys(defs).filter((id) => refUsed(body, id));
}

export function nextImageId(defs: { [id: string]: string }): string {
  let n = 1;
  while (defs['img-' + n]) n++;
  return 'img-' + n;
}
