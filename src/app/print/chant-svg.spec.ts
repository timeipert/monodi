import { FIXTURES } from '../testdata';
import { renderChantSvg } from './chant-svg';
import * as VM from '../types/model';

/** A built-in font: the unit tests need no font files. */
const SETTINGS = { pdfFontFamily: 'times' };

function jobOf(doc: any) {
  return {
    document: { id: 'd1', quelle_id: 'S', dokumenten_id: 'S-1', textinitium: 'Test' } as any,
    cont: doc as VM.RootContainer,
    source: null,
    sigle: 'S',
  };
}

function lyrics(doc: any): string[] {
  return VM.getSyllables(doc).map((s) => (s.text || '').trim().replace(/-$/, '')).filter((t) => t && !/^(X|\.\.\.|<\.\.\.>)$/.test(t) && !t.includes(' '));
}

describe('renderChantSvg', () => {
  const real = FIXTURES.filter((f) => f.kind === 'real').slice(0, 3);

  for (const fx of real) {
    it(`${fx.name}: one compact SVG with the lyrics of the chant`, async () => {
      const out = await renderChantSvg(jobOf(fx.doc), { settings: SETTINGS });
      expect(out.svg.startsWith('<svg ')).toBeTrue();
      expect(out.svg.endsWith('</svg>')).toBeTrue();
      expect(out.pages).toBeGreaterThanOrEqual(1);
      expect(out.systems).toBeGreaterThan(0);
      // no NaN anywhere, nothing that a page's CSS could not theme
      expect(out.svg).not.toMatch(/NaN|undefined|Infinity/);
      expect(out.svg).not.toContain('<style');
      expect(out.svg).not.toContain('class=');
      expect(out.svg).not.toContain('#333333');
      expect(out.svg).toContain('currentColor');
      // staff lines and note heads are reused outlines
      expect(out.svg).toContain('<defs>');
      expect(out.svg).toContain('<use href="#s');
      expect(out.svg).toContain('<use href="#g');
      // every lyric of the chant is in the picture (first word is enough)
      const text = [...out.svg.matchAll(/<text [^>]*>([^<]*)<\/text>/g)].map((m) => m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')).join(' ');
      for (const word of lyrics(fx.doc).slice(0, 10)) expect(text.toLowerCase()).toContain(word.toLowerCase().slice(0, 2));
      // the running head, the heading and a page number are not part of the picture
      expect(text).not.toContain('S | ');
    });
  }

  it('is deterministic', async () => {
    const a = await renderChantSvg(jobOf(real[0].doc), { settings: SETTINGS });
    const b = await renderChantSvg(jobOf(real[0].doc), { settings: SETTINGS });
    expect(a.svg).toBe(b.svg);
  });

  it('a narrower page wraps into more systems', async () => {
    const wide = await renderChantSvg(jobOf(real[0].doc), { settings: SETTINGS, pageWidthPt: 700 });
    const narrow = await renderChantSvg(jobOf(real[0].doc), { settings: SETTINGS, pageWidthPt: 350 });
    expect(narrow.systems).toBeGreaterThan(wide.systems);
  });

  it('a chant longer than the page continues below on the same picture', async () => {
    const one = await renderChantSvg(jobOf(real[0].doc), { settings: SETTINGS, pageHeightPt: 14400 });
    const split = await renderChantSvg(jobOf(real[0].doc), { settings: SETTINGS, pageHeightPt: 250 });
    expect(split.pages).toBeGreaterThan(1);
    // the same content, stacked into one picture: every note outline is there once (a page break may repeat a running label)
    const count = (svg: string, re: RegExp) => svg.match(re)?.length ?? 0;
    expect(count(split.svg, /<text /g)).toBeGreaterThanOrEqual(count(one.svg, /<text /g));
    expect(count(split.svg, /<use href="#g/g)).toBe(count(one.svg, /<use href="#g/g));
  });

  it('the notation colour setting is themed (currentColor), not baked in', async () => {
    const out = await renderChantSvg(jobOf(real[0].doc), { settings: { ...SETTINGS, notationColor: '#aa0000' } });
    expect(out.svg).not.toContain('#aa0000');
    expect(out.svg).toContain('currentColor');
  });

  it('the extreme fixtures draw without a crash', async () => {
    for (const fx of FIXTURES.filter((f) => f.kind === 'extreme')) {
      const out = await renderChantSvg(jobOf(fx.doc), { settings: SETTINGS });
      expect(out.svg).not.toMatch(/NaN|undefined|Infinity/);
    }
  });
  describe('critical apparatus', () => {
    const withComments = FIXTURES.find((f) => f.name === 'x15-apparatus-forms')!;
    const staffYs = (svg: string) => [...svg.matchAll(/<use href="#s\w+" transform="matrix\([^ ]+ 0 0 1 [\d.]+ ([\d.]+)\)"\/>/g)].map((m) => +m[1]);
    const textMatches = (svg: string, re: RegExp) => [...svg.matchAll(/<text x="[\d.]+" y="([\d.]+)"[^>]*>([^<]*)<\/text>/g)].filter((m) => re.test(m[2])).map((m) => +m[1]);

    it('the fixture has comments (otherwise the checks below prove nothing)', () => {
      expect((withComments.doc.comments ?? []).length).toBeGreaterThan(0);
    });

    it('is part of the picture by default, below the last system of the edition', async () => {
      const without = await renderChantSvg(jobOf(withComments.doc), { settings: SETTINGS, apparatus: false });
      const withIt = await renderChantSvg(jobOf(withComments.doc), { settings: SETTINGS });
      const dflt = await renderChantSvg(jobOf(withComments.doc), { settings: SETTINGS, apparatus: true });
      expect(withIt.svg).toBe(dflt.svg);
      const title = textMatches(withIt.svg, /^CRITICAL APPARATUS$/i);
      expect(title.length).toBe(1);
      expect(textMatches(without.svg, /^CRITICAL APPARATUS$/i).length).toBe(0);
      // the edition is the same picture in both; the apparatus starts below its last staff
      const lastStaff = Math.max(...staffYs(without.svg));
      expect(title[0]).toBeGreaterThan(lastStaff);
      expect(staffYs(withIt.svg).length).toBeGreaterThan(staffYs(without.svg).length);   // the comment cells hold small staves with notes
      const h = (s: string) => +/viewBox="0 0 \d+ (\d+)"/.exec(s)![1];
      expect(h(withIt.svg)).toBeGreaterThan(h(without.svg));
      // several text sizes and italics: the readings
      expect(withIt.svg).toMatch(/font-style="italic"/);
      expect(new Set([...withIt.svg.matchAll(/font-size="([\d.]+)"/g)].map((m) => m[1])).size).toBeGreaterThan(1);
    });

    it('stays one themable SVG without ids (other than shape ids), classes or styles', async () => {
      const out = await renderChantSvg(jobOf(withComments.doc), { settings: SETTINGS });
      expect(out.svg).not.toContain('<style');
      expect(out.svg).not.toContain('class=');
      expect(out.svg).not.toMatch(/ id="(?![gs][0-9a-z]+")/);
      expect(out.svg).not.toMatch(/NaN|undefined|Infinity/);
      expect(out.svg).not.toContain('#1e1e1e');   // dark text is currentColor
      expect(out.svg.match(/<svg /g)?.length).toBe(1);
    });

    it('a chant without comments has no apparatus either way', async () => {
      const plain = real.find((f) => (f.doc.comments ?? []).length === 0);
      expect(plain).toBeDefined();
      const a = await renderChantSvg(jobOf(plain!.doc), { settings: SETTINGS, apparatus: true });
      const b = await renderChantSvg(jobOf(plain!.doc), { settings: SETTINGS, apparatus: false });
      expect(a.svg).toBe(b.svg);
    });
  });
});
