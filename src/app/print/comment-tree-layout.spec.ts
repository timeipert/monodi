import { layoutCommentTree, TreeKit } from './comment-tree-layout';
import { breakLines, markupSegments } from './rich-text';

const drawn: string[] = [];
const kit: TreeKit = {
  fs: 10, lineH: 13, maxCellW: 100, gapX: 8, gapY: 4,
  width: (t, _s, size) => t.length * size * 0.5,
  draw: (t, x, y) => drawn.push(`${t}@${Math.round(x)},${Math.round(y)}`),
  rect: () => {},
  bracket: (x, y, h) => drawn.push(`]@${Math.round(x)},${Math.round(y)}+${Math.round(h)}`),
  notes: () => ({ w: 50, h: 30, draw: (x, y) => drawn.push(`notes@${Math.round(x)},${Math.round(y)}`) }),
};
const leaf = (content: any): any => ({ kind: 'CommentTreeLeaf', id: Math.random() + '', content });

describe('rich text', () => {
  it('reads the markup: plain italic, ((roman)), [[BOLD]] and {{boxed}}', () => {
    const s = markupSegments('a ((b)) [[c]] {{d}}', 10);
    expect(s.map((x) => x.style)).toEqual(['italic', 'normal', 'italic', 'bold', 'italic', 'normal']);
    expect(s.find((x) => x.style === 'bold')!.w).toBe('C');
    expect(s.find((x) => x.boxed)!.w).toBe('d');
  });
  it('wraps at the given width', () => {
    const lines = breakLines(markupSegments('one two three four five six', 10), 60, kit);
    expect(lines.length).toBeGreaterThan(1);
  });
});

describe('layoutCommentTree', () => {
  beforeEach(() => (drawn.length = 0));

  it('places a 1x3 grid (text, bracket, text) side by side; the bracket spans the row', () => {
    const tree: any = { kind: 'CommentTreeGrid', id: 'g', items: [[leaf({ kind: 'Text', content: 'Gratuletur' }), leaf({ kind: 'Bracket' }), leaf({ kind: 'Text', content: 'Gratultur, aber Notation' })]] };
    const box = layoutCommentTree(tree, kit, 400);
    box.draw(0, 0, box.h);
    const xs = drawn.map((d) => Number(d.split('@')[1].split(',')[0]));
    expect(xs[0]).toBe(0);
    expect(drawn[1].startsWith(']@')).toBeTrue();
    expect(xs[2]).toBeGreaterThan(xs[1]);
    expect(box.w).toBeGreaterThan(50);
  });

  it('stacks rows (witnesses) and keeps columns aligned', () => {
    const tree: any = { kind: 'CommentTreeGrid', id: 'g', items: [
      [leaf({ kind: 'Text', content: 'A' }), leaf({ kind: 'Text', content: 'x' })],
      [leaf({ kind: 'Text', content: 'BBBBBB' }), leaf({ kind: 'Text', content: 'y' })],
    ] };
    const box = layoutCommentTree(tree, kit, 400);
    box.draw(0, 0, box.h);
    const pos = Object.fromEntries(drawn.map((d) => { const [t, p] = d.split('@'); return [t, p.split(',').map(Number)]; }));
    expect(pos['x'][0]).toBe(pos['y'][0]);   // same column
    expect(pos['y'][1]).toBeGreaterThan(pos['x'][1]); // next row
  });

  it('columns take their natural width: a wide cell is not squeezed by narrow neighbours', () => {
    const wide: TreeKit = { ...kit, notes: (_z, _c, maxW) => ({ w: Math.min(300, maxW), h: Math.ceil(300 / Math.min(300, maxW)) * 20, draw: () => {} }) };
    const tree: any = { kind: 'CommentTreeGrid', id: 'g', items: [[
      leaf({ kind: 'Notes', content: { kind: 'ZeileContainer', children: [] } }),
      leaf({ kind: 'Bracket' }),
      leaf({ kind: 'Text', content: 'aus' }),
    ]] };
    // 400 wide, three columns: an equal share (~130) would wrap the 300 wide notes into three rows
    const box = layoutCommentTree(tree, wide, 400);
    expect(box.h).toBe(20);
    // when it really does not fit, the wide column takes what the small ones leave
    const tight = layoutCommentTree(tree, wide, 200);
    expect(tight.h).toBeGreaterThan(20);
  });

  it('draws notes leaves through the kit and ignores undecided cells', () => {
    const tree: any = { kind: 'CommentTreeGrid', id: 'g', items: [[leaf({ kind: 'Notes', content: { kind: 'ZeileContainer', children: [] } }), { kind: 'CommentTreeUndecided', id: 'u' }]] };
    const box = layoutCommentTree(tree, kit, 400);
    box.draw(5, 5, box.h);
    expect(drawn).toEqual(['notes@5,5']);
    expect(box.h).toBe(30);
  });
});
