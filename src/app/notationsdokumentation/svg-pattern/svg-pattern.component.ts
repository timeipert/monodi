import { Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

// ── Glyph data (ported from cm-transkriptionseq/ui/public/data.json) ─────────
interface GlyphInfo { viewBox: string; d: string; }
const GLYPHS: Record<string, GlyphInfo> = {
  note:       { viewBox: '0 0 10.788614 9.9038343',  d: 'm 4.370266,9.936426 c -2.283304,0 -4.33827799,-1.5412315 -4.33827799,-4.0814075 0,-2.825589 3.08246099,-5.82242705 6.39325299,-5.82242705 2.911213,0 4.395361,1.94081005 4.395361,3.99578405 0,3.367874 -3.253709,5.9080505 -6.450336,5.9080505 z' },
  oriscus:    { viewBox: '0 0 12.033796 9.9475756',  d: 'm 0.89884594,9.9692977 c -1.488003,0 -0.909335,-5.125344 0.24800096,-9.36890798 0.137778,-0.468446 0.661335,-0.496001 1.12978,-0.496001 -0.08267,2.75556198 -0.220444,4.54667598 0.826668,4.54667598 1.184891,0 6.558237,-4.62934298 8.0462391,-4.62934298 1.488003,0 0.909336,5.12534398 -0.248,9.36890798 -0.110222,0.468446 -0.661334,0.496001 -1.1022251,0.496001 0.08267,-2.755561 0.19289,-4.546676 -0.826668,-4.546676 -1.212447,0 -6.585792,4.629343 -8.07379496,4.629343 z' },
  quilisma:   { viewBox: '0 0 11.85672 7.1968908',   d: 'm 0,2.9367831 c 0,-0.688503 1.807319,-2.56036805 2.388243,-2.56036805 0.559409,0 2.366727,2.71097805 3.012197,2.71097805 0.666988,0 4.905581,-2.25914905 6.002881,-2.99068205 0.537892,-0.365766 0.580926,0.387283 0.215157,0.90365905 -1.032753,1.463069 -6.519256,6.196521 -7.810199,6.196521 C 3.098261,7.1968911 0,3.6683181 0,2.9367831 Z' },
  ascending:  { viewBox: '24 0 12 60',               d: 'm 28.846225,35.094337 c -2.306802,0 -4.382925,-1.557091 -4.382925,-4.123409 0,-2.85467 3.114184,-5.88235 6.459049,-5.88235 1.672433,0 2.796998,0.749712 3.3737,1.528257 l 0.02883,-0.05767 c -0.02883,-0.34602 -0.08651,-0.807381 -0.11534,-1.903111 l -0.173006,-6.574387 c 0,-0.519032 0.634372,-0.720877 1.326412,-0.547867 v 11.591686 c 0,3.402533 -3.287195,5.968852 -6.51672,5.968851 z' },
  descending: { viewBox: '24 0 12 60',               d: 'm 35.388649,29.040909 v 0.260586 12.739849 c 0,0.463264 -0.463266,0.636991 -1.216075,0.608038 0.115817,-2.866468 0.260587,-6.804239 0.289543,-10.626192 -1.187124,1.824113 -3.416596,3.011237 -5.617115,3.011237 -2.316337,0 -4.401038,-1.563528 -4.401038,-4.14045 0,-2.866466 3.127053,-5.906657 6.485741,-5.906657 2.953327,0 4.458944,1.968886 4.458944,4.053589 z' },
  strophicus: { viewBox: '0 0 6.7280999 9.9830542',  d: 'm 0.56829,9.9653207 c -0.0819,-0.02615 -0.173457,-0.121087 -0.173457,-0.179871 0,-0.03932 0.165964,-0.391875 0.218669,-0.464511 0.0062,-0.0086 0.03803,-0.0649 0.07065,-0.125098 0.03261,-0.0602 0.203634,-0.362785 0.380046,-0.672404 0.176412,-0.309617 0.341756,-0.601644 0.367432,-0.648947 0.02567,-0.0473 0.05187,-0.09304 0.05822,-0.101642 0.04329,-0.05867 0.455513,-0.839732 0.672625,-1.274438 0.436287,-0.873541 0.544221,-1.141505 0.557423,-1.383899 l 0.0077,-0.140736 -0.06003,-0.09708 C 2.538388,4.6677627 2.325898,4.4832717 1.849137,4.1661037 1.695161,4.0636697 1.473401,3.9235277 0.848353,3.5336507 0.511292,3.3234087 0.268824,3.1494647 0.139811,3.0253507 L 0,2.8908497 0.0066,2.7907917 C 0.0175,2.6253007 0.118409,2.4443977 0.385154,2.1121537 0.519338,1.9450207 1.122264,1.3304917 1.34632,1.1324907 1.969602,0.58168769 2.588549,0.16302169 2.975032,0.03080569 c 0.145063,-0.04962 0.304389,-0.03943 0.492574,0.03154 0.470415,0.177392 1.278602,0.678119 1.995255,1.23619801 0.312209,0.243125 0.550965,0.454742 0.806043,0.714421 0.418658,0.426207 0.519743,0.651748 0.427936,0.954806 -0.171978,0.567708 -0.836753,1.643074 -1.858747,3.006791 -0.3315,0.442344 -1.1799,1.517065 -1.252945,1.587184 -0.0045,0.0043 -0.0609,0.07107 -0.125392,0.148386 -0.756127,0.906521 -1.56734,1.760895 -1.941401,2.044697 -0.111463,0.08457 -0.317609,0.180329 -0.44741,0.207836 -0.122144,0.02589 -0.424829,0.02749 -0.502606,0.0027 z' },
};

// ── Token types ───────────────────────────────────────────────────────────────
interface Token { type: string; special: string; group: boolean; }

function renderSvg(pattern: string): { svgContent: string; viewBox: string; width: number; height: number } {
  const empty = { svgContent: '', viewBox: '0 0 20 20', width: 20, height: 20 };
  if (!pattern) return empty;

  // ── (Start) special case: single note ────────────────────────────────────
  if (pattern === '(Start)') {
    const g = GLYPHS['note'];
    const vba = g.viewBox.split(' ').map(Number);
    const cx = vba[0] + vba[2] / 2;
    const cy = vba[1] + vba[3] / 2;
    const svg = `<g transform="translate(10,10) scale(0.8) translate(-${cx},-${cy})"><path d="${g.d}" fill="currentColor"/></g>`;
    return { svgContent: svg, viewBox: '0 0 20 20', width: 20, height: 20 };
  }

  // ── Tokenise ──────────────────────────────────────────────────────────────
  const tokens: Token[] = [];
  let i = 0;
  let inGroup = false;
  const p = pattern;

  while (i < p.length) {
    const ch = p[i];
    if (ch === '[' || ch === '{') { inGroup = true;  i++; continue; }
    if (ch === ']' || ch === '}') { inGroup = false; i++; continue; }
    if (ch === '(' || ch === ')') { i++; continue; }

    const main = ch;
    i++;
    let suffix = '';
    while (i < p.length && ['L', 'Q', 'O', 'S', 'A'].includes(p[i])) {
      suffix += p[i++];
    }
    // Two-char suffixes: LA, LD
    if (suffix === 'L' && i < p.length && (p[i] === 'A' || p[i] === 'D')) {
      suffix += p[i++];
    }

    if (['*', 'u', 'd', 'e'].includes(main)) {
      tokens.push({ type: main, special: suffix, group: inGroup });
    }
  }

  // Implicit start note when pattern begins with a direction
  if (tokens.length > 0 && ['u', 'd', 'e'].includes(tokens[0].type)) {
    tokens.unshift({ type: 'start', special: '', group: false });
  }

  if (tokens.length === 0) return empty;

  // ── Layout ────────────────────────────────────────────────────────────────
  const xStep = 10;
  const yStep = 8;
  let currentY = 0;
  let minY = 0, maxY = 0;

  interface Point { x: number; y: number; token: Token; }
  const points: Point[] = [];
  interface Bracket { startX: number; endX: number; y: number; }
  const brackets: Bracket[] = [];
  let curBracket: Bracket | null = null;

  for (let k = 0; k < tokens.length; k++) {
    const t = tokens[k];
    if (t.type === 'u') currentY -= 1;
    else if (t.type === 'd') currentY += 1;
    if (currentY < minY) minY = currentY;
    if (currentY > maxY) maxY = currentY;

    const px = k * xStep + 10;
    const py = currentY * yStep;
    points.push({ x: px, y: py, token: t });

    if (t.group) {
      if (!curBracket) curBracket = { startX: px, endX: px, y: py };
      curBracket.endX = px;
      curBracket.y = Math.min(curBracket.y, py);
    } else {
      if (curBracket) { brackets.push(curBracket); curBracket = null; }
    }
  }
  if (curBracket) brackets.push(curBracket);

  const topBuffer = 24;
  const bottomBuffer = 8;
  const width = points.length * xStep + 10;
  const height = (maxY - minY) * yStep + topBuffer + bottomBuffer;
  const yOffset = -minY * yStep + topBuffer;

  let svg = '';

  // Draw connecting lines between notes
  for (let k = 1; k < points.length; k++) {
    const a = points[k - 1], b = points[k];
    svg += `<line x1="${a.x}" y1="${a.y + yOffset}" x2="${b.x}" y2="${b.y + yOffset}" stroke="#bbb" stroke-width="0.8"/>`;
  }

  // Draw group brackets
  for (const br of brackets) {
    const bx1 = br.startX - 4;
    const bx2 = br.endX + 4;
    const by = br.y + yOffset - 12;
    const brW = bx2 - bx1;
    svg += `<path d="M ${bx1} ${by} l 0 -3 a 3 3 0 0 1 3 -3 l ${brW - 6} 0 a 3 3 0 0 1 3 3 l 0 3" stroke="#555" stroke-width="1.2" fill="none"/>`;
  }

  // Draw note glyphs
  for (const pt of points) {
    let gInfo = GLYPHS['note'];
    let scale = 0.85;
    const sp = pt.token.special;

    if (sp.includes('O'))        gInfo = GLYPHS['oriscus'];
    else if (sp.includes('Q'))   gInfo = GLYPHS['quilisma'];
    else if (sp.includes('S'))   gInfo = GLYPHS['strophicus'];

    if (sp.includes('LA'))       { gInfo = GLYPHS['ascending'];  scale = 0.18; }
    else if (sp.includes('LD'))  { gInfo = GLYPHS['descending']; scale = 0.18; }
    else if (sp.includes('L'))   { scale = 0.65; }

    if (!gInfo) gInfo = GLYPHS['note'];

    const vba = gInfo.viewBox.split(' ').map(Number);
    const cx = vba[0] + vba[2] / 2;
    const cy = vba[1] + vba[3] / 2;
    const tx = pt.x - cx * scale;
    const ty = pt.y + yOffset - cy * scale;

    svg += `<g transform="translate(${tx.toFixed(2)},${ty.toFixed(2)}) scale(${scale})"><path d="${gInfo.d}" fill="currentColor"/></g>`;
  }

  return { svgContent: svg, viewBox: `0 0 ${width} ${height}`, width, height };
}

// ── Angular component ─────────────────────────────────────────────────────────
@Component({
    selector: 'app-svg-pattern',
    template: `
    <svg *ngIf="rendered"
         class="svg-pattern"
         [attr.width]="rendered.width"
         [attr.height]="rendered.height"
         [attr.viewBox]="rendered.viewBox"
         [innerHTML]="safeHtml">
    </svg>`,
    styles: [`
    :host { display: inline-block; }
    .svg-pattern { display: block; color: #222; }
  `],
    standalone: false
})
export class SvgPatternComponent implements OnChanges {
  @Input() pattern = '';

  rendered: { svgContent: string; viewBox: string; width: number; height: number } | null = null;
  safeHtml: SafeHtml = '';

  constructor(private sanitizer: DomSanitizer) {}

  ngOnChanges(_: SimpleChanges) {
    this.rendered = renderSvg(this.pattern);
    this.safeHtml = this.sanitizer.bypassSecurityTrustHtml(this.rendered.svgContent);
  }
}
