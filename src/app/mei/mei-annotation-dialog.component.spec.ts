import { NoteFlagDef } from '@monodi/core/document';
import { MeiAnnotationDialogComponent, MeiAnnotationResult } from './mei-annotation-dialog.component';

/**
 * The flag section of the dialog "MEI attributes" of a note: the flags of the project can be set or cleared there, a hand-set
 * value that a flag writes can be replaced by the flag, and the dialog returns the attributes and the flags together.
 */
describe('MEI attribute dialog: flags of the note', () => {
  const VIRGA: NoteFlagDef = { key: 'V', label: 'Virga', abbrev: 'V', mei: { tilt: 's' } };
  const EMPTY: NoteFlagDef = { key: 'E', label: 'Empty', abbrev: 'E' };

  async function open(inputs: Partial<MeiAnnotationDialogComponent>): Promise<{ dialog: MeiAnnotationDialogComponent; close: jasmine.Spy }> {
    const close = jasmine.createSpy('close');
    const registry = { ready: async () => undefined, forProfile: () => undefined };
    const dialog = new MeiAnnotationDialogComponent({ close } as any, registry as any);
    Object.assign(dialog, inputs);
    await dialog.ngOnInit();
    return { dialog, close };
  }

  it('offers the flags only for a note, not for an accidental, a neume or a syllable, and only when the project has flags', async () => {
    expect((await open({ target: 'nc', flagDefs: [VIRGA] })).dialog.showFlags).toBeTrue();
    expect((await open({ target: 'nc', flagDefs: [] })).dialog.showFlags).toBeFalse();
    expect((await open({ target: 'nc', elementName: 'accid', flagDefs: [VIRGA] })).dialog.showFlags).toBeFalse();
    expect((await open({ target: 'neume', flagDefs: [VIRGA] })).dialog.showFlags).toBeFalse();
  });

  it('returns the attributes and the flags as chosen in the dialog', async () => {
    const { dialog, close } = await open({ target: 'nc', flagDefs: [VIRGA, EMPTY], flags: ['E'], attrs: { type: 'a' } });
    dialog.toggleFlag('V');
    dialog.toggleFlag('E');
    dialog.apply();
    expect(close).toHaveBeenCalledWith({ attrs: { type: 'a' }, flags: ['V'] } as MeiAnnotationResult);
  });

  it('returns no flags for an element that takes none', async () => {
    const { dialog, close } = await open({ target: 'syllable', flagDefs: [VIRGA], attrs: { label: 'x' } });
    dialog.apply();
    expect(close).toHaveBeenCalledWith({ attrs: { label: 'x' } });
  });

  it('replaces a hand-set value by the flag that writes the same', async () => {
    const { dialog, close } = await open({ target: 'nc', flagDefs: [VIRGA], attrs: { tilt: 's', type: 'a' } });
    const row = dialog.rows.find(r => r.name === 'tilt')!;
    expect(dialog.flagForRow(row)).toBe(VIRGA);
    expect(dialog.flagForRow(dialog.rows.find(r => r.name === 'type')!)).toBeUndefined();
    dialog.useFlag(row, VIRGA);
    dialog.apply();
    expect(close).toHaveBeenCalledWith({ attrs: { type: 'a' }, flags: ['V'] });
  });

  it('describes what a flag writes, and says so when it writes nothing', async () => {
    const { dialog } = await open({ target: 'nc', flagDefs: [VIRGA, EMPTY] });
    expect(dialog.flagWrites(VIRGA)).toBe('tilt="s"');
    expect(dialog.flagWrites(EMPTY)).toBe('nothing (no MEI form chosen)');
  });

  it('leaves the attributes that the flags of the note write out of the generated list', async () => {
    const { dialog } = await open({ target: 'nc', flagDefs: [VIRGA], flags: ['V'], generated: { tilt: 's', con: 'g' } });
    expect(dialog.generatedEntries.map(e => e.name)).toEqual(['con']);
  });
});
