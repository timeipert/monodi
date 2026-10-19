import { Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

import { GLYPHS, glyphOf, layoutPattern, tokenizePattern } from './neume-glyph';

/** The picture of a pattern as SVG markup with its size, for the component and for drawings that lay several of them out. */
export function renderSvg(pattern: string): { svgContent: string; viewBox: string; width: number; height: number } {
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

  const tokens = tokenizePattern(pattern);
  if (tokens.length === 0) return empty;

  // ── Layout ────────────────────────────────────────────────────────────────
  const xStep = 10;
  const yStep = 8;
  const { points, brackets, minY, maxY } = layoutPattern(tokens, xStep, yStep);

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
    const { glyph: gInfo, scale } = glyphOf(pt.token.special);

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
    @if (rendered) {
      <svg
        class="svg-pattern"
        [attr.width]="rendered.width"
        [attr.height]="rendered.height"
        [attr.viewBox]="rendered.viewBox"
        [innerHTML]="safeHtml">
      </svg>
    }`,
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
