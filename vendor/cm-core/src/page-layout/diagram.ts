/**
 * Schematic drawings of a page layout, as SVG text (no DOM needed, so an app, a PDF export or a script can use them):
 *
 * - `pageDiagramSvg`: a verso page (the notes on use of the printed volume ask for "a representative verso page",
 *   so the inner margin, at the spine, is on the right), the written area with its columns and side column, and its
 *   text lines and staves. Proportional to the recorded measures; where a measure is not recorded, a default is used
 *   and the drawing says so in its title.
 * - `staffSampleSvg`: one staff, larger: its lines in their colours, the clef letters on their lines, a custos at the
 *   end, the text line below.
 *
 * The drawings are schematic: they show what is recorded, not the manuscript.
 */
import type { LayoutSection } from './model';
import type { PitchLetter } from './vocabulary';
import { COLOUR_HEX, PITCH_LETTERS } from './vocabulary';

const GREY = '#9a948a';
const LIGHT = '#cfc8bb';
const TEXT_LINE = '#d9d3c7';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const r1 = (n: number) => Math.round(n * 10) / 10;
const idx = (p: string) => (PITCH_LETTERS as readonly string[]).indexOf(p);
const mid = (r: { min: number | null; max: number | null }) => (r.min === null ? null : r.max === null ? r.min : (r.min + r.max) / 2);

/** The number of staff lines the drawings use: the recorded one, else 4 when anything is coloured or clefed. */
export function drawnLineCount(s: LayoutSection): number {
    if (s.staves.lineCount !== null) return s.staves.lineCount;
    if (s.staves.arrangement === 'interlinear') return 0;
    return 4;
}

/**
 * The pitch of each staff line from the bottom, worked out from the coloured lines and the first clef: the lines
 * are a third apart, so one known pitch fixes all of them. Of the possible positions the one that puts the most
 * recorded pitches on lines wins, then the one that centres them, then the lower one. Null entries: unknown.
 */
export function staffLinePitches(s: LayoutSection): Array<PitchLetter | null> {
    const n = drawnLineCount(s);
    const refs = [
        ...s.colourings.lines.map(l => l.pitch),
        ...(s.clefs.uses[0]?.letters ?? [])
    ].filter((p): p is PitchLetter => !!p);
    if (!n || !refs.length) return Array.from({ length: n }, () => null);
    let best: { bottom: number; hits: number; off: number } | null = null;
    for (let k = 0; k < n; k++) {
        const bottom = idx(refs[0]) - 2 * k;
        const positions = refs.map(p => (idx(p) - bottom) / 2).filter(x => Number.isInteger(x) && x >= 0 && x < n);
        const hits = positions.length;
        const off = Math.abs(positions.reduce((a, b) => a + b, 0) / Math.max(hits, 1) - (n - 1) / 2);
        if (!best || hits > best.hits || (hits === best.hits && off < best.off - 1e-9)
            || (hits === best.hits && Math.abs(off - best.off) < 1e-9 && bottom < best.bottom)) best = { bottom, hits, off };
    }
    const bottom = best!.bottom;
    return Array.from({ length: n }, (_, i) => {
        const p = PITCH_LETTERS[bottom + 2 * i];
        return p ?? null;
    });
}

/** Colour and dash of each staff line from the bottom. */
function lineStyles(s: LayoutSection): Array<{ colour: string; dashed: boolean; pitch: PitchLetter | null; coloured: boolean }> {
    const pitches = staffLinePitches(s);
    const plain = s.staves.lineColour ? COLOUR_HEX[s.staves.lineColour] : GREY;
    const dry = s.staves.ruling.length === 1 && s.staves.ruling[0] === 'drypoint' && !s.staves.lineColour;
    return pitches.map(p => {
        const c = p ? s.colourings.lines.find(l => l.pitch === p || l.alternative === p) : undefined;
        return c && c.colour
            ? { colour: COLOUR_HEX[c.colour], dashed: false, pitch: p, coloured: true }
            : { colour: dry ? LIGHT : plain, dashed: dry, pitch: p, coloured: false };
    });
}

export interface DiagramOptions {
    /** Height of the drawing in pixels (default 280). */
    height?: number;
    /** Text of the <title> (default: a description of what is drawn). */
    title?: string;
}

/** The page diagram as an SVG document fragment (`<svg …>…</svg>`). */
export function pageDiagramSvg(s: LayoutSection, options: DiagramOptions = {}): string {
    const w = s.writingSpace;
    const assumed: string[] = [];
    let areaH = mid(w.area.height), areaW = mid(w.area.width);
    if (areaH === null || areaW === null) { assumed.push('size of the written area'); areaH = areaH ?? 18; areaW = areaW ?? 12; }
    const m = w.margins;
    const leafH = mid(w.leaf.height), leafW = mid(w.leaf.width);
    // Margins: the recorded ones, else what is left of the leaf, else a default share (outer and bottom wider).
    const spareW = leafW !== null && leafW > areaW ? leafW - areaW : areaW * 0.45;
    const spareH = leafH !== null && leafH > areaH ? leafH - areaH : areaH * 0.4;
    const outer = m.outer ?? spareW * 0.6, inner = m.inner ?? spareW * 0.4;
    const top = m.top ?? spareH * 0.4, bottom = m.bottom ?? spareH * 0.6;
    if (leafH === null || leafW === null) assumed.push('size of the leaf');
    const pageW = leafW ?? outer + areaW + inner, pageH = leafH ?? top + areaH + bottom;

    const height = options.height ?? 280;
    const pad = 14;
    const scale = (height - 2 * pad - 16) / pageH;
    const width = Math.ceil(pageW * scale + 2 * pad);
    const X = (cm: number) => r1(pad + cm * scale);
    const Y = (cm: number) => r1(pad + cm * scale);

    const out: string[] = [];
    out.push(`<rect x="${X(0)}" y="${Y(0)}" width="${r1(pageW * scale)}" height="${r1(pageH * scale)}" fill="#fffdf8" stroke="${GREY}" stroke-width="1"/>`);
    // spine on the right of a verso page
    out.push(`<line x1="${X(pageW)}" y1="${Y(0)}" x2="${X(pageW)}" y2="${Y(pageH)}" stroke="${GREY}" stroke-width="3"/>`);
    const ax = outer, ay = top;
    const ruled = w.ruling.length ? (w.ruling.includes('ink') ? '' : ' stroke-dasharray="3 2"') : ' stroke-dasharray="1 3"';
    out.push(`<rect x="${X(ax)}" y="${Y(ay)}" width="${r1(areaW * scale)}" height="${r1(areaH * scale)}" fill="none" stroke="${LIGHT}" stroke-width="1"${ruled}/>`);

    // columns and side columns
    const cols = w.columns === 2 ? 2 : 1;
    const sideW = w.sideColumn === 'initials' || w.sideColumn === 'margin' ? (w.sideColumnWidth ?? areaW * (w.sideColumn === 'initials' ? 0.05 : 0.18)) : 0;
    const gap = cols === 2 ? (w.columnWidth !== null && w.columnWidth * 2 < areaW ? areaW - 2 * w.columnWidth : areaW * 0.06) : 0;
    const colW = (areaW - gap) / cols;
    const columns: Array<{ x: number; w: number }> = [];
    for (let c = 0; c < cols; c++) {
        const x0 = ax + c * (colW + gap);
        if (sideW) {
            out.push(`<rect x="${X(x0)}" y="${Y(ay)}" width="${r1(sideW * scale)}" height="${r1(areaH * scale)}" fill="#f1ece2" stroke="none"/>`);
            columns.push({ x: x0 + sideW, w: colW - sideW });
        } else columns.push({ x: x0, w: colW });
    }

    // rows: staves and text lines
    const counted = w.lines.count.max ?? w.lines.count.min;
    if (counted === null) assumed.push('number of lines');
    const rows = Math.max(1, Math.min(counted ?? 10, 40));
    const unit = w.lines.unit || 'systems';
    const arrangement = s.staves.arrangement || (unit === 'text-lines' && s.staves.lineCount === 0 ? 'interlinear' : 'alternating');
    const styles = lineStyles(s);
    const rowH = areaH / rows;
    for (const col of columns) {
        for (let r = 0; r < rows; r++) {
            const y0 = ay + r * rowH;
            const withText = arrangement !== 'textless';
            const staffH = arrangement === 'interlinear' || !styles.length ? 0 : rowH * (withText ? 0.62 : 0.85);
            if (staffH) {
                const step = styles.length > 1 ? staffH * 0.8 / (styles.length - 1) : 0;
                styles.forEach((st, i) => {
                    const y = y0 + rowH * 0.08 + staffH * 0.8 - i * step;
                    out.push(`<line x1="${X(col.x)}" y1="${Y(y)}" x2="${X(col.x + col.w)}" y2="${Y(y)}" stroke="${st.colour}" stroke-width="${st.coloured ? 1.2 : 0.7}"${st.dashed ? ' stroke-dasharray="2 2"' : ''}/>`);
                });
            } else if (arrangement === 'interlinear') {
                for (let d = 0; d < 6; d++) {
                    const x = col.x + col.w * (0.08 + d * 0.16);
                    out.push(`<circle cx="${X(x)}" cy="${Y(y0 + rowH * 0.35)}" r="0.9" fill="${GREY}"/>`);
                }
            }
            if (withText) {
                const ty = y0 + rowH * (arrangement === 'interlinear' ? 0.6 : 0.78);
                const th = Math.max(rowH * 0.14, 0.15);
                out.push(`<rect x="${X(col.x)}" y="${Y(ty)}" width="${r1(col.w * scale)}" height="${r1(Math.max(th * scale, 1))}" fill="${TEXT_LINE}"/>`);
            }
        }
    }
    // the first initial in its colour, when one is recorded
    const ic = s.colourings.initials.colours[0];
    if (ic) {
        const size = Math.min(rowH * (s.colourings.initials.size.min ?? 1), areaH);
        const x = sideW ? ax : columns[0].x;
        out.push(`<rect x="${X(x)}" y="${Y(ay)}" width="${r1(Math.max(size * 0.8, sideW || 0) * scale)}" height="${r1(size * scale)}" fill="${COLOUR_HEX[ic]}" opacity="0.8"/>`);
    }

    const label = [
        mid(w.area.height) !== null && mid(w.area.width) !== null ? `${fmt(w.area.height)} × ${fmt(w.area.width)} cm` : '',
        counted !== null ? `${w.lines.variable ? 'max. ' : ''}${counted} ${unit === 'text-lines' ? 'text lines' : 'staves'}` : ''
    ].filter(Boolean).join(' · ');
    out.push(`<text x="${r1(width / 2)}" y="${height - 4}" text-anchor="middle" font-size="11" font-family="sans-serif" fill="#555">${esc(label || 'not recorded')}</text>`);
    const title = options.title ?? `Page layout (schematic verso page)${assumed.length ? `; assumed: ${assumed.join(', ')}` : ''}`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img"><title>${esc(title)}</title>${out.join('')}</svg>`;
}

function fmt(r: { min: number | null; max: number | null }): string {
    if (r.min === null) return '?';
    return r.max === null ? String(r.min) : `${r.min}–${r.max}`;
}

/** One staff with its clef, colours and custos, as an SVG document fragment. */
export function staffSampleSvg(s: LayoutSection, options: DiagramOptions = {}): string {
    const width = 420, height = options.height ?? 120;
    const styles = lineStyles(s);
    const out: string[] = [];
    const left = 16, right = width - 40;
    const gapY = 14;
    const baseY = height - 38;
    const yOf = (i: number) => baseY - i * gapY;
    const n = styles.length;
    styles.forEach((st, i) => {
        const y = yOf(i);
        out.push(`<line x1="${left}" y1="${y}" x2="${right}" y2="${y}" stroke="${st.colour}" stroke-width="${st.coloured ? 2 : 1.2}"${st.dashed ? ' stroke-dasharray="4 3"' : ''}/>`);
        if (st.coloured && st.pitch) out.push(`<text x="${right + 6}" y="${y + 4}" font-size="11" font-family="serif" fill="${st.colour}">${esc(st.pitch)}</text>`);
    });
    // clefs of the first use, on their lines
    const clefs = s.clefs.uses[0]?.letters ?? [];
    const pitches = styles.map(st => st.pitch);
    for (const letter of clefs) {
        const i = pitches.indexOf(letter);
        if (i < 0) continue;
        const shape = s.clefs.shapes.find(x => x.letter === letter)?.shape ?? 'letter';
        const y = yOf(i);
        if (shape === 'dot') out.push(`<circle cx="${left + 12}" cy="${y}" r="4" fill="#222"/>`);
        else if (shape === 'hook') out.push(`<path d="M ${left + 8} ${y - 6} q 8 0 8 6 q 0 6 -8 6" fill="none" stroke="#222" stroke-width="2"/>`);
        else out.push(`<text x="${left + 12}" y="${y + 5}" text-anchor="middle" font-size="16" font-weight="700" font-family="serif" fill="#222">${esc(letter)}</text>`);
    }
    // a few neumes: dots between the clef and the custos
    const top = n ? yOf(n - 1) : baseY - 30;
    for (let k = 0; k < 7; k++) {
        const x = left + 50 + k * 42;
        const y = n ? yOf(((k * 3) % Math.max(n * 2 - 1, 1)) / 2) : top + ((k * 7) % 20);
        out.push(`<rect x="${x - 4}" y="${r1(y - 4)}" width="8" height="8" fill="#333" transform="rotate(${n ? 0 : 45} ${x} ${r1(y)})"/>`);
    }
    // custos
    if (s.clefs.custos === 'present' || s.clefs.custos === 'sporadic' || s.clefs.custos === 'later-hand') {
        const y = n ? yOf(Math.min(1, n - 1)) : baseY - 10;
        out.push(`<path d="M ${right - 14} ${y} l 3 4 l 3 -4 l 3 4 l 5 -14" fill="none" stroke="#222" stroke-width="1.4"/>`);
    }
    // text line
    if (s.staves.arrangement !== 'textless') out.push(`<rect x="${left}" y="${height - 22}" width="${right - left}" height="6" fill="${TEXT_LINE}"/>`);
    const title = options.title ?? `One staff: ${n} line${n === 1 ? '' : 's'}${clefs.length ? `, ${clefs.join(' and ')} clef` : ''}`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img"><title>${esc(title)}</title>${out.join('')}</svg>`;
}
