import * as VM from './types/model';
import { buildIndex, indexDocument, resolveLinks } from './notation-links';
import { buildOverview, snippetLabel } from './notation-overview';
import { defaultSetup } from './notation-set';

const note = (base: string, octave: number, uuid: string): VM.Note =>
  ({ uuid, base, octave, noteType: VM.NoteType.Normal, liquescent: false, focus: false } as VM.Note);
const syl = (text: string, ...groups: VM.Note[][]): any => ({
  kind: VM.LinePartKind.Syllable, uuid: 's-' + text, text, syllableType: VM.SyllableType.Normal,
  notes: { spaced: groups.map(g => ({ nonSpaced: [{ grouped: g }] })) },
});
const root: any = {
  kind: VM.ContainerKind.RootContainer, uuid: 'r',
  children: [{ kind: VM.ContainerKind.ZeileContainer, uuid: 'z', children: [
    syl('et', [note('D', 4, 'a1')]),
    syl('ra', [note('F', 4, 'b1'), note('E', 4, 'b2'), note('F', 4, 'b3')]),
    { kind: VM.LinePartKind.LineChange, uuid: 'lc', focus: false },
  ] }],
};
const index = buildIndex(indexDocument(root, { id: 'd1', label: 'Fx 1-8-1', foliostart: '8', zeilenstart: '6' }));

const source: any = {
  equivalents: [{ pattern: '*', refId: '10', notes: 'common' }],
  annotationRegions: [{ id: 'r6', name: 'Line 6', points: '10,30 90,30 90,40 10,40', folio: '', folioLabel: '8r' }],
  annotationItems: [
    { id: 'i2', regionId: 'r6', pattern: '[*du]', points: '60,31 64,31 64,36 60,36', sysId: 'Fx 1-8-1|8r|6|ra|F4-E4-F4' },
    { id: 'i1', regionId: 'r6', pattern: '*', variant: 'a', points: '20,31 24,31 24,36 20,36', uuid: 'a1' },
  ],
};

describe('buildOverview', () => {
  const overview = buildOverview(source, defaultSetup(), index, resolveLinks(source, index));

  it('labels a snippet by its Reference ID and variant, or by its pattern when it has no ID', () => {
    expect(snippetLabel('10+/20-', '[*dL]', 'b')).toBe('10+20-b');
    expect(snippetLabel('', '*uu', '')).toBe('*uu');
    expect(snippetLabel('', '*uu', 'a')).toBe('*uu a');
  });

  it('lists the snippets of a line left to right, each with its link', () => {
    expect(overview.snippets.map(s => s.item.id)).toEqual(['i1', 'i2']);
    expect(overview.snippets.map(s => s.link.kind)).toEqual(['stored', 'reference']);
    expect(overview.snippets[0].label).toBe('10a');
  });

  it('puts the snippets and the transcription\'s neumes on the row of their pattern', () => {
    const row = overview.rows.find(r => r.pattern === '*')!;
    expect(row.refId).toBe('10');
    expect(row.notes).toBe('common');
    expect(row.variants.map(v => [v.variant, v.snippets.length, v.places.map(p => p.text)])).toEqual([['a', 1, ['8 / 6']]]);
    expect(row.occurrences.length).toBe(1);
    expect(row.occurrences[0].snippet?.item.id).toBe('i1');
    expect(row.documented).toBe(1);
  });

  it('shows the transcription line under the line region', () => {
    const line = overview.lines[0];
    expect(line.link.kind).toBe('snippets');   // the region has no lineUUID yet: its snippets stand on this line
    expect(line.neumes.map(n => n.neume.pattern)).toEqual(['*', '[*du]']);
    expect(line.neumes.map(n => n.snippet?.item.id)).toEqual(['i1', 'i2']);
  });

  it('counts what is there and how much of it is linked', () => {
    expect(overview.counts.snippets).toBe(2);
    expect(overview.counts.snippetLinks.stored).toBe(1);
    expect(overview.counts.snippetLinks.reference).toBe(1);
    expect(overview.counts.documents).toBe(1);
    expect(overview.counts.neumes).toBe(2);
  });
});
