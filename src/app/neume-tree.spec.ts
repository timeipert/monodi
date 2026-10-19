import { buildNeumeTree, edgePath, layoutNeumeTree, parseTreeCode } from './neume-tree';

const parentOf = (tree: ReturnType<typeof buildNeumeTree>, code: string) => tree.nodes.find(n => n.code === code)!.parent!.code;

describe('neume tree (as the Neumen-Editor draws it)', () => {
  describe('parseTreeCode', () => {
    it('turns brackets into hyphens between the notes of a group', () => {
      expect(parseTreeCode('[*u]')!.text).toBe('*-u');
      expect(parseTreeCode('*u')!.text).toBe('*u');
      expect(parseTreeCode('*ud[ud]')!.text).toBe('*udu-d');
      expect(parseTreeCode('[*ud]')!.text).toBe('*-u-d');
      expect(parseTreeCode('[*u]dd')!.count).toBe(4);
    });

    it('keeps the signs of a note with it, so a liquescent is not the plain note', () => {
      expect(parseTreeCode('*dL')!.notes).toEqual(['*', 'dL']);
      expect(parseTreeCode('*dL')!.text).not.toBe(parseTreeCode('*d')!.text);
    });

    it('is null for what is not a neume shape', () => {
      expect(parseTreeCode('(Clef)')).toBeNull();
      expect(parseTreeCode('')).toBeNull();
      expect(parseTreeCode('ud')).toBeNull();
    });
  });

  describe('buildNeumeTree', () => {
    const tree = buildNeumeTree(['*', '*u', '*ud', '[*u]', '[*u]dd', '*d', '(Clef)', '*ud']);

    it('grows a pattern out of the longest shorter one that it contains', () => {
      expect(parentOf(tree, '*u')).toBe('*');
      expect(parentOf(tree, '*ud')).toBe('*u');
      expect(parentOf(tree, '*d')).toBe('*');
    });

    it('does not put a connected pair under the same notes written apart', () => {
      expect(parentOf(tree, '[*u]')).toBe('*');           // *-u is not under *u: it has as many notes
      expect(parentOf(tree, '[*u]dd')).toBe('*ud');       // the longest shorter pattern it contains: *ud is in it, with fewer hyphens
      expect(parentOf(buildNeumeTree(['[*u]', '[*u]dd']), '[*u]dd')).toBe('[*u]');
    });

    it('makes a column for each number of notes that occurs, and says what it left out', () => {
      expect(tree.columns.map(c => c.count)).toEqual([1, 2, 3, 4]);
      expect(tree.skipped).toEqual(['(Clef)']);
    });

    it('is one box for a shape written two ways, shown as the plainer one', () => {
      const t = buildNeumeTree(['[*]', '*']);
      expect(t.nodes.length).toBe(1);
      expect(t.nodes[0].code).toBe('*');
      expect(t.nodes[0].codes.length).toBe(2);
    });

    it('lets a pattern whose shorter relatives are missing grow out of the nearest one, or the root', () => {
      const t = buildNeumeTree(['*uud']);
      expect(t.nodes[0].parent).toBe(t.root);
      const t2 = buildNeumeTree(['*u', '*uud']);
      expect(parentOf(t2, '*uud')).toBe('*u');
    });

    it('orders the branches of a node top to bottom: up above level above down', () => {
      const t = buildNeumeTree(['*', '*d', '*e', '*u']);
      expect(t.root.children.map(c => c.code)).toEqual(['*', ]);
      expect(t.nodes.filter(n => n.parent!.code === '*').map(n => n.code)).toEqual(['*u', '*e', '*d']);
    });

    it('is empty without patterns', () => {
      expect(buildNeumeTree([]).nodes).toEqual([]);
    });
  });

  describe('layoutNeumeTree', () => {
    const tree = buildNeumeTree(['*', '*u', '*d', '*ud']);
    const layout = layoutNeumeTree(tree, () => ({ w: 20, h: 10 }), 30, 4);

    it('puts each column to the right of the one before, by number of notes', () => {
      const x = (code: string) => layout.boxes.get(tree.nodes.find(n => n.code === code)!)!.x;
      expect(x('*')).toBeLessThan(x('*u'));
      expect(x('*u')).toBeLessThan(x('*ud'));
      expect(x('*u')).toBe(x('*d'));
      expect(layout.columns.map(c => c.count)).toEqual([0, 1, 2, 3]);
    });

    it('puts the branches one below the other, without overlap, and a parent level with its branches', () => {
      const box = (code: string) => layout.boxes.get(tree.nodes.find(n => n.code === code)!)!;
      const up = box('*u'), down = box('*d');
      expect(up.y + up.h).toBeLessThanOrEqual(down.y);
      const star = box('*');
      const middle = (up.y + up.anchorY + down.y + down.anchorY) / 2;
      expect(star.y + star.anchorY).toBeCloseTo(middle, 3);
    });

    it('draws one edge for every box, from its parent to it', () => {
      expect(layout.edges.length).toBe(tree.nodes.length);
      expect(layout.edges.every(e => e.x2 > e.x1)).toBeTrue();
    });

    it('draws a straight edge when level and a curve when not', () => {
      expect(edgePath({ from: tree.root, to: tree.root, x1: 0, y1: 5, x2: 10, y2: 5 })).toBe('M 0 5 L 10 5');
      expect(edgePath({ from: tree.root, to: tree.root, x1: 0, y1: 0, x2: 10, y2: 8 })).toContain(' C ');
    });
  });
});
