import { canonicalStatus, STATUS_ENTRY_MARK, STATUS_PRIMARY_SEGMENT, STATUS_REFRAIN, STATUS_TROPE_ELEMENT } from './formteil-status';
import { emptyRootContainer, normalizeDocumentComments, ContainerKind, FormteilDataName } from './model';

describe('canonicalStatus', () => {
  it('maps the German Corpus Monodicum statuses to the English ones', () => {
    expect(canonicalStatus('Einsatzmarke')).toBe(STATUS_ENTRY_MARK);
    expect(canonicalStatus('Tropenelement')).toBe(STATUS_TROPE_ELEMENT);
    expect(canonicalStatus('Refrain')).toBe(STATUS_REFRAIN);
    expect(canonicalStatus('Primärgesangssegment')).toBe(STATUS_PRIMARY_SEGMENT);
  });

  it('leaves English names alone and ignores case and spacing', () => {
    expect(canonicalStatus('Entry Mark')).toBe(STATUS_ENTRY_MARK);
    expect(canonicalStatus(' trope element ')).toBe(STATUS_TROPE_ELEMENT);
    expect(canonicalStatus('EINSATZMARKE')).toBe(STATUS_ENTRY_MARK);
  });

  it('returns an unknown status as typed and empty for nothing', () => {
    expect(canonicalStatus('Sonderfall')).toBe('Sonderfall');
    expect(canonicalStatus(undefined)).toBe('');
    expect(canonicalStatus('')).toBe('');
  });
});

describe('normalizeDocumentComments: statuses', () => {
  it('renames German statuses in nested sections', () => {
    const root = emptyRootContainer();
    const inner: any = { kind: ContainerKind.FormteilContainer, uuid: 'i', data: [{ name: FormteilDataName.Status, data: 'Einsatzmarke' }], children: [] };
    const outer: any = { kind: ContainerKind.FormteilContainer, uuid: 'o', data: [{ name: FormteilDataName.Status, data: 'Tropenelement' }], children: [inner] };
    root.children = [outer];
    normalizeDocumentComments(root);
    expect(outer.data[0].data).toBe(STATUS_TROPE_ELEMENT);
    expect(inner.data[0].data).toBe(STATUS_ENTRY_MARK);
  });
});
