import {
  BaseNote, ContainerKind, DocumentType, FormteilDataName, LinePartKind, NoteType, ParatextType, SyllableType,
  emptyFormteilContainer, emptyRootContainer, emptyZeileContainer
} from '../types/model';
import type { RootContainer } from '../types/model';

/**
 * Test documents of the MEI structure specs (`mei-structure-golden.spec.ts`, `mei-structure.spec.ts`). Fixed uuids, so the export
 * is the same on every run. Used by specs only.
 *
 * `structureTestDocument` holds every case that the structure of the body (MEI_PRESETS, MeiBodyStructure) treats differently:
 * a clef, a line change, a folio change, a box, a paratext, a form part with signature, status, initium and reference, two voices,
 * note heads with a stem up and down, ornaments (oriscus, quilisma, strophicus, liquescent), a break inside a neume (`*u`), flat,
 * natural and sharp before, between and after neumes, a neume of one note, syllables without notes and both ellipses, hand-set MEI
 * attributes on a note, a neume and a syllable, and a line of adiastematic notation.
 *
 * `trialDocument` is the five syllables of the trial files of `mei-presets.spec.ts` ("Mi-ro-ge-ne-re", two voices).
 */
const note = (uuid: string, base: BaseNote, octave: number, noteType: NoteType = NoteType.Normal, liquescent = false, meiAttrs?: Record<string, string>): any => ({
  uuid, base, octave, noteType, liquescent, focus: false, ...(meiAttrs ? { meiAttrs } : {})
});
/** A neume (Monodi: a spaced unit); every argument is one group (Monodi: grouped, notes written together). */
const neume = (...groups: any[][]) => ({ nonSpaced: groups.map(grouped => ({ grouped })) });
const syllable = (uuid: string, text: string, spaced: any[], extra: any = {}): any =>
  ({ kind: LinePartKind.Syllable, uuid, text, syllableType: SyllableType.Normal, notes: { spaced }, ...extra });

export function structureTestDocument(): RootContainer {
  const root = emptyRootContainer();
  root.uuid = 'root-1';
  const formteil = emptyFormteilContainer(DocumentType.Level1, []);
  formteil.uuid = 'part-1';
  formteil.data = [
    { name: FormteilDataName.Signatur, data: 'Ad 1' },
    { name: FormteilDataName.Status, data: 'Draft' },
    { name: FormteilDataName.LemmatisiertesTextInitium, data: 'Kyrie' },
    { name: FormteilDataName.Verweis, data: 'see Ad 2' }
  ];
  const paratext = { kind: ContainerKind.ParatextContainer, uuid: 'para-1', text: 'Rubric', retro: false, paratextType: ParatextType.Gesang, children: [] } as any;

  const line1 = emptyZeileContainer(2);
  line1.uuid = 'line-1';
  const virga = note('n4', BaseNote.C, 5, NoteType.Normal, false, { name: 'virga' });
  const neumeWithAttrs = neume([note('n6', BaseNote.D, 5)], [note('n7', BaseNote.E, 5, NoteType.Descending)]);
  (neumeWithAttrs.nonSpaced[0].grouped[0] as any).meiNeumeAttrs = { type: 'clivis' };
  line1.children = [
    { kind: LinePartKind.Clef, uuid: 'clef-1', focus: false, base: BaseNote.C, octave: 5, shape: 'c' } as any,
    syllable('s1', 'Ky-', [
      neume([note('acc1', BaseNote.B, 4, NoteType.Flat), note('n1', BaseNote.G, 4), note('n2', BaseNote.A, 4, NoteType.Ascending), note('n3', BaseNote.B, 4, NoteType.Oriscus)]),
      neume([virga])
    ], {
      meiAttrs: { type: 'first' },
      additionalMelodies: [{ spaced: [neume([note('v1', BaseNote.C, 4)]), neume([note('v2', BaseNote.D, 4), note('v3', BaseNote.E, 4, NoteType.Ascending)])] }]
    }),
    { kind: LinePartKind.LineChange, uuid: 'lc-1', focus: false } as any,
    syllable('s2', 'ri-', [neumeWithAttrs, neume([note('acc2', BaseNote.B, 4, NoteType.Natural)]), neume([note('n8', BaseNote.A, 4, NoteType.Normal, true), note('n9', BaseNote.G, 4, NoteType.Quilisma)])],
      { additionalMelodies: [{ spaced: [neume([note('v4', BaseNote.F, 4, NoteType.Liquescent)])] }] }),
    { kind: LinePartKind.Box, uuid: 'box-1', focus: false } as any,
    { kind: LinePartKind.FolioChange, uuid: 'fc-1', focus: false, text: 'f. 3r' } as any,
    syllable('s3', 'e', [], { syllableType: SyllableType.WithoutNotes })
  ] as any;

  const line2 = emptyZeileContainer(1);
  line2.uuid = 'line-2';
  line2.children = [
    syllable('s4', '...', [], { syllableType: SyllableType.SourceEllipsis }),
    syllable('s5', '<...>', [neume([note('n10', BaseNote.F, 4, NoteType.Strophicus)])], { syllableType: SyllableType.EditorialEllipsis }),
    syllable('s6', 'son', [neume([note('n11', BaseNote.G, 4), note('acc3', BaseNote.F, 4, NoteType.Sharp)])])
  ] as any;

  const line3 = emptyZeileContainer(1);
  line3.uuid = 'line-3';
  (line3 as any).notation = 'adiastematic';
  line3.children = [syllable('s7', 'lei', [neume([note('a1', BaseNote.G, 4), note('a2', BaseNote.A, 4), note('a3', BaseNote.G, 4)])])] as any;

  formteil.children = [paratext, line1, line2, line3] as any;
  root.children = [formteil];
  return root;
}

/** The trial document of `mei-presets.spec.ts`: five syllables in two voices, `name` (and `lig` on two notes) set by hand. */
export function trialDocument(): RootContainer {
  const n = (uuid: string, base: BaseNote, octave: number, name?: string, lig?: string) =>
    note(uuid, base, octave, NoteType.Normal, false, name ? { name, ...(lig ? { lig } : {}) } : undefined);
  const two = (uuid: string, text: string, voice1: any[], voice2: any[]) => syllable(uuid, text, voice1, { additionalMelodies: [{ spaced: voice2 }] });
  const root = emptyRootContainer();
  root.uuid = 'root-2';
  const formteil = emptyFormteilContainer(DocumentType.Level1, []);
  formteil.uuid = 'part-2';
  const zeile = emptyZeileContainer(1);
  zeile.uuid = 'line-21';
  zeile.children = [
    two('t1', 'Mi-', [neume([n('a1', BaseNote.F, 5, 'virga'), n('a2', BaseNote.E, 5, 'punctum', 'conjunctura'), n('a3', BaseNote.D, 5, 'punctum', 'conjunctura')])],
                     [neume([n('b1', BaseNote.F, 4), n('b2', BaseNote.G, 4)])]),
    two('t2', 'ro', [neume([n('a4', BaseNote.C, 5, 'virga')])], [neume([n('b3', BaseNote.A, 4, 'virga')])]),
    two('t3', 'ge', [neume([n('a5', BaseNote.C, 5, 'punctum')])], [neume([n('b4', BaseNote.A, 4, 'punctum')])]),
    two('t4', 'ne', [neume([n('a6', BaseNote.A, 4, 'punctum'), n('a7', BaseNote.A, 4, 'virga')])], [neume([n('b5', BaseNote.A, 4, 'punctum')])]),
    two('t5', 're', [neume([n('a8', BaseNote.A, 4, 'virga')])], [neume([n('b6', BaseNote.A, 4, 'punctum')])])
  ] as any;
  formteil.children = [zeile];
  root.children = [formteil];
  return root;
}
