import { PlaceholderLookup, resolveBlock } from './placeholders';
import { wrap } from './signature';

/**
 * The cover of a print: a stack of text blocks (and rules) with placeholders, set on the page the way a printed
 * edition sets its title page. Every property is a setting, so other projects build their own cover from it.
 * Pure: no jsPDF; the caller says how wide a text is and draws the items.
 */
export type TitleAlign = 'left' | 'center' | 'right';
export type TitleStyle = 'normal' | 'bold' | 'italic' | 'bolditalic';

export interface TitleBlock {
  id: string;
  kind: 'text' | 'rule';
  /** The text with placeholders (`$gattung1$en aus $quelle$`); blank lines are spacing. Not used by a rule. */
  text: string;
  /** Text size in pt; the thickness of a rule. */
  size: number;
  color: string;
  style: TitleStyle;
  align: TitleAlign;
  /** Space above the block in pt (not before the first block of a stack). */
  before: number;
  /** 'flow': below the block before; 'bottom': stacked at the bottom of the page (colophon, licence). */
  anchor: 'flow' | 'bottom';
  /** Leave the block out when a placeholder in it stands for nothing. */
  hideIfEmpty: boolean;
  /** Width in % of the text area: where the text wraps, how long a rule is. */
  width: number;
}

export interface TitleTemplate {
  /** Where the first block starts, in % of the page height. */
  top: number;
  /** Space left and right of the text area, in pt. */
  side: number;
  /** Space below the bottom stack, in pt. */
  bottom: number;
  /** Line height as a multiple of the text size. */
  lineHeight: number;
  /** Placeholders of one's own: `$herausgeber$` stands for the value given here (unless the data has a field of that name). */
  variables: { key: string; value: string }[];
  blocks: TitleBlock[];
}

export const MAX_BLOCKS = 40;
const MAX_TEXT = 2000;

export function newBlock(kind: 'text' | 'rule', id: string): TitleBlock {
  return kind === 'rule'
    ? { id, kind, text: '', size: 0.5, color: '#000000', style: 'normal', align: 'center', before: 18, anchor: 'flow', hideIfEmpty: false, width: 12 }
    : { id, kind, text: '', size: 11, color: '#000000', style: 'normal', align: 'center', before: 18, anchor: 'flow', hideIfEmpty: true, width: 100 };
}

function textBlock(id: string, text: string, o: Partial<TitleBlock> = {}): TitleBlock {
  return { ...newBlock('text', id), text, ...o };
}

/** Presets: a neutral cover, and the one of the printed Corpus Monodicum volumes as an example to copy from. */
export const TITLE_PRESETS: { id: string; label: string; template: TitleTemplate }[] = [
  {
    id: 'plain',
    label: 'Plain',
    template: {
      top: 22, side: 100, bottom: 56.7, lineHeight: 1.3, variables: [],
      blocks: [
        textBlock('b1', '$titel$', { size: 26, before: 0 }),
        textBlock('b2', '$gruppe$', { size: 18, before: 14 }),
        textBlock('b3', '$quelle$', { size: 13, before: 26 }),
        textBlock('b4', '$datum$', { size: 10, color: '#666666', anchor: 'bottom', before: 0 }),
      ],
    },
  },
  {
    id: 'corpus-monodicum',
    label: 'Corpus Monodicum (example)',
    template: {
      top: 12.5, side: 100, bottom: 56.7, lineHeight: 1.3,
      variables: [{ key: 'herausgeber', value: '' }],
      blocks: [
        textBlock('b1', 'CORPUS MONODICUM', { size: 33, color: '#a61c00', before: 0, hideIfEmpty: false }),
        textBlock('b2', 'Die einstimmige Musik\ndes lateinischen Mittelalters', { size: 22, color: '#a61c00', before: 22, hideIfEmpty: false }),
        textBlock('b3', 'Im Auftrag der Akademie der Wissenschaften und der Literatur | Mainz\nam Zentrum für Philologie und Digitalität der Universität Würzburg', { size: 11, before: 26, hideIfEmpty: false }),
        textBlock('b4', 'unter Leitung von', { size: 11, before: 24, hideIfEmpty: false }),
        textBlock('b5', 'Andreas Haug (bis 2024), Frank Puppe und Konstantin Voigt (ab 2025)', { size: 11, before: 24, hideIfEmpty: false }),
        textBlock('b6', 'Charles M. Atkinson • Gunilla Björkvall • Gionata Brusa • David Catalunya • Maria Dorofeev • Jasmin Hartmann-Strauß • David Hiley • Michele Loda • Elaine Stratton-Hild • Isabel Kraft • Michael Klaper • Salah Eddin Maraqa • Andreas Pfisterer • Anna Sanda • Konstantin Voigt • Hanna Zühlke', { size: 11, before: 24, hideIfEmpty: false }),
        textBlock('b7', '$gattung1$en aus\n$quelle$', { size: 17, before: 32 }),
        textBlock('b8', 'herausgegeben von\n\n$herausgeber$', { size: 11, before: 32 }),
        textBlock('b9', 'Auszug aus der Beta-Version der digitalen Ausgabe ($jahr$)', { size: 11, before: 70, hideIfEmpty: false }),
        textBlock('b10', 'Open Access © $jahr$ bei CORPUS MONODICUM https://corpus.monodicum.de Dieses Werk ist lizenziert unter einer Creative Commons Namensnennung – Nicht kommerziell – Keine Bearbeitung 4.0 International Lizenz.', { size: 9, anchor: 'bottom', before: 0, width: 82, hideIfEmpty: false }),
      ],
    },
  },
];

function clampNum(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}
function pick<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(v as T) ? (v as T) : fallback;
}
function hex(v: unknown, fallback: string): string {
  return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v.trim()) ? v.trim().toLowerCase() : fallback;
}

/** Anything (stored JSON, an imported file) made into a valid template; what is missing or out of range gets its default. */
export function sanitizeTitleTemplate(raw: unknown): TitleTemplate {
  const r: any = raw && typeof raw === 'object' ? raw : {};
  const base = TITLE_PRESETS[0].template;
  const ids = new Set<string>();
  const blocks: TitleBlock[] = (Array.isArray(r.blocks) ? r.blocks : base.blocks).slice(0, MAX_BLOCKS).map((b: any, i: number) => {
    const kind = b?.kind === 'rule' ? 'rule' : 'text';
    const d = newBlock(kind, '');
    let id = typeof b?.id === 'string' && b.id ? b.id.slice(0, 20) : `b${i + 1}`;
    for (let n = 2; ids.has(id); n++) id = `b${i + 1}_${n}`;
    ids.add(id);
    return {
      id, kind,
      text: kind === 'rule' ? '' : String(b?.text ?? '').slice(0, MAX_TEXT),
      size: kind === 'rule' ? clampNum(b?.size, 0.1, 6, d.size) : clampNum(b?.size, 4, 72, d.size),
      color: hex(b?.color, d.color),
      style: pick(b?.style, ['normal', 'bold', 'italic', 'bolditalic'] as const, d.style),
      align: pick(b?.align, ['left', 'center', 'right'] as const, d.align),
      before: clampNum(b?.before, 0, 400, d.before),
      anchor: pick(b?.anchor, ['flow', 'bottom'] as const, d.anchor),
      hideIfEmpty: typeof b?.hideIfEmpty === 'boolean' ? b.hideIfEmpty : d.hideIfEmpty,
      width: clampNum(b?.width, 10, 100, d.width),
    };
  });
  const seen = new Set<string>();
  const variables = (Array.isArray(r.variables) ? r.variables : []).slice(0, 30)
    .map((v: any) => ({ key: String(v?.key ?? '').trim().slice(0, 40), value: String(v?.value ?? '').slice(0, 500) }))
    .filter((v: { key: string }) => /^[\p{L}\p{N}_.-]+$/u.test(v.key) && !seen.has(v.key.toLowerCase()) && !!seen.add(v.key.toLowerCase()));
  return {
    top: clampNum(r.top, 0, 70, base.top),
    side: clampNum(r.side, 0, 200, base.side),
    bottom: clampNum(r.bottom, 0, 200, base.bottom),
    lineHeight: clampNum(r.lineHeight, 1, 2.5, base.lineHeight),
    variables,
    blocks,
  };
}

export type CoverItem =
  | { kind: 'text'; text: string; x: number; y: number; size: number; color: string; style: TitleStyle; align: TitleAlign }
  | { kind: 'rule'; x1: number; x2: number; y: number; thickness: number; color: string };

export interface CoverLayout {
  items: CoverItem[];
  /** The blocks do not fit between the top and the bottom stack. */
  overflow: boolean;
  /** Placeholders that no field knows. */
  unknown: string[];
}

export type MeasureStyled = (text: string, size: number, style: TitleStyle) => number;

/** A paragraph must not end on a lone little word ("Cod. / 1"): it takes the last word of the line before it along. */
export function avoidOrphan(lines: string[]): string[] {
  if (lines.length < 2) return lines;
  const last = lines[lines.length - 1];
  const prev = lines[lines.length - 2];
  if (last.includes(' ') || Array.from(last).length > 3 || !prev.includes(' ')) return lines;
  const cut = prev.lastIndexOf(' ');
  return [...lines.slice(0, -2), prev.slice(0, cut), prev.slice(cut + 1) + ' ' + last];
}

interface Prepared { block: TitleBlock; lines: string[]; height: number }

/** Places the blocks on a page of `page` pt. `y` of a text item is its baseline. */
export function layoutCover(t: TitleTemplate, lookup: PlaceholderLookup, page: { w: number; h: number }, measure: MeasureStyled): CoverLayout {
  const textW = Math.max(40, page.w - 2 * t.side);
  const unknown: string[] = [];
  const watching: PlaceholderLookup = (name) => { const v = lookup(name); if (v === undefined && !unknown.includes(name)) unknown.push(name); return v; };
  const prepared: Prepared[] = [];
  for (const block of t.blocks) {
    if (block.kind === 'rule') { prepared.push({ block, lines: [], height: block.size }); continue; }
    const raw = resolveBlock(block.text, watching, block.hideIfEmpty);
    if (!raw) continue;
    const maxW = Math.max(20, textW * block.width / 100);
    const lines = raw.flatMap((line) => (line ? avoidOrphan(wrap(line, maxW, block.size, (s, z) => measure(s, z, block.style))) : ['']));
    prepared.push({ block, lines, height: lines.length * block.size * t.lineHeight });
  }

  const items: CoverItem[] = [];
  const place = (p: Prepared, top: number): void => {
    const { block } = p;
    const x = block.align === 'left' ? t.side : block.align === 'right' ? page.w - t.side : page.w / 2;
    if (block.kind === 'rule') {
      const len = textW * block.width / 100;
      const x1 = block.align === 'left' ? t.side : block.align === 'right' ? page.w - t.side - len : page.w / 2 - len / 2;
      items.push({ kind: 'rule', x1, x2: x1 + len, y: top + block.size / 2, thickness: block.size, color: block.color });
      return;
    }
    p.lines.forEach((line, i) => {
      if (!line) return;
      const lineTop = top + i * block.size * t.lineHeight;
      items.push({ kind: 'text', text: line, x, y: lineTop + block.size * (0.8 + (t.lineHeight - 1) / 2), size: block.size, color: block.color, style: block.style, align: block.align });
    });
  };

  const flow = prepared.filter((p) => p.block.anchor === 'flow');
  const bottom = prepared.filter((p) => p.block.anchor === 'bottom');
  let y = page.h * t.top / 100;
  flow.forEach((p, i) => { if (i > 0) y += p.block.before; place(p, y); y += p.height; });
  const stackH = bottom.reduce((sum, p, i) => sum + p.height + (i > 0 ? p.block.before : 0), 0);
  let by = page.h - t.bottom - stackH;
  bottom.forEach((p, i) => { if (i > 0) by += p.block.before; place(p, by); by += p.height; });
  const limit = bottom.length ? page.h - t.bottom - stackH : page.h - t.bottom;
  return { items, overflow: y > limit + 0.5 || by < 0, unknown };
}
