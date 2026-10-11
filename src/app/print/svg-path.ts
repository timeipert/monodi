/**
 * Minimal SVG path support for drawing outlines with jsPDF's `path()` (absolute m/l/c/h).
 * Handles the commands our glyphs and brackets use: M L H V C Q Z (absolute and relative,
 * with implicit repeats). Quadratic curves become cubic ones.
 */
export type PathOp = { op: 'm' | 'l' | 'c' | 'h'; c: number[] };

const TOKEN = /[MmLlHhVvCcQqZz]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g;

export function parseSvgPath(d: string): PathOp[] {
  const tokens = d.match(TOKEN) || [];
  const ops: PathOp[] = [];
  let i = 0;
  let cmd = '';
  let x = 0, y = 0, sx = 0, sy = 0;
  const num = () => parseFloat(tokens[i++]);
  const isNum = () => i < tokens.length && !/^[A-Za-z]$/.test(tokens[i]);
  while (i < tokens.length) {
    if (/^[A-Za-z]$/.test(tokens[i])) cmd = tokens[i++];
    else if (!cmd) { i++; continue; }
    const rel = cmd === cmd.toLowerCase();
    switch (cmd.toUpperCase()) {
      case 'M': {
        const nx = num(), ny = num();
        x = rel ? x + nx : nx; y = rel ? y + ny : ny;
        sx = x; sy = y;
        ops.push({ op: 'm', c: [x, y] });
        cmd = rel ? 'l' : 'L'; // following pairs are line-tos
        break;
      }
      case 'L': { const nx = num(), ny = num(); x = rel ? x + nx : nx; y = rel ? y + ny : ny; ops.push({ op: 'l', c: [x, y] }); break; }
      case 'H': { const nx = num(); x = rel ? x + nx : nx; ops.push({ op: 'l', c: [x, y] }); break; }
      case 'V': { const ny = num(); y = rel ? y + ny : ny; ops.push({ op: 'l', c: [x, y] }); break; }
      case 'C': {
        const c = [num(), num(), num(), num(), num(), num()];
        if (rel) for (let k = 0; k < 6; k += 2) { c[k] += x; c[k + 1] += y; }
        ops.push({ op: 'c', c });
        x = c[4]; y = c[5];
        break;
      }
      case 'Q': {
        let qx = num(), qy = num(), ex = num(), ey = num();
        if (rel) { qx += x; qy += y; ex += x; ey += y; }
        // quadratic -> cubic: control points 2/3 of the way to the quadratic control point
        ops.push({ op: 'c', c: [x + (2 / 3) * (qx - x), y + (2 / 3) * (qy - y), ex + (2 / 3) * (qx - ex), ey + (2 / 3) * (qy - ey), ex, ey] });
        x = ex; y = ey;
        break;
      }
      case 'Z': ops.push({ op: 'h', c: [] }); x = sx; y = sy; cmd = ''; break;
      default: i++;
    }
    if (cmd && !isNum() && i < tokens.length && !/^[A-Za-z]$/.test(tokens[i])) i++;
  }
  return ops;
}

/** Applies a point transform to every coordinate pair. */
export function transformOps(ops: PathOp[], f: (x: number, y: number) => [number, number]): PathOp[] {
  return ops.map((o) => {
    const c: number[] = [];
    for (let k = 0; k < o.c.length; k += 2) { const [a, b] = f(o.c[k], o.c[k + 1]); c.push(a, b); }
    return { op: o.op, c };
  });
}

/** Bounding box of all points (control points included). */
export function opsBounds(ops: PathOp[]): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const o of ops) for (let k = 0; k < o.c.length; k += 2) {
    x0 = Math.min(x0, o.c[k]); x1 = Math.max(x1, o.c[k]); y0 = Math.min(y0, o.c[k + 1]); y1 = Math.max(y1, o.c[k + 1]);
  }
  return { x0, y0, x1, y1 };
}
