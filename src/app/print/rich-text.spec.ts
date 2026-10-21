import { linkReferences, markupSegments } from './rich-text';

describe('references to documents of the print', () => {
  const refs = new Map([['Aa 13-8-4', '3P'], ['Aa 13-108v-3', '4'], ['Aa 13-117b-1', '7'], ['Aa 13-117b-4', '8']]);
  const boxed = (text: string) => markupSegments(linkReferences(text, refs), 8).filter((s) => s.boxed).map((s) => s.w);

  it('sets a quoted document ID as the frame of that document', () => {
    expect(linkReferences('(wie ((Aa 13-8-4)))', refs)).toBe('(wie {{3P}})');
    expect(boxed('(wie ((Aa 13-8-4)) und andere Hss.)')).toEqual(['3P']);
  });

  it('keeps the rest of a quote that holds an ID, and finds every ID of a list', () => {
    expect(boxed('Das Marienformular (((Aa 13-117b-1, Aa 13-117b-4))) steht später')).toEqual(['7', '8']);
    const segs = markupSegments(linkReferences('siehe ((Exsultent omnes, Aa 13-8-4.)) hier', refs), 8);
    expect(segs.map((s) => s.w)).toEqual(['siehe ', 'Exsultent omnes, ', '3P', '.', ' hier']);
    expect(segs[2].boxed).toBeTrue();
  });

  it('leaves documents that are not in the print, longer IDs and unquoted IDs as written', () => {
    expect(linkReferences('(wie ((Aa 13-99-1)))', refs)).toBe('(wie ((Aa 13-99-1)))');
    expect(linkReferences('((Aa 13-8-40))', refs)).toBe('((Aa 13-8-40))');
    expect(linkReferences('(wie Aa 13-8-4)', refs)).toBe('(wie Aa 13-8-4)');
    expect(linkReferences('((x))', undefined)).toBe('((x))');
    expect(linkReferences('((x))', new Map())).toBe('((x))');
  });

  it('is not confused by characters of the ID that mean something in a pattern', () => {
    const odd = new Map([['A+B (1).2', '5']]);
    expect(linkReferences('((A+B (1).2))', odd)).toBe('{{5}}');
    expect(linkReferences('((AxB (1)x2))', odd)).toBe('((AxB (1)x2))');
  });
});
