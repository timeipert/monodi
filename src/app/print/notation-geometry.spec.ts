import { syllableGeometry, CLEF_SHIFT } from './notation-geometry';
import { BaseNote, NoteType, Syllable, SyllableType } from '../types/model';

let n = 0;
const note = (base: BaseNote, octave: number, extra: any = {}) => ({ uuid: 'n' + n++, base, octave, liquescent: false, noteType: NoteType.Normal, focus: false, ...extra });
const syl = (groups: any[][], extra: any = {}): Syllable => ({
  uuid: 's' + n++, kind: 'Syllable', text: 'la', syllableType: SyllableType.Normal,
  notes: { spaced: groups.map((g) => ({ nonSpaced: [{ grouped: g }] })) }, ...extra,
} as any);

describe('syllableGeometry', () => {
  it('a single note: note group at 12, at least 30 wide, nothing above the staff', () => {
    const g = syllableGeometry(syl([[note(BaseNote.G, 4)]]), { showClef: false, adiastematic: false });
    expect(g.shiftUnits).toBe(12);
    expect(g.widthUnits).toBeGreaterThanOrEqual(42);
    expect(g.minTop).toBe(40);
    expect(g.lowestLedger).toBe(0);
  });

  it('the clef shifts the notes and widens the cell', () => {
    const a = syllableGeometry(syl([[note(BaseNote.G, 4)]]), { showClef: false, adiastematic: false });
    const b = syllableGeometry(syl([[note(BaseNote.G, 4)]]), { showClef: true, adiastematic: false });
    expect(b.shiftUnits - a.shiftUnits).toBe(CLEF_SHIFT);
    expect(b.widthUnits - a.widthUnits).toBe(CLEF_SHIFT);
  });

  it('no clef on adiastematic lines', () => {
    expect(syllableGeometry(syl([[note(BaseNote.G, 4)]]), { showClef: true, adiastematic: true }).showClef).toBeFalse();
  });

  it('high notes and brackets raise minTop, low notes add ledger lines and depth', () => {
    const high = syllableGeometry(syl([[note(BaseNote.C, 6), note(BaseNote.D, 6)]]), { showClef: false, adiastematic: false });
    expect(high.minTop).toBeLessThan(20);
    const low = syllableGeometry(syl([[note(BaseNote.F, 3)]]), { showClef: false, adiastematic: false });
    expect(low.lowestLedger).toBe(110);
    expect(low.lowest[0]).toBeGreaterThan(100);
  });

  it('more notes make the cell wider; a second voice is measured too', () => {
    const one = syllableGeometry(syl([[note(BaseNote.G, 4)]]), { showClef: false, adiastematic: false });
    const many = syllableGeometry(syl([[note(BaseNote.G, 4)], [note(BaseNote.A, 4)], [note(BaseNote.B, 4)]]), { showClef: false, adiastematic: false });
    expect(many.widthUnits).toBeGreaterThan(one.widthUnits);
    const two = syllableGeometry(syl([[note(BaseNote.G, 4)]], { additionalMelodies: [{ spaced: [{ nonSpaced: [{ grouped: [note(BaseNote.C, 4)] }] }] }] }), { showClef: false, adiastematic: false });
    expect(two.voices.length).toBe(2);
    expect(two.lowest.length).toBe(2);
  });

  it('placeholder syllables (without notes) have no note group', () => {
    const g = syllableGeometry(syl([[note(BaseNote.G, 4)]], { syllableType: SyllableType.WithoutNotes }), { showClef: false, adiastematic: false });
    expect(g.isNormal).toBeFalse();
    expect(g.shiftUnits).toBe(-1);
    expect(g.voices[0].length).toBe(0);
  });
});
