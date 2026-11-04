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
});
