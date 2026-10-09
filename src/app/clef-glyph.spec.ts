import { G_CLEF_PATH, G_CLEF_WIDTH, G_CLEF_LEFT } from './clef-glyph';
import { DEFAULT_NOTATION_COLOR, sanitizeNotationColor } from './notation-color';

/** Bounding box of an absolute-coordinate SVG path (M L H V Q C Z, upper case only). */
function bbox(d: string) {
  const xs: number[] = [], ys: number[] = [];
  for (const m of d.matchAll(/([MLHVQCZ])([^MLHVQCZ]*)/g)) {
    const n = (m[2].match(/-?\d+(\.\d+)?/g) || []).map(Number);
    if (m[1] === 'H') xs.push(...n);
    else if (m[1] === 'V') ys.push(...n);
    else n.forEach((v, i) => (i % 2 === 0 ? xs : ys).push(v));
  }
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
}

describe('G clef glyph', () => {
  it('uses only absolute commands (so the bbox check below is exact)', () => {
    expect(G_CLEF_PATH).toMatch(/^[MLHVQCZ0-9 .\-]+$/);
  });

  it('spans exactly staff lines 3 and 1 from the bottom (y = 60 .. 80)', () => {
    const b = bbox(G_CLEF_PATH);
    expect(b.y0).toBeGreaterThanOrEqual(60 - 0.01);
    expect(b.y1).toBeLessThanOrEqual(80 + 0.01);
    expect(b.y1 - b.y0).toBeGreaterThan(19.5); // control points may overshoot slightly, never undershoot
  });

  it('starts at the configured left edge and fits into the clef space', () => {
    const b = bbox(G_CLEF_PATH);
    expect(b.x0).toBeGreaterThanOrEqual(G_CLEF_LEFT - 0.1);
    expect(b.x1).toBeLessThan(32);
    expect(G_CLEF_WIDTH).toBeGreaterThan(10);
  });
});

describe('notation colour', () => {
  it('defaults to dark grey, not black', () => {
    expect(DEFAULT_NOTATION_COLOR).toBe('#333333');
  });
  it('accepts #rrggbb and falls back otherwise', () => {
    expect(sanitizeNotationColor('#AA00ff')).toBe('#aa00ff');
    for (const bad of ['red', '#fff', '#12345', 'javascript:alert(1)', 42, null, undefined, '#gggggg']) {
      expect(sanitizeNotationColor(bad)).toBe(DEFAULT_NOTATION_COLOR);
    }
  });
});
