import {
  pitchToVolpianoChar,
  volpianoCharToPitch,
  rootToVolpiano,
  volpianoToRoot,
  splitTextIntoSyllables,
} from './volpiano';
import {
  RootContainer,
  ContainerKind,
  LinePartKind,
  Syllable,
  Note,
  ZeileContainer,
  MiscContainer,
  NoteType,
  BaseNote,
  SyllableType,
  DocumentType,
  getSyllables,
  allNotes,
} from '../types/model';
import { v4 as UUID } from 'uuid';

// ── helpers ──────────────────────────────────────────────────────────────────

function note(base: BaseNote, octave: number, opts: { liquescent?: boolean; flat?: boolean } = {}): Note {
  return {
    uuid: UUID(),
    base,
    octave,
    liquescent: !!opts.liquescent,
    noteType: opts.flat ? NoteType.Flat : NoteType.Normal,
    focus: false,
  };
}

/** Build a syllable from a list of ligature runs (each run = one connected group). */
function syllable(text: string, runs: Note[][]): Syllable {
  return {
    kind: LinePartKind.Syllable,
    uuid: UUID(),
    text,
    syllableType: SyllableType.Normal,
    notes: { spaced: runs.map((run) => ({ nonSpaced: [{ grouped: run }] })) },
  };
}

function docFromSyllables(syllables: Syllable[]): RootContainer {
  const zeile: ZeileContainer = {
    kind: ContainerKind.ZeileContainer,
    uuid: UUID(),
    children: syllables,
  };
  const misc: MiscContainer = {
    kind: ContainerKind.MiscContainer,
    uuid: UUID(),
    children: [zeile],
  };
  return {
    kind: ContainerKind.RootContainer,
    uuid: UUID(),
    children: [misc],
    comments: [],
    documentType: DocumentType.Level1,
  };
}

// ── pitch table ──────────────────────────────────────────────────────────────

describe('Volpiano pitch table', () => {
  it('anchors b to middle C (C4)', () => {
    expect(pitchToVolpianoChar(BaseNote.C, 4, false)).toEqual({ char: 'b' });
    expect(volpianoCharToPitch('b')).toEqual({ base: BaseNote.C, octave: 4, liquescent: false });
  });

  it('maps the treble-staff anchors from the CANTUS protocol', () => {
    // d = bottom treble line E4, m = top line F5, 8 = G3, s = E6
    expect(pitchToVolpianoChar(BaseNote.E, 4, false)).toEqual({ char: 'd' });
    expect(pitchToVolpianoChar(BaseNote.F, 5, false)).toEqual({ char: 'm' });
    expect(pitchToVolpianoChar(BaseNote.G, 3, false)).toEqual({ char: '8' });
    expect(pitchToVolpianoChar(BaseNote.E, 6, false)).toEqual({ char: 's' });
  });

  it('is a bijection across the whole lowercase range', () => {
    for (const ch of '89abcdefghjklmnopqrs') {
      const p = volpianoCharToPitch(ch)!;
      expect(p).withContext(`char ${ch}`).toBeTruthy();
      expect(pitchToVolpianoChar(p.base, p.octave, false)).toEqual({ char: ch });
    }
  });

  it('maps uppercase letters to liquescent notes', () => {
    // H = liquescent B4 (h)
    expect(volpianoCharToPitch('H')).toEqual({ base: BaseNote.B, octave: 4, liquescent: true });
    expect(pitchToVolpianoChar(BaseNote.B, 4, true)).toEqual({ char: 'H' });
  });

  it('reports pitches outside the Volpiano range', () => {
    const res = pitchToVolpianoChar(BaseNote.C, 2, false);
    expect(res.char).toBeNull();
  });
});

// ── export ───────────────────────────────────────────────────────────────────

describe('rootToVolpiano', () => {
  it('reproduces the protocol example (Quoniam deus)', () => {
    // 1---dh-k--h--h---h--h---   (protocol §5, Example 5)
    const E4 = () => note(BaseNote.E, 4);
    const B4 = () => note(BaseNote.B, 4);
    const D5 = () => note(BaseNote.D, 5);
    const doc = docFromSyllables([
      syllable('Quo-', [[E4(), B4()], [D5()]]),
      syllable('ni-', [[B4()]]),
      syllable('am', [[B4()]]),
      syllable('de-', [[B4()]]),
      syllable('us', [[B4()]]),
    ]);
    expect(rootToVolpiano(doc).volpiano).toBe('1---dh-k--h--h---h--h---');
  });

  it('separates same-word syllables with -- and words with ---', () => {
    const C4 = () => note(BaseNote.C, 4);
    const doc = docFromSyllables([
      syllable('a-', [[C4()]]),
      syllable('men', [[C4()]]),
      syllable('al', [[C4()]]),
    ]);
    // a- + men (same word, --) then al (new word, ---)
    expect(rootToVolpiano(doc).volpiano).toBe('1---b--b---b---');
  });
});

// ── import ───────────────────────────────────────────────────────────────────

describe('volpianoToRoot', () => {
  it('parses pitches, ligatures and syllable boundaries', () => {
    const { root, warnings } = volpianoToRoot('1---dh-k--h---');
    expect(warnings).toEqual([]);
    const syls = getSyllables(root);
    expect(syls.length).toBe(2);
    // first syllable: ligature [E4,B4] then separate neume [D5]
    expect(syls[0].notes.spaced.length).toBe(2);
    expect(syls[0].notes.spaced[0].nonSpaced[0].grouped.map((n) => n.base + '' + n.octave)).toEqual(['E4', 'B4']);
    expect(syls[0].notes.spaced[1].nonSpaced[0].grouped.map((n) => n.base + '' + n.octave)).toEqual(['D5']);
    expect(allNotes(syls[1].notes).map((n) => n.base + '' + n.octave)).toEqual(['B4']);
  });

  it('distributes aligned text over syllables', () => {
    const { root } = volpianoToRoot('1---b--b---b---', 'Quo-ni am');
    const syls = getSyllables(root);
    expect(syls.map((s) => s.text)).toEqual(['Quo-', 'ni', 'am']);
  });

  it('skips unrecognised characters and records a warning', () => {
    const { root, warnings } = volpianoToRoot('1---b§b---');
    expect(warnings.length).toBe(1);
    expect(getSyllables(root).length).toBe(1);
  });

  it('reconstructs word-boundary hyphens from the melody in syllables text mode', () => {
    // melody: b (--) b (---) b  → word "a-b", then word "c"
    const { root } = volpianoToRoot('1---b--b---b---', 'a b c', { textMode: 'syllables' });
    expect(getSyllables(root).map((s) => s.text)).toEqual(['a-', 'b', 'c']);
  });
});

// ── round trip ───────────────────────────────────────────────────────────────

describe('Volpiano round trip', () => {
  function roundTrip(vol: string, text?: string): string {
    const { root } = volpianoToRoot(vol, text);
    return rootToVolpiano(root).volpiano;
  }

  it('round-trips the protocol example when text is supplied', () => {
    const vol = '1---dh-k--h--h---h--h---';
    const text = 'Quo-ni-am de-us';
    expect(roundTrip(vol, text)).toBe(vol);
  });

  it('round-trips a liquescent', () => {
    // H = liquescent B4
    expect(roundTrip('1---dH---', 'a')).toBe('1---dH---');
  });

  it('round-trips a B-flat with running natural cancellation', () => {
    // i = b-flat sign for B4, I cancels it. Text keeps the two syllables in one word (--).
    const vol = '1---ih-h--Ih---';
    const { root } = volpianoToRoot(vol, 'a-men');
    const notes = getSyllables(root).flatMap((s) => allNotes(s.notes));
    // first two B4 flat, last B4 natural
    expect(notes.map((n) => n.noteType)).toEqual([NoteType.Flat, NoteType.Flat, NoteType.Normal]);
    expect(rootToVolpiano(root).volpiano).toBe(vol);
  });
});

describe('splitTextIntoSyllables', () => {
  it('keeps trailing hyphens on non-final syllables', () => {
    expect(splitTextIntoSyllables('Quo-ni-am de-us')).toEqual(['Quo-', 'ni-', 'am', 'de-', 'us']);
  });
});
