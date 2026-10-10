import { opsBounds, parseSvgPath, transformOps } from './svg-path';
import { G_CLEF_PATH } from '../clef-glyph';
import { GLYPH_PATHS } from '../notes/glyph-paths';
import { DTie } from '../notes/Drawables';

describe('svg-path', () => {
  it('parses absolute and relative moves, lines, h/v and close', () => {
    const ops = parseSvgPath('M10 10 h 5 v 5 l -5 0 z m 20 0 L 30 40');
    expect(ops.map((o) => o.op).join('')).toBe('mlllhml');
    expect(ops[1].c).toEqual([15, 10]);
    expect(ops[2].c).toEqual([15, 15]);
    expect(ops[3].c).toEqual([10, 15]);
    expect(ops[5].c).toEqual([30, 10]); // relative m after z starts at the subpath start
    expect(ops[6].c).toEqual([30, 40]);
  });

  it('makes relative cubic curves absolute and repeats implicit commands', () => {
    const ops = parseSvgPath('m 0,0 c 1,1 2,2 3,3 1,1 2,2 3,3');
    expect(ops.length).toBe(3);
    expect(ops[2].c).toEqual([4, 4, 5, 5, 6, 6]);
  });

  it('turns quadratic curves into cubic ones with the same end point', () => {
    const [, q] = parseSvgPath('M0 0 Q 3 3 6 0');
    expect(q.op).toBe('c');
    expect(q.c.slice(4)).toEqual([6, 0]);
    expect(q.c[0]).toBeCloseTo(2);
    expect(q.c[1]).toBeCloseTo(2);
  });

  it('keeps the G clef inside y = 60..80 (staff lines 3 and 1 from the bottom)', () => {
    const b = opsBounds(parseSvgPath(G_CLEF_PATH));
    expect(b.y0).toBeGreaterThanOrEqual(59.9);
    expect(b.y1).toBeLessThanOrEqual(80.1);
  });

  it('parses every note glyph to closed outlines inside its 12 x 60 box', () => {
    for (const [name, d] of Object.entries(GLYPH_PATHS)) {
      const ops = parseSvgPath(d);
      expect(ops.length).withContext(name).toBeGreaterThan(2);
      expect(ops.some((o) => o.op === 'h')).withContext(name).toBeTrue();
      const b = opsBounds(ops);
      expect(b.x0).withContext(name).toBeGreaterThan(22);
      expect(b.x1).withContext(name).toBeLessThan(38);
      expect(b.y0).withContext(name).toBeGreaterThan(14);
      expect(b.y1).withContext(name).toBeLessThan(46);
    }
  });

  it('parses the neume bracket and transforms points', () => {
    const ops = parseSvgPath(new DTie(10, 40, { grouped: [] }, 45).getPath());
    const t = transformOps(ops, (x, y) => [x * 2, y + 1]);
    expect(t[0].c).toEqual([20, 41]);
    expect(opsBounds(ops).y0).toBeCloseTo(34);
  });
});
