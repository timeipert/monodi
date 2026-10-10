import { documentBlocks, printedParts } from './document-blocks';
import { ContainerKind, FormteilDataName } from '../types/model';

const zeile = (children: any[]): any => ({ kind: ContainerKind.ZeileContainer, uuid: 'z' + Math.random(), children });
const para = (text: string): any => ({ kind: ContainerKind.ParatextContainer, uuid: 'p' + text, text, retro: false, paratextType: 'Gesang' });
const form = (sig: string, children: any[]): any => ({ kind: ContainerKind.FormteilContainer, uuid: 'f' + sig, children, data: sig ? [{ name: FormteilDataName.Signatur, data: ' ' + sig + ' ' }] : [] });

describe('documentBlocks', () => {
  it('lists sections, rubrics and lines in print order with their depth and signature', () => {
    const root: any = { kind: ContainerKind.RootContainer, uuid: 'r', comments: [], children: [
      form('', [para('IN DIE'), form('140', [para('VERSUS'), zeile([])]), form('A', [zeile([])])]),
    ] };
    const b = documentBlocks(root);
    expect(b.map((x) => x.kind)).toEqual(['formteil', 'paratext', 'formteil', 'paratext', 'zeile', 'formteil', 'zeile']);
    expect((b[2] as any).signature).toBe('140');
    expect(b[2].depth).toBe(1);
    expect(b[4].depth).toBe(2);
    expect((b[1] as any).text).toBe('IN DIE');
  });

  it('gives every line the status of its nearest section, German names in English', () => {
    const withStatus = (status: string, children: any[]): any => ({ ...form('', children), data: [{ name: FormteilDataName.Status, data: status }] });
    const root: any = { kind: ContainerKind.RootContainer, uuid: 'r', comments: [], children: [
      withStatus('Einsatzmarke', [form('', [zeile([])])]),
      form('B', [zeile([])]),
      withStatus('Refrain', [withStatus('Tropenelement', [zeile([])]), zeile([])]),
    ] };
    const lines = documentBlocks(root).filter((x) => x.kind === 'zeile').map((x) => (x as any).status);
    expect(lines).toEqual(['Entry Mark', '', 'Trope Element', 'Refrain']);
  });

  it('prints syllables and line/folio changes, but not the clef and box markers', () => {
    const z = zeile([{ kind: 'Syllable' }, { kind: 'Clef' }, { kind: 'LineChange' }, { kind: 'Box' }, { kind: 'FolioChange' }]);
    expect(printedParts(z).map((p: any) => p.kind)).toEqual(['Syllable', 'LineChange', 'FolioChange']);
  });
});
