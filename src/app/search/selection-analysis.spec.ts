import { analyzeSelection, pitchGroups, documentEmbedding, SelectionAnalysisInput } from './selection-analysis';
import { Document, Source } from '../api.service';
import { volpianoToRoot } from '../volpiano/volpiano';

function doc(id: string, quelleId: string, extra: Partial<Document> = {}): Document {
  return {
    id, quelle_id: quelleId, dokumenten_id: id, gattung1: '', gattung2: '', festtag: '', feier: '',
    textinitium: '', bibliographischerverweis: '', druckausgabe: '', zeilenstart: '', foliostart: '',
    kommentar: '', editionsstatus: '', ...extra,
  };
}
function src(id: string, sigle: string, extra: Partial<Source> = {}): Source {
  return {
    id, quellensigle: sigle, herkunftsregion: '', herkunftsort: '', herkunftsinstitution: '',
    ordenstradition: '', quellentyp: '', bibliotheksort: '', bibliothek: '', bibliothekssignatur: '',
    kommentar: '', datierung: '', ...extra,
  };
}

describe('analyzeSelection', () => {
  it('summarises notes, pitches, notes-per-syllable and text', () => {
    // "Quo" = d,h (2 notes), "ni" = k (1 note); text Quo-ni
    const root = volpianoToRoot('1---dh--k---', 'Quo-ni').root;
    const input: SelectionAnalysisInput = {
      documents: [doc('d1', 's1', { gattung1: 'Antiphon' })],
      sources: [src('s1', 'A-Wn')],
      roots: [root],
    };
    const a = analyzeSelection(input);

    expect(a.docCount).toBe(1);
    expect(a.sourceCount).toBe(1);
    expect(a.totalSyllables).toBe(2);
    expect(a.totalNotes).toBe(3);
    expect(a.avgNotesPerSyllable).toBeCloseTo(1.5, 5);

    // Pitch labels present (E4 from 'd', B4 from 'h', D5 from 'k')
    const pitchLabels = a.pitchDistribution.map((b) => b.label);
    expect(pitchLabels).toContain('E4');
    expect(pitchLabels).toContain('B4');
    expect(pitchLabels).toContain('D5');

    // notes-per-syllable: one syllable with 2, one with 1
    const nps = new Map(a.notesPerSyllable.map((b) => [b.label, b.count]));
    expect(nps.get('1')).toBe(1);
    expect(nps.get('2')).toBe(1);

    // text: "Quoni" reconstructed as one word from Quo-ni
    expect(a.topWords.map((w) => w.label)).toContain('quoni');
  });

  it('detects shared metadata across the selection', () => {
    const root = volpianoToRoot('1---d---', 'a').root;
    const input: SelectionAnalysisInput = {
      documents: [doc('d1', 's1', { gattung1: 'Introit' }), doc('d2', 's1', { gattung1: 'Introit' })],
      sources: [src('s1', 'A-Wn'), src('s1', 'A-Wn')],
      roots: [root, volpianoToRoot('1---e---', 'b').root],
    };
    const shared = analyzeSelection(input).sharedMetadata;
    const genre = shared.find((s) => s.key === 'doc:gattung1');
    expect(genre).toBeTruthy();
    expect(genre!.value).toBe('Introit');
    expect(genre!.count).toBe(2);
  });

  it('groups pitch distribution by a metadata field on a shared axis', () => {
    const input: SelectionAnalysisInput = {
      documents: [doc('d1', 's1', { gattung1: 'A' }), doc('d2', 's2', { gattung1: 'B' })],
      sources: [src('s1', 'X'), src('s2', 'Y')],
      roots: [volpianoToRoot('1---d---', '').root, volpianoToRoot('1---k---', '').root],
    };
    const g = pitchGroups(input, 'doc:gattung1');
    expect(g.groups.map((x) => x.group).sort()).toEqual(['A', 'B']);
    // shared axis holds both pitches (E4 from 'd', D5 from 'k')
    expect(g.axis).toContain('E4');
    expect(g.axis).toContain('D5');
    g.groups.forEach((gr) => expect(gr.percent.length).toBe(g.axis.length));
  });

  it('projects documents to a 2-D similarity map (>=3 docs)', () => {
    const mk = (v: string, text: string) => volpianoToRoot(v, text).root;
    const input: SelectionAnalysisInput = {
      documents: [doc('d1', 's1'), doc('d2', 's1'), doc('d3', 's1')],
      sources: [src('s1', 'X'), src('s1', 'X'), src('s1', 'X')],
      roots: [mk('1---d--e--f---', 'a-b-c'), mk('1---d--e--f---', 'a-b-c'), mk('1---k--l--m---', 'x-y-z')],
    };
    const pts = documentEmbedding(input, 'melody');
    expect(pts.length).toBe(3);
    pts.forEach((p) => {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    });
  });
});
