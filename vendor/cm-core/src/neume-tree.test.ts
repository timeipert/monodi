// Tests of the neume tree. They collect what Monodi-Zero (`apps/monodi/src/app/neume-tree.spec.ts` before the move)
// and neume-docs (`apps/neume-docs/ui/src/utils/neumeTree.test.js` before the move) each relied on.
// Run: `npm test` in packages/core (Node's built-in test runner; Node 22.18 or newer runs TypeScript directly).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  baseCode, buildNeumeTree, continuations, hasSpecialSign, layoutNeumeTree, parseTreeCode, treeCode, treeNotation, VIRGA,
  type BuildOptions, type NeumeTree, type TreeNode,
} from './neume-tree.ts';

const tree = (codes: string[], options?: BuildOptions): NeumeTree => buildNeumeTree(codes, options);
const texts = (t: NeumeTree): string[] => t.nodes.map(n => n.text);
const node = (t: NeumeTree, text: string): TreeNode => t.nodes.find(n => n.text === text)!;
const parentOf = (t: NeumeTree, text: string): string | undefined => t.nodes.find(n => n.text === text)?.parent!.text;

describe('the code of a pattern', () => {
  it('is its first word: blanks around it and a legacy variant letter are dropped', () => {
    assert.equal(baseCode('*u b'), '*u');
    assert.equal(baseCode('  *u  '), '*u');
    assert.equal(baseCode(null), '');
    assert.equal(baseCode(undefined), '');
    assert.equal(baseCode(''), '');
  });
});

describe('the notation of the tree', () => {
  it('turns a bracket into a hyphen between the notes it joins', () => {
    assert.equal(treeNotation('[*u]'), '*-u');
    assert.equal(treeNotation('*u'), '*u');
    assert.equal(treeNotation('*ud[ud]'), '*udu-d');
    assert.equal(treeNotation('[*ud]'), '*-u-d');
    assert.equal(treeNotation('*[ud]'), '*u-d');
    assert.equal(treeNotation('[*u]d'), '*-ud');
    assert.equal(parseTreeCode('[*u]')!.text, '*-u');
    assert.equal(parseTreeCode('[*u]dd')!.count, 4);
  });

  it('does not join two groups that stand next to each other', () => {
    assert.equal(treeNotation('[*u][ud]'), '*-uu-d');
    assert.equal(treeNotation('{*u}{ud}'), '*-uu-d');
  });

  it('keeps the signs on their notes, so a liquescent or a virga is not the plain note', () => {
    assert.equal(treeNotation('*uVd'), '*uVd');
    assert.equal(treeNotation('[*V]u'), '*Vu');
    assert.equal(treeNotation('*uLA'), '*uLA');
    assert.deepEqual(parseTreeCode('*uVd')!.notes, ['*', 'uV', 'd']);
    assert.deepEqual(parseTreeCode('*dL')!.notes, ['*', 'dL']);
    assert.notEqual(parseTreeCode('*dL')!.text, parseTreeCode('*d')!.text);
  });

  it('has no hyphen for a group of one note', () => {
    assert.equal(treeNotation('[*]'), '*');
  });

  it('reads a code with a legacy variant as its code, and nothing that is not a shape', () => {
    assert.equal(treeNotation('*u b'), '*u');
    assert.equal(treeNotation('(Clef)'), '');
    assert.equal(treeNotation('(Custos)'), '');
    assert.equal(treeNotation(''), '');
    assert.equal(treeNotation('udu'), '');
    assert.equal(parseTreeCode('(Clef)'), null);
    assert.equal(parseTreeCode(''), null);
    assert.equal(parseTreeCode('ud'), null);
    assert.equal(parseTreeCode(undefined), null);
  });
});

describe('who grows out of whom', () => {
  it('grows a pattern out of the longest shorter one that it contains', () => {
    const t = tree(['*', '*u', '*ud', '[*u]', '[*u]dd', '*d', '(Clef)', '*ud']);
    assert.equal(parentOf(t, '*u'), '*');
    assert.equal(parentOf(t, '*ud'), '*u');
    assert.equal(parentOf(t, '*d'), '*');
    // *ud is in [*u]dd, with fewer hyphens
    assert.equal(parentOf(t, '*-udd'), '*ud');
    assert.equal(parentOf(tree(['[*u]', '[*u]dd']), '*-udd'), '*-u');
  });

  it('lets *u branch into *ud and *u-d', () => {
    const t = tree(['*', '*u', '*ud', '*[ud]']);
    assert.equal(parentOf(t, '*u'), '*');
    assert.equal(parentOf(t, '*ud'), '*u');
    assert.equal(parentOf(t, '*u-d'), '*u');
  });

  it('has the root grow the single notes: the punctum and the virga', () => {
    const t = tree(['*', '*V', '*u', '*Vd']);
    assert.deepEqual(t.root.children.map(n => n.text), ['*', '*V']);
    assert.equal(parentOf(t, '*u'), '*');
    assert.equal(parentOf(t, '*Vd'), '*V');
  });

  it('tells a virga from a plain note everywhere', () => {
    const t = tree(['*', '*d', '*dV']);
    // *dV is not *d with something added: it is its own shape, as many notes as *d
    assert.equal(parentOf(t, '*d'), '*');
    assert.equal(parentOf(t, '*dV'), '*');
  });

  it('does not put a connected pattern under its unconnected twin: same notes, same column', () => {
    const t = tree(['*', '*u', '[*u]']);
    assert.equal(parentOf(t, '*u'), '*');
    assert.equal(parentOf(t, '*-u'), '*');
  });

  it('takes a hyphenless pattern as a subsequence of a hyphenated one, but not the other way round', () => {
    // *u is in *-ud (drop the hyphen); *-u is not in *u-d (that has no hyphen there)
    assert.equal(parentOf(tree(['*', '*u', '[*u]d']), '*-ud'), '*u');
    assert.equal(parentOf(tree(['*', '[*u]', '*[ud]']), '*u-d'), '*');
    assert.equal(parentOf(tree(['*', '[*u]', '[*u]d']), '*-ud'), '*-u');
  });

  it('prefers the pattern with the same hyphens', () => {
    assert.equal(parentOf(tree(['*', '*u', '[*u]', '[*u]d']), '*-ud'), '*-u');
  });

  it('skips what is not there: the nearest relative it has, else the root', () => {
    assert.equal(parentOf(tree(['*', '*udu']), '*udu'), '*');
    assert.equal(parentOf(tree(['*', '*u', '*udu']), '*udu'), '*u');
    assert.equal(parentOf(tree(['*udu']), '*udu'), '');
    const lone = tree(['*uud']);
    assert.equal(lone.nodes[0].parent, lone.root);
    assert.equal(parentOf(tree(['*u', '*uud']), '*uud'), '*u');
  });

  it('needs the same notes from the start: *du does not grow out of *u', () => {
    assert.equal(parentOf(tree(['*', '*u', '*d', '*du']), '*du'), '*d');
  });

  it('puts a hyphen in the shorter pattern that the longer lacks nowhere', () => {
    const t = tree(['*', '[*u]', '[*ud]', '[*u]d', '*[ud]']);
    assert.equal(parentOf(t, '*-u-d'), '*-u');
    assert.equal(parentOf(t, '*-ud'), '*-u');
    assert.equal(parentOf(t, '*u-d'), '*');
  });

  it('lets every node, however deep, lead back to the root', () => {
    const t = tree(['*', '*u', '*uu', '*uud', '*uudu', '*dd', '[*d]d', '*eV', '*uudu[ud]']);
    for (const n of t.nodes) {
      let at: TreeNode = n;
      let steps = 0;
      while (at.parent && steps++ < 20) at = at.parent;
      assert.equal(at, t.root);
    }
  });
});

describe('the nodes', () => {
  it('are one for every pattern, even if it is written two ways, shown as the plainer one', () => {
    const t = tree(['*', '[*]', '*u']);
    assert.equal(t.nodes.length, 2);
    assert.deepEqual(node(t, '*').codes, ['*', '[*]']);
    assert.equal(node(t, '*').code, '*');
    const flipped = tree(['[*]', '*']);
    assert.equal(flipped.nodes.length, 1);
    assert.equal(flipped.nodes[0].code, '*');
    assert.equal(flipped.nodes[0].codes.length, 2);
  });

  it('leave out what is not a shape, and say which', () => {
    const t = tree(['*', '(Clef)', '(Custos)', '(Clef)']);
    assert.deepEqual(t.skipped, ['(Clef)', '(Custos)']);
    assert.equal(t.nodes.length, 1);
  });

  it('stand in columns by number of notes, and only those that occur', () => {
    const t = tree(['*', '*u', '*uud']);
    assert.deepEqual(t.columns.map(c => c.count), [1, 2, 4]);
    assert.deepEqual(t.columns[2].nodes.map(n => n.text), ['*uud']);
    assert.deepEqual(tree(['*', '*u', '*ud', '[*u]', '[*u]dd', '*d', '(Clef)']).columns.map(c => c.count), [1, 2, 3, 4]);
  });

  it('have the branches of a node top to bottom: without a virga above the virga, then up, level, down, connected last', () => {
    const t = tree(['*', '*d', '*e', '*u', '[*d]', '*dV', '*uV', '[*u]', '*dL']);
    assert.deepEqual(t.root.children[0].children.map(n => n.text), ['*u', '*-u', '*e', '*d', '*-d', '*dL', '*uV', '*dV']);
    const plain = tree(['*', '*d', '*e', '*u']);
    assert.deepEqual(plain.nodes.filter(n => n.parent!.code === '*').map(n => n.code), ['*u', '*e', '*d']);
  });

  it('have the plain note at the top of the first column and the virga at the bottom', () => {
    assert.deepEqual(tree(['*V', '*']).root.children.map(n => n.text), ['*', '*V']);
    assert.deepEqual(tree(['*V', '*L', '*O', '*']).root.children.map(n => n.text), ['*', '*L', '*O', '*V']);
  });

  it('have up above and down below under the virga as well', () => {
    const t = tree(['*V', '*Vd', '*Ve', '*Vu']);
    assert.deepEqual(t.root.children[0].children.map(n => n.text), ['*Vu', '*Ve', '*Vd']);
  });

  it('come back in reading order', () => {
    assert.deepEqual(texts(tree(['*', '*u', '*d', '*ud', '*du'])), ['*', '*u', '*ud', '*d', '*du']);
  });

  it('are an empty tree for no codes', () => {
    for (const t of [tree([]), buildNeumeTree(null)]) {
      assert.deepEqual(t.nodes, []);
      assert.deepEqual(t.columns, []);
      assert.deepEqual(layoutNeumeTree(t, () => ({ w: 10, h: 10 })).edges, []);
    }
  });

  it('treat the virga as the sign VIRGA', () => {
    assert.equal(VIRGA, 'V');
  });
});

describe('the layout', () => {
  const SIZE = () => ({ w: 40, h: 30, anchorY: 15 });
  const codes = ['*', '*V', '*u', '*d', '*e', '*uu', '*ud', '*[ud]', '*uud', '*dd', '*dV', '*Vd', '*uudu'];
  const t = tree(codes);
  const l = layoutNeumeTree(t, SIZE);

  it('has a box for every node and the root, and a line for every node that has a node above it', () => {
    assert.equal(l.boxes.size, t.nodes.length + 1);
    assert.equal(l.edges.length, t.nodes.length - t.root.children.length);
  });

  it('does not draw the root: the single notes are where it begins, each apart, with no line into them', () => {
    assert.deepEqual(t.root.children.map(n => n.text), ['*', '*V']);
    assert.deepEqual(l.columns.map(c => c.count), t.columns.map(c => c.count));
    assert.equal(l.columns[0].count, 1);
    assert.equal(l.columns[0].x, 0);
    assert.equal(l.edges.some(e => e.from === t.root), false);
    for (const n of t.root.children) assert.equal(l.boxes.get(n)!.x, 0);
  });

  it('goes from left to right with the number of notes', () => {
    for (const n of t.nodes) {
      const parent = l.boxes.get(n.parent!)!;
      const box = l.boxes.get(n)!;
      assert.ok(box.x > parent.x + parent.w - 0.001);
    }
    const xs = t.columns.map(c => l.boxes.get(c.nodes[0])!.x);
    assert.deepEqual([...xs].sort((a, b) => a - b), xs);
  });

  it('never lets two boxes of one column overlap', () => {
    for (const col of t.columns) {
      const boxes = col.nodes.map(n => l.boxes.get(n)!).sort((a, b) => a.y - b.y);
      for (let i = 1; i < boxes.length; i++) assert.ok(boxes[i].y >= boxes[i - 1].y + boxes[i - 1].h - 0.001);
    }
  });

  it('keeps everything inside the picture', () => {
    for (const box of l.boxes.values()) {
      assert.ok(box.x >= 0);
      assert.ok(box.y >= 0);
      assert.ok(box.x + box.w <= l.width + 0.001);
      assert.ok(box.y + box.h <= l.height + 0.001);
    }
  });

  it('puts a node level with the middle of its branches', () => {
    const n = node(t, '*u');
    const mine = l.boxes.get(n)!;
    const first = l.boxes.get(n.children[0])!;
    const last = l.boxes.get(n.children[n.children.length - 1])!;
    assert.ok(Math.abs(mine.y + mine.anchorY - (first.y + first.anchorY + last.y + last.anchorY) / 2) < 1e-5);
  });

  it('draws a straight line when the ends are level, a curve when they are not', () => {
    const straight = l.edges.find(e => e.y1 === e.y2)!;
    const curved = l.edges.find(e => e.y1 !== e.y2)!;
    assert.match(straight.d, /^M [\d.]+ [\d.]+ L /);
    assert.match(curved.d, /^M [\d.]+ [\d.]+ L [\d.]+ [\d.]+ C /);
  });

  it('never lets a line cut across a box, even when a pattern skips a column', () => {
    const wide = tree(['*', '*V', '*u', '*ud', '*[ud]', '*udu', '*[udu]', '*uudd', '*[uu]dd', '*uV', '*uVd', '*d', '*dd', '*ddd', '*dddd', '*dddddd', '*ud', '*udL', '*eO', '*eOdd']);
    const sizes = (n: TreeNode) => ({ w: 30 + (n.text.length * 7) % 40, h: 20 + (n.text.length * 11) % 50, anchorY: 10 });
    const inside = (x: number, y: number, b: { x: number; y: number; w: number; h: number }) => x > b.x + 0.5 && x < b.x + b.w - 0.5 && y > b.y + 0.5 && y < b.y + b.h - 0.5;
    const bezier = (p0: number, p1: number, p2: number, p3: number, u: number) => (1 - u) ** 3 * p0 + 3 * (1 - u) ** 2 * u * p1 + 3 * (1 - u) * u * u * p2 + u ** 3 * p3;
    for (const showRoot of [false, true]) {
      const big = layoutNeumeTree(wide, sizes, { showRoot });
      let skipped = 0;
      for (const e of big.edges) {
        const points: [number, number][] = [];
        for (let i = 0; i <= 40; i++) {
          const u = i / 40;
          if (e.y1 === e.y2) { points.push([e.x1 + (e.x2 - e.x1) * u, e.y1]); continue; }
          points.push([e.x1 + (e.xa - e.x1) * u, e.y1]);
          const mid = (e.xa + e.xb) / 2;
          points.push([bezier(e.xa, mid, mid, e.xb, u), bezier(e.y1, e.y1, e.y2, e.y2, u)]);
          points.push([e.xb + (e.x2 - e.xb) * u, e.y2]);
        }
        for (const [x, y] of points) {
          for (const [n, box] of big.boxes) {
            if (n === wide.root) continue;
            assert.equal(inside(x, y, box), false, `${e.from.text} -> ${e.to.text} cuts ${n.text}`);
          }
        }
        if (e.to.count - e.from.count > 1) skipped++;
      }
      assert.ok(skipped > 0);
    }
  });

  it('bends in the gap after the column of the box the line leaves', () => {
    for (const showRoot of [false, true]) {
      const shown = layoutNeumeTree(t, SIZE, { showRoot });
      for (const e of shown.edges.filter(e => e.y1 !== e.y2)) {
        const col = shown.columns.find(c => c.count === e.from.count)!;
        assert.ok(e.xa >= col.x + col.w);
        const next = shown.columns[shown.columns.indexOf(col) + 1];
        assert.ok(e.xb <= next.x);
        assert.ok(e.xa <= e.xb);
      }
    }
  });

  it('has the lines end where the boxes begin', () => {
    for (const e of l.edges) {
      const a = l.boxes.get(e.from)!;
      const b = l.boxes.get(e.to)!;
      assert.ok(e.x1 > a.x + a.w - 0.001);
      assert.ok(e.x2 < b.x + 0.001);
      assert.ok(Math.abs(e.y1 - (a.y + a.anchorY)) < 1e-5);
      assert.ok(Math.abs(e.y2 - (b.y + b.anchorY)) < 1e-5);
    }
  });

  it('gives a taller box room', () => {
    const tall = layoutNeumeTree(t, n => ({ w: 40, h: n.count * 20, anchorY: 10 }));
    for (const col of t.columns) {
      const boxes = col.nodes.map(n => tall.boxes.get(n)!).sort((a, b) => a.y - b.y);
      for (let i = 1; i < boxes.length; i++) assert.ok(boxes[i].y >= boxes[i - 1].y + boxes[i - 1].h - 0.001);
    }
  });

  it('uses the middle of a box as its anchor when none is given, and asks for the size of the root only when it is shown', () => {
    const asked: TreeNode[] = [];
    const small = tree(['*']);
    const hidden = layoutNeumeTree(small, n => { asked.push(n); return { w: 10, h: 10 }; });
    assert.equal(hidden.boxes.get(small.nodes[0])!.anchorY, 5);
    assert.equal(asked.includes(small.root), false);
    layoutNeumeTree(small, n => { asked.push(n); return { w: 10, h: 10 }; }, { showRoot: true });
    assert.equal(asked.includes(small.root), true);
  });

  describe('with the root shown (Monodi-Zero)', () => {
    const rooted = tree(['*', '*u', '*d', '*ud']);
    const shown = layoutNeumeTree(rooted, () => ({ w: 20, h: 10 }), { columnGap: 30, rowGap: 4, showRoot: true });
    const box = (code: string) => shown.boxes.get(rooted.nodes.find(n => n.code === code)!)!;

    it('puts the root in a column of its own and each column to the right of the one before', () => {
      assert.deepEqual(shown.columns.map(c => c.count), [0, 1, 2, 3]);
      assert.equal(shown.boxes.get(rooted.root)!.x, 0);
      assert.ok(shown.boxes.get(rooted.root)!.x < box('*').x);
      assert.ok(box('*').x < box('*u').x);
      assert.ok(box('*u').x < box('*ud').x);
      assert.equal(box('*u').x, box('*d').x);
    });

    it('puts the branches one below the other, without overlap, and a parent level with its branches', () => {
      const up = box('*u'), down = box('*d');
      assert.ok(up.y + up.h <= down.y);
      const star = box('*');
      assert.ok(Math.abs(star.y + star.anchorY - (up.y + up.anchorY + down.y + down.anchorY) / 2) < 1e-3);
    });

    it('draws one line for every box, from its parent (the root included) to it', () => {
      assert.equal(shown.edges.length, rooted.nodes.length);
      assert.ok(shown.edges.some(e => e.from === rooted.root));
      assert.ok(shown.edges.every(e => e.x2 > e.x1));
    });
  });
});

describe('going on', () => {
  it('writes notes and hyphens as a code again', () => {
    assert.equal(treeCode(['*', 'u'], [false]), '*u');
    assert.equal(treeCode(['*', 'u'], [true]), '[*u]');
    assert.equal(treeCode(['*', 'u', 'd'], [false, true]), '*[ud]');
    assert.equal(treeCode(['*', 'u', 'd'], [true, true]), '[*ud]');
    assert.equal(treeCode(['*', 'u', 'd'], [true, false]), '[*u]d');
    assert.equal(treeCode(['*', 'u', 'd', 'u', 'd'], [false, false, false, true]), '*ud[ud]');
    assert.equal(treeCode(['*', 'u', 'd', 'u'], [true, false, true]), '[*u][du]');
  });

  it('gives back the text of the notes it was made from, whatever the links', () => {
    for (const links of [[false, false, false], [true, false, true], [true, true, true], [false, true, false], [true, false, false]]) {
      const notes = ['*', 'u', 'dV', 'e'];
      const text = notes.map((n, i) => n + (links[i] ? '-' : '')).join('');
      assert.equal(treeNotation(treeCode(notes, links)), text);
    }
  });

  it('makes six boxes from a box: up, level, down, each apart or joined', () => {
    assert.deepEqual(continuations(tree(['*u']).nodes[0]).map(treeNotation), ['*uu', '*u-u', '*ue', '*u-e', '*ud', '*u-d']);
  });

  it('adds the boxes to the tree, under the box it was gone on from', () => {
    const t = tree(['*', '*u'], { grown: ['*u'] });
    assert.deepEqual(texts(t), ['*', '*u', '*uu', '*u-u', '*ue', '*u-e', '*ud', '*u-d']);
    assert.equal(node(t, '*uu').parent!.text, '*u');
    assert.equal(node(t, '*u').grown, true);
    assert.equal(node(t, '*uu').chosen, false);
    assert.equal(node(t, '*').chosen, true);
  });

  it('can go on and on: more columns than the patterns that were chosen', () => {
    const t = tree(['*'], { grown: ['*', '*u', '*uu', '*uuu'] });
    assert.deepEqual(t.columns.map(c => c.count), [1, 2, 3, 4, 5]);
    assert.equal(node(t, '*uuuu').parent!.text, '*uuu');
  });

  it('does not go on from what is not there', () => {
    assert.deepEqual(texts(tree(['*'], { grown: ['*uu'] })), ['*']);
  });

  it('does not make a box twice that was chosen: it stays a chosen box', () => {
    const t = tree(['*', '*u', '*ud'], { grown: ['*u'] });
    assert.equal(t.nodes.filter(n => n.text === '*ud').length, 1);
    assert.equal(node(t, '*ud').chosen, true);
    assert.deepEqual(node(t, '*ud').codes, ['*ud']);
  });

  it('lets a chosen pattern move under a box that was made for it', () => {
    assert.equal(parentOf(tree(['*', '*udu']), '*udu'), '*');
    assert.equal(parentOf(tree(['*', '*udu'], { grown: ['*', '*u', '*ud'] }), '*udu'), '*ud');
  });
});

describe('going on, where it is allowed', () => {
  const upTo3 = (code: string) => treeNotation(code).replace(/-/g, '').length <= 3;

  it('makes only the boxes that are allowed', () => {
    const t = tree(['*', '*u'], { grown: ['*u'], allow: code => !treeNotation(code).includes('e') });
    assert.deepEqual(texts(t), ['*', '*u', '*uu', '*u-u', '*ud', '*u-d']);
  });

  it('knows which boxes can be gone on from', () => {
    const t = tree(['*', '*uu'], { allow: upTo3 });
    assert.equal(node(t, '*').canGrow, true);
    assert.equal(node(t, '*uu').canGrow, false);
    // with nothing forbidden every box can
    assert.equal(tree(['*uu']).nodes[0].canGrow, true);
  });

  it('is not "gone on from" where nothing was made', () => {
    const t = tree(['*', '*uu'], { grown: ['*uu'], allow: upTo3 });
    assert.equal(node(t, '*uu').grown, false);
    assert.equal(t.nodes.length, 2);
  });

  it('never makes a box further on from one it did not make', () => {
    // *u is not gone on from, so *uu stays out even if it is listed
    assert.deepEqual(texts(tree(['*'], { grown: ['*u'], allow: () => true })), ['*']);
  });
});

describe('hiding', () => {
  it('takes a box out, and everything that grows out of it', () => {
    const t = tree(['*', '*u', '*ud', '*uu', '*d', '*du'], { hidden: ['*u'] });
    assert.deepEqual(texts(t), ['*', '*d', '*du']);
    assert.equal(t.hiddenCount, 3);
    assert.deepEqual(t.hidden.map(n => n.text), ['*u']);
  });

  it('leaves the others where they were', () => {
    assert.equal(parentOf(tree(['*', '*u', '*d', '*du'], { hidden: ['*u'] }), '*du'), '*d');
  });

  it('leaves columns out that are empty then', () => {
    assert.deepEqual(tree(['*', '*u', '*uud'], { hidden: ['*u'] }).columns.map(c => c.count), [1]);
  });

  it('also hides what was made by going on, and its boxes with it', () => {
    const t = tree(['*', '*u'], { grown: ['*u'], hidden: ['*uu'] });
    assert.deepEqual(texts(t), ['*', '*u', '*u-u', '*ue', '*u-e', '*ud', '*u-d']);
  });

  it('hides everything if the first box is hidden, and says nothing about what is not there', () => {
    const t = tree(['*', '*u'], { hidden: ['*', '*zz'] });
    assert.deepEqual(t.nodes, []);
    assert.deepEqual(t.hidden.map(n => n.text), ['*']);
    assert.deepEqual(t.root.children, []);
  });
});

describe('special signs', () => {
  it('are any sign on a note other than the virga', () => {
    for (const code of ['*dL', '[*uO]', '*uuQ', '*SeS', '*uVL', '*u[uQu]d', '*uW']) assert.equal(hasSpecialSign(code), true, code);
    for (const code of ['*', '*V', '[*Vd]', '*uuVdduV', '*[uVd]d', '*u[ud]']) assert.equal(hasSpecialSign(code), false, code);
  });

  it('are not in a code that is not a neume shape', () => {
    assert.equal(hasSpecialSign('(Clef-C)'), false);
  });
});
