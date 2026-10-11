import { joinImageDefs, markdownToHtml, nextImageId, parseInline, parseMarkdown, safeHref, splitImageDefs } from './markdown';
import { layoutInlines } from './markdown-layout';

describe('markdown', () => {
  it('parses emphasis, code and links inline', () => {
    const ins = parseInline('a **bold** and *it* and `c` and [x](https://e.org) end');
    expect(ins.find((i) => i.bold)?.t).toBe('bold');
    expect(ins.find((i) => i.italic)?.t).toBe('it');
    expect(ins.find((i) => i.code)?.t).toBe('c');
    expect(ins.find((i) => i.href)?.href).toBe('https://e.org');
  });

  it('reads links whose text and address were hard-wrapped (copied from a word processor)', () => {
    const src = '[Hodie\nsalus](https://www.google.com/url?q=https://stageinternal.corpus-\nmonodicum.de/d/43355b4c-86a7-4316-8124-069c4e4f1096&sa=D&source=editors&ust=1763572404214974&usg=AOvVaw1YZeDRW5zPeYwDyHlCdAbk)';
    const b: any = parseMarkdown(src);
    expect(b.length).toBe(1);
    const link = b[0].inlines.find((i: any) => i.href);
    expect(link.t).toBe('Hodie salus');
    expect(link.href).toBe('https://www.google.com/url?q=https://stageinternal.corpus-monodicum.de/d/43355b4c-86a7-4316-8124-069c4e4f1096&sa=D&source=editors&ust=1763572404214974&usg=AOvVaw1YZeDRW5zPeYwDyHlCdAbk');
    expect(markdownToHtml(src)).toContain('<a href="https://www.google.com/url?q=https://stageinternal.corpus-monodicum.de/d/');
  });

  it('keeps links with a title, with parentheses in the address, and ignores empty ones', () => {
    expect(parseInline('[a](https://e.org/x_(y) "T")').find((i) => i.href)?.href).toBe('https://e.org/x_(y)');
    expect(parseInline('[a]( )').some((i) => i.href)).toBeFalse();
  });

  it('leaves snake_case and a lone asterisk alone', () => {
    expect(parseInline('a_b_c and 2 * 3').map((i) => i.t).join('')).toBe('a_b_c and 2 * 3');
  });

  it('supports bold italic and escapes', () => {
    const i = parseInline('***both*** \\*plain\\*');
    expect(i[0]).toEqual(jasmine.objectContaining({ t: 'both', bold: true, italic: true }));
    expect(i.map((x) => x.t).join('')).toBe('both *plain*');
  });

  it('parses headings, paragraphs, quotes, rules and code', () => {
    const b = parseMarkdown('# Title\n\nfirst line\nsecond line\n\n> quoted\n\n---\n\n```\ncode\n```');
    expect(b.map((x) => x.kind)).toEqual(['heading', 'paragraph', 'quote', 'rule', 'code']);
    const p: any = b[1];
    expect(p.inlines.map((x: any) => x.t).join('')).toBe('first line second line');
  });

  it('parses nested bullet and numbered lists', () => {
    const b: any = parseMarkdown('- one\n- two\n  - inner\n- three\n\n1. a\n2. b');
    expect(b[0].kind).toBe('list');
    expect(b[0].items.length).toBe(3);
    expect(b[0].items[1].blocks[0].kind).toBe('list');
    expect(b[0].items[1].blocks[0].items[0].inlines[0].t).toBe('inner');
    expect(b[1].ordered).toBeTrue();
    expect(b[1].items.length).toBe(2);
  });

  it('joins a continued list line into its item', () => {
    const b: any = parseMarkdown('- first\n  continued\n- second');
    expect(b[0].items[0].inlines.map((x: any) => x.t).join('')).toBe('first continued');
  });

  it('escapes HTML in the preview and only links web addresses', () => {
    const html = markdownToHtml('<script>alert(1)</script> [bad](javascript:alert(1)) [ok](https://e.org)');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('href="javascript');
    expect(html).toContain('href="https://e.org"');
    expect(safeHref('javascript:alert(1)')).toBeNull();
  });

  it('parses pipe tables with alignment and escaped pipes', () => {
    const b: any = parseMarkdown('Intro\n\n| Folio | Text | N |\n|:--|:-:|--:|\n| 1r | **Alleluia** | 3 |\n| 2v | a \\| b | 12 |\n\nAfter');
    expect(b.map((x: any) => x.kind)).toEqual(['paragraph', 'table', 'paragraph']);
    const t = b[1];
    expect(t.align).toEqual(['left', 'center', 'right']);
    expect(t.head.length).toBe(3);
    expect(t.rows.length).toBe(2);
    expect(t.rows[0][1][0].bold).toBeTrue();
    expect(t.rows[1][1][0].t).toBe('a | b');
  });

  it('pads short table rows and does not take a rule for a table', () => {
    const t: any = parseMarkdown('a | b\n--|--\nonly')[0];
    expect(t.kind).toBe('table');
    expect(t.rows[0].length).toBe(2);
    // one header cell against a "---" line: not a table (the header has two cells)
    expect(parseMarkdown('a | b\n---').some((x) => x.kind === 'table')).toBeFalse();
  });

  it('reads a table whose rows were hard-wrapped, with short rows and a repeated separator', () => {
    const src = [
      '| 1-107v | GradualeAnlage: Weihnachts- und Osterfestkreis sowie Sonn- und',
      'Ferialtage im Kirchenjahr, Heiligenfeste (Stephanus, Iohannes Evangelista und',
      'Innocentes innerhalb des Weihnachtsfestkreises); Offertorien mit Versen  |',
      '| --- | --- |',
      '| Nach f. 98v Lakune  |',
      '| 107v-111v| Tropar  |',
      '| 120v-168v| SequentiarZwei Serien: Sequenzen des franzosischen und deutschen',
      'Überlieferungsraumes  |',
      '| 171-172| Gesange fur Heiligenfeste (18. Jahrhundert) | ',
      '| ---|--- |',
    ].join('\n');
    const b: any = parseMarkdown(src);
    expect(b.length).toBe(1);
    expect(b[0].kind).toBe('table');
    expect(b[0].head.length).toBe(2);
    expect(b[0].head[0][0].t).toBe('1-107v');
    expect(b[0].head[1].map((i: any) => i.t).join('')).toContain('Sonn- und Ferialtage im Kirchenjahr');
    expect(b[0].rows.length).toBe(4);               // the closing "| ---|--- |" is not a row
    expect(b[0].rows[0][1]).toEqual([]);            // a short row is padded
    expect(b[0].rows[2][1].map((i: any) => i.t).join('')).toContain('deutschen Überlieferungsraumes');
  });

  it('does not swallow ordinary text that merely starts with a pipe', () => {
    const b: any = parseMarkdown('| not a table\nand some more text\n\nnext paragraph');
    expect(b.map((x: any) => x.kind)).toEqual(['paragraph', 'paragraph']);
  });

  it('renders tables as HTML', () => {
    const html = markdownToHtml('| A | B |\n|---|--:|\n| 1 | 2 |');
    expect(html).toContain('<th>A</th>');
    expect(html).toContain('<td style="text-align:right">2</td>');
  });

  it('turns images into blocks of their own, also from the middle of a line', () => {
    const b: any = parseMarkdown('Before ![Folio 1r](https://e.org/a.jpg "Folio 1r, recto") after');
    expect(b.map((x: any) => x.kind)).toEqual(['paragraph', 'image', 'paragraph']);
    expect(b[1]).toEqual(jasmine.objectContaining({ src: 'https://e.org/a.jpg', alt: 'Folio 1r', title: 'Folio 1r, recto' }));
  });

  it('resolves images and links by reference', () => {
    const b: any = parseMarkdown('![Scan][img-1]\n\n[the site][site]\n\n[img-1]: data:image/png;base64,AAAA\n[site]: https://e.org/');
    expect(b[0]).toEqual(jasmine.objectContaining({ kind: 'image', src: 'data:image/png;base64,AAAA', alt: 'Scan' }));
    expect(b[1].inlines[0].href).toBe('https://e.org/');
    expect(b.length).toBe(2);   // the definitions are not printed
  });

  it('keeps pictures out of headings and table cells, and below list items', () => {
    const b: any = parseMarkdown('# Title ![x](https://e.org/i.png)\n\n- item ![y](https://e.org/j.png)');
    expect(b[0].inlines.some((i: any) => i.img)).toBeFalse();
    expect(b[1].items[0].blocks[0].kind).toBe('image');
  });

  it('shows only safe image sources in the preview', () => {
    const html = markdownToHtml('![ok](https://e.org/a.png) ![bad](javascript:alert(1)) ![d](data:image/png;base64,AAAA)');
    expect(html).toContain('<img src="https://e.org/a.png"');
    expect(html).toContain('<img src="data:image/png;base64,AAAA"');
    expect(html).not.toContain('javascript:');
  });

  it('splits embedded picture definitions off and puts back those still used', () => {
    const full = 'Text ![a][img-1]\n\n[img-1]: data:image/png;base64,AAAA\n[img-2]: data:image/png;base64,BBBB\n';
    const { body, defs } = splitImageDefs(full);
    expect(body).toBe('Text ![a][img-1]');
    expect(Object.keys(defs)).toEqual(['img-1', 'img-2']);
    expect(joinImageDefs(body, defs)).toBe('Text ![a][img-1]\n\n[img-1]: data:image/png;base64,AAAA\n');
    expect(nextImageId(defs)).toBe('img-3');
    expect(joinImageDefs('no pictures', defs)).toBe('no pictures');
  });

  it('never loops on odd input', () => {
    for (const t of ['', '\n\n', '#', '- ', '>', '```', '* * *', '1.', '   ', '[', '**', '`', '|', '| a |', '![', '![x]', '![x](', '[x]: ', '|--|']) expect(() => parseMarkdown(t)).not.toThrow();
  });
});

describe('markdown layout', () => {
  const measure = (t: string) => t.length * 5;   // 5 pt per character, also for the space

  it('breaks lines at the width', () => {
    const lines = layoutInlines(parseInline('aaaa bbbb cccc dddd'), 10, 50, measure);
    expect(lines.length).toBe(2);
    expect(lines[0].map((p) => p.text)).toEqual(['aaaa', 'bbbb']);
    expect(lines[0][1].x).toBe(25);
  });

  it('keeps touching pieces together', () => {
    const lines = layoutInlines(parseInline('**bold**, next'), 10, 45, measure);
    // "bold," is one word of 25 pt; "next" does not fit beside it
    expect(lines[0].map((p) => p.text)).toEqual(['bold', ',']);
    expect(lines[0][1].x).toBe(lines[0][0].width);
    expect(lines.length).toBe(2);
  });

  it('cuts a word wider than the line', () => {
    const lines = layoutInlines(parseInline('abcdefghijkl'), 10, 25, measure);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.every((l) => l.every((p) => p.x + p.width <= 25))).toBeTrue();
    expect(lines.map((l) => l.map((p) => p.text).join('')).join('')).toBe('abcdefghijkl');
  });

  it('honours forced breaks and bold headings', () => {
    const lines = layoutInlines(parseInline('one  \ntwo'), 10, 500, measure, { bold: true });
    expect(lines.length).toBe(2);
    expect(lines[0][0].style).toBe('bold');
  });
});
