import { GuidoCell, decodeCell, stepToPitch } from './guido-decode';
import { GLYPH_TABLES } from './guido-glyphs';

const TABLE = GLYPH_TABLES['guido6-hu'];
const SYMBOLS = { join: '\\', shortGap: 'n' };
const decode = (code: string): GuidoCell => decodeCell(code, TABLE, SYMBOLS);

/** The guide was written for the English keyboard, the files are typed on the Hungarian one. */
const EN_TO_HU: { [c: string]: string } = { y: 'z', Y: 'Z', $: '!', '&': '=', '*': '(', '/': '-' };
const hu = (en: string) => Array.from(en).map(c => EN_TO_HU[c] ?? c).join('');

const steps = (code: string) => decode(code).neumes.map(ne => ne.map(g => g.map(n => n.step)));
const shapes = (code: string) => decode(code).neumes.map(ne => ne.map(g => g.map(n => `${n.step}${n.shape[0]}${n.plica ? '^' : ''}`)));

describe('guido-decode', () => {
  describe('glyph table', () => {
    it('takes the digits as its calibration: 0..9 are the steps 0..9', () => {
      for (let d = 0; d <= 9; d++) expect(TABLE[String(d)]).toEqual({ cls: 'punctum', step: d });
    });

    it('has the virga row of the Hungarian keyboard (z, not y)', () => {
      Array.from('qwertzuiop').forEach((c, i) => expect(TABLE[c]).toEqual({ cls: 'virga', step: i + 1 }));
      expect(TABLE['y'].cls).not.toBe('virga');
    });

    it('has the plica hooks on shift+digit', () => {
      Array.from("'\"+!%/=()§").forEach((c, i) => expect(TABLE[c]).toEqual({ cls: 'plica', step: (i + 1) % 10 }));
    });

    it('names pitches from C4', () => {
      expect(stepToPitch(0)).toEqual({ base: 'C', octave: 4 });
      expect(stepToPitch(4)).toEqual({ base: 'G', octave: 4 });
      expect(stepToPitch(7)).toEqual({ base: 'C', octave: 5 });
      expect(stepToPitch(-1)).toEqual({ base: 'B', octave: 3 });
      expect(stepToPitch(10)).toEqual({ base: 'F', octave: 5 });
    });
  });

  // The 15 figures of section I.5 of the Dobszay/Bali guide.
  describe('figures of the guide', () => {
    it('1 punctum, 2 pes', () => {
      expect(shapes(hu('4'))).toEqual([[['4p']]]);
      expect(shapes(hu('4t'))).toEqual([[['4p', '5v']]]);
    });
    it('3-6 clivis (second with and without stroke, third, fourth)', () => {
      expect(steps(hu('tT4'))).toEqual([[[5, 4]]]);
      expect(steps(hu('t4'))).toEqual([[[5, 4]]]);
      expect(steps(hu('tg3'))).toEqual([[[5, 3]]]);
      expect(steps(hu('tG2'))).toEqual([[[5, 2]]]);
    });
    it('7-8 torculus', () => {
      expect(steps(hu('5yY5'))).toEqual([[[5, 6, 5]]]);
      expect(steps(hu('4uU6'))).toEqual([[[4, 7, 6]]]);
    });
    it('9 scale with double start, 10 the same separated by plica', () => {
      expect(steps(hu('7uU6Y5T4'))).toEqual([[[7, 7, 6, 5, 4]]]);
      expect(shapes(hu('7&/yY5T4'))).toEqual([[['7p^']], [['6v', '5p', '4p']]]);
    });
    it('11 ascending scale 1+3+1, 12-15 scales and articulation', () => {
      expect(shapes(hu('4$56u8*'))).toEqual([[['4p^', '5p', '6p', '7v', '8p^']]]);
      expect(steps(hu('456u'))).toEqual([[[4, 5, 6, 7]]]);
      expect(steps(hu('4t6u'))).toEqual([[[4, 5, 6, 7]]]);
      expect(steps(hu('4t6uU6'))).toEqual([[[4, 5, 6, 7, 6]]]);
      expect(steps(hu('4t/6u6'))).toEqual([[[4, 5]], [[6, 7, 6]]]);
    });
  });

  describe('gaps and marks', () => {
    it('reads n as a short gap inside the neume, not as liquescence (regression)', () => {
      // n has an empty outline and is a third of a notehead wide: only a gap fits.
      const c = decode('4\\tT3ne21\\---');
      expect(c.neumes.map(ne => ne.map(g => g.map(n => n.step)))).toEqual([[[4, 5, 3], [3, 2, 1]]]);
      expect(c.unhandled).toEqual([]);
    });

    it('keeps one ligature across a backslash and treats trailing hyphens as padding', () => {
      expect(steps('3\\4\\t4\\t-------')).toEqual([[[3, 4, 5, 4, 5]]]);
      expect(steps('1----')).toEqual([[[1]]]);
      expect(steps('------')).toEqual([]);
    });

    it('collects phrasing marks apart from the notes', () => {
      const c = decode('5---:-');
      expect(c.punct).toBe(':');
      expect(steps('5---:-')).toEqual([[[5]]]);
    });

    it('reads the G clef', () => {
      expect(decode('<--').clef).toBe('G');
    });
  });

  describe('signs', () => {
    it('reads a quilisma and a tenor note as notes', () => {
      expect(shapes('4¬')).toEqual([[['4p', '3q']]]);
      expect(shapes('½')).toEqual([[['4t']]]);
    });

    it('applies a sign of alteration to the next note on its step', () => {
      expect(decode('X6').neumes[0][0][0].accidental).toBe('flat');
      expect(decode('X3').warnings.length).toBe(1);
    });

    it('warns about a plica that does not sit on its note', () => {
      expect(decode('4+').warnings.length).toBe(1);        // + is the plica of step 3
    });

    it('reports characters it does not know and ignores known clefs', () => {
      expect(decode('4#').unhandled).toEqual([]);          // # is a C clef
      expect(decode('4À').unhandled).toEqual(['À']);
    });
  });
});
