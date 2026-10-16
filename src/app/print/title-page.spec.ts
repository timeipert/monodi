import { TITLE_PRESETS, TitleTemplate, avoidOrphan, layoutCover, newBlock, sanitizeTitleTemplate } from './title-page';

const measure = (t: string, size: number) => Array.from(t).length * size * 0.5;
// a book serif: a character is about 0.44 em wide on average (the test measure above is much wider)
const bookMeasure = (t: string, size: number) => Array.from(t).length * size * 0.44;
const page = { w: 600, h: 800 };
const values: { [k: string]: string } = { titel: 'Mein Band', quelle: 'Aachen, Domarchiv, Hs. G 13', gattung1: 'Antiphon', herausgeber: '' };
const lookup = (n: string) => values[n];

function tpl(blocks: Partial<ReturnType<typeof newBlock>>[], o: Partial<TitleTemplate> = {}): TitleTemplate {
  return { top: 10, side: 100, bottom: 50, lineHeight: 1.25, variables: [], blocks: blocks.map((b, i) => ({ ...newBlock(b.kind ?? 'text', 'b' + i), ...b })), ...o };
}
const texts = (l: ReturnType<typeof layoutCover>) => l.items.filter((i) => i.kind === 'text') as Extract<typeof l.items[number], { kind: 'text' }>[];

describe('cover layout', () => {
  it('stacks the blocks downwards from the top with the space before each', () => {
    const l = layoutCover(tpl([{ text: 'Titel', size: 20, before: 0 }, { text: 'Untertitel', size: 10, before: 30 }]), lookup, page, measure);
    const [a, b] = texts(l);
    expect(a.y).toBeCloseTo(80 + 20 * (0.8 + 0.125), 5);          // 10 % of 800 plus the baseline
    // second block: after the first one (25 pt) plus 30 pt of space
    expect(b.y - a.y).toBeCloseTo(20 * 1.25 + 30 + (10 - 20) * (0.8 + 0.125), 5);
  });

  it('ignores the space before the first block', () => {
    const l = layoutCover(tpl([{ text: 'x', size: 10, before: 200 }]), lookup, page, measure);
    expect(texts(l)[0].y).toBeLessThan(100);
  });

  it('puts the placeholders in and leaves out a block whose placeholder is empty', () => {
    const l = layoutCover(tpl([{ text: '$gattung1$en aus\n$quelle$' }, { text: 'herausgegeben von\n\n$herausgeber$' }, { text: '$unbekannt$', hideIfEmpty: false }]), lookup, page, measure);
    expect(texts(l).map((t) => t.text)).toEqual(['Antiphonen aus', 'Aachen, Domarchiv, Hs. G 13']);
    expect(l.unknown).toEqual(['unbekannt']);
  });

  it('wraps long lines at the width of the block and keeps every word', () => {
    const long = 'eins zwei drei vier fünf sechs sieben acht neun zehn elf zwölf';
    const l = layoutCover(tpl([{ text: long, size: 10, width: 50 }]), lookup, page, measure);   // 200 pt wide: 40 characters
    const lines = texts(l);
    expect(lines.length).toBeGreaterThan(1);
    for (const t of lines) expect(measure(t.text, 10)).toBeLessThanOrEqual(200);
    expect(lines.map((t) => t.text).join(' ')).toBe(long);
  });

  it('aligns left, centre and right inside the side margins', () => {
    const l = layoutCover(tpl([{ text: 'a', align: 'left' }, { text: 'b', align: 'center' }, { text: 'c', align: 'right' }]), lookup, page, measure);
    expect(texts(l).map((t) => t.x)).toEqual([100, 300, 500]);
  });

  it('stacks bottom blocks upwards from the bottom margin', () => {
    const l = layoutCover(tpl([{ text: 'oben' }, { text: 'Fuß', size: 8, anchor: 'bottom', before: 0 }]), lookup, page, measure);
    const foot = texts(l).find((t) => t.text === 'Fuß')!;
    // the line box ends at 800 - 50
    expect(foot.y + 8 * (1.25 - 0.8 - 0.125)).toBeCloseTo(750, 5);
    expect(l.overflow).toBeFalse();
  });

  it('draws a rule of the given length, centred', () => {
    const l = layoutCover(tpl([{ kind: 'rule', width: 20, size: 1, before: 0 }]), lookup, page, measure);
    const r = l.items[0] as any;
    expect(r.x2 - r.x1).toBeCloseTo(80, 5);                    // 20 % of 400
    expect((r.x1 + r.x2) / 2).toBeCloseTo(300, 5);
  });

  it('says when the blocks do not fit', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ text: 'Zeile ' + i, size: 20 }));
    expect(layoutCover(tpl(many), lookup, page, measure).overflow).toBeTrue();
    expect(layoutCover(tpl([{ text: 'x' }]), lookup, page, measure).overflow).toBeFalse();
  });

  it('an empty template makes an empty page', () => {
    expect(layoutCover(tpl([]), lookup, page, measure).items).toEqual([]);
  });

  it('both presets lay out without problems and the example uses the placeholders of the volume', () => {
    for (const p of TITLE_PRESETS) {
      const l = layoutCover(p.template, (n) => values[n] ?? '2026', page, bookMeasure);
      expect(l.items.length).toBeGreaterThan(0);
      expect(l.unknown).toEqual([]);
    }
    const cm = TITLE_PRESETS.find((p) => p.id === 'corpus-monodicum')!.template;
    const l = layoutCover(cm, (n) => (n === 'herausgeber' ? 'Isabel Kraft' : values[n] ?? '2026'), { w: 595.28, h: 765.35 }, bookMeasure);
    const t = texts(l).map((x) => x.text);
    expect(t).toContain('Antiphonen aus');
    expect(t).toContain('Isabel Kraft');
    expect(l.overflow).toBeFalse();
  });
});

describe('orphans in the cover', () => {
  it('moves the last word of the line before down when a paragraph ends on a lone short word', () => {
    expect(avoidOrphan(['Aachen, Domarchiv, Hs. G 13; Köln, Dombibliothek, Cod.', '1'])).toEqual(['Aachen, Domarchiv, Hs. G 13; Köln, Dombibliothek,', 'Cod. 1']);
  });
  it('leaves everything else alone', () => {
    expect(avoidOrphan(['one line'])).toEqual(['one line']);
    expect(avoidOrphan(['a long first line', 'second line'])).toEqual(['a long first line', 'second line']);
    expect(avoidOrphan(['single', 'ab'])).toEqual(['single', 'ab']);
    expect(avoidOrphan(['x y z', 'longword'])).toEqual(['x y z', 'longword']);
  });
  it('the laid out cover does not end a paragraph on a lone number', () => {
    const t = tpl([{ text: 'eins zwei drei vier fünf sechs sieben acht neun Cod. 1', size: 10, width: 60 }]);
    const lines = texts(layoutCover(t, lookup, page, measure)).map((x) => x.text);
    expect(lines[lines.length - 1]).not.toBe('1');
  });
});

describe('cover template sanitizing', () => {
  it('makes anything into a valid template', () => {
    for (const junk of [null, undefined, 5, 'x', [], {}, { blocks: 'no' }, { blocks: [null, 3, {}] }]) {
      const t = sanitizeTitleTemplate(junk);
      expect(Array.isArray(t.blocks)).toBeTrue();
      for (const b of t.blocks) { expect(b.size).toBeGreaterThan(0); expect(b.color).toMatch(/^#[0-9a-f]{6}$/); }
    }
  });

  it('clamps numbers, fixes colours and enums, makes the ids unique', () => {
    const t = sanitizeTitleTemplate({ top: 999, side: -5, lineHeight: 'x', blocks: [
      { id: 'a', text: 'x', size: 1000, color: 'red', align: 'middle', style: 'bold', anchor: 'sideways', width: 3 },
      { id: 'a', text: 'y' },
    ] });
    expect(t.top).toBe(70);
    expect(t.side).toBe(0);
    expect(t.lineHeight).toBe(1.3);
    expect(t.blocks[0]).toEqual(jasmine.objectContaining({ size: 72, color: '#000000', align: 'center', style: 'bold', anchor: 'flow', width: 10 }));
    expect(t.blocks[0].id).not.toBe(t.blocks[1].id);
  });

  it('keeps a valid template as it is (also the presets) and cuts too many blocks and variables', () => {
    for (const p of TITLE_PRESETS) expect(sanitizeTitleTemplate(JSON.parse(JSON.stringify(p.template)))).toEqual(p.template);
    const t = sanitizeTitleTemplate({ blocks: Array.from({ length: 80 }, () => ({ text: 'x' })), variables: Array.from({ length: 80 }, (_, i) => ({ key: 'k' + i, value: 'v' })) });
    expect(t.blocks.length).toBe(40);
    expect(t.variables.length).toBe(30);
  });

  it('drops variables with a name a placeholder cannot have, and repeated names', () => {
    const t = sanitizeTitleTemplate({ variables: [{ key: 'a b', value: '1' }, { key: 'Ok', value: '2' }, { key: 'ok', value: '3' }, { key: '', value: '4' }] });
    expect(t.variables).toEqual([{ key: 'Ok', value: '2' }]);
  });
});
