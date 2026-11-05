import { emitMei, defaultMeiProfile, MeiMappingProfileV2 } from '@monodi/core/mei';
import {
  emptyRootContainer, emptyFormteilContainer, emptyZeileContainer, emptySyllable,
  DocumentType, BaseNote, NoteType, SyllableType, LinePartKind, ContainerKind, FormteilDataName, ParatextType
} from '../types/model';

/** Structure of the MEI body: the schema-conformant structure is the default, the earlier one is kept with schemaConformant = false. */
describe('MEI body structure', () => {
  function note(uuid: string, noteType: NoteType = NoteType.Normal, liquescent = false): any {
    return { uuid, base: BaseNote.G, octave: 4, noteType, liquescent, focus: false };
  }

  function build(conformant: boolean, notes: any[], units?: any[][], accidentals?: 'accid' | 'note'): Document {
    const root = emptyRootContainer();
    const formteil = emptyFormteilContainer(DocumentType.Level1, []);
    const zeile1 = emptyZeileContainer(1);
    const zeile2 = emptyZeileContainer(2);
    const syl1 = emptySyllable(1);
    syl1.text = 'A';
    syl1.notes = { spaced: (units ?? [notes]).map(g => ({ nonSpaced: [{ grouped: g }] })) } as any;
    const syl2 = emptySyllable(2);
    syl2.text = 'B';
    syl2.notes = { spaced: [{ nonSpaced: [{ grouped: [note('n9')] }] }] } as any;
    zeile1.children = [syl1];
    zeile2.children = [syl2];
    formteil.children = [zeile1, zeile2];
    root.children = [formteil];
    const profile = defaultMeiProfile();
    profile.schemaConformant = conformant;
    if (accidentals) profile.accidentals = accidentals;
    return new DOMParser().parseFromString(emitMei(root, profile), 'application/xml');
  }

  const names = (e: Element | null) => Array.from(e?.children ?? []).map(c => c.localName);

  it('with schemaConformant off keeps the structure of earlier exports: the line break sits in the layer, an oriscus replaces its nc', () => {
    const d = build(false, [note('n1', NoteType.Oriscus)]);
    expect(d.querySelector('layer > sb')).not.toBeNull();
    expect(d.querySelector('neume > oriscus')).not.toBeNull();
    expect(d.querySelector('nc > oriscus')).toBeNull();
  });

  it('conformant: each line is a staff of its own, announced by an sb; a line after the first has a section of its own, because Verovio lays all staves of one section on top of each other', () => {
    const d = build(true, [note('n1')]);
    const section = d.querySelector('section > section')!;
    expect(names(section)).toEqual(['sb', 'staff', 'section']);
    // the second line has a second voice (emptySyllable(2)): a staff of its own in the section of that line
    expect(names(section.querySelector(':scope > section'))).toEqual(['sb', 'staff', 'staff']);
    // a section holds at most one staff per voice
    expect(Array.from(d.querySelectorAll('section')).every(s => {
      const ns = Array.from(s.children).filter(c => c.localName === 'staff').map(c => c.getAttribute('n'));
      return new Set(ns).size === ns.length;
    })).toBeTrue();
    expect(d.querySelector('layer > sb')).toBeNull();
    expect(d.querySelectorAll('staff[n="1"] > layer[n="1"] > syllable').length).toBe(2);
  });

  it('conformant: the staffDef declares neume notation, without which Verovio and MEI-Friend read the chant as common music notation', () => {
    expect(build(true, [note('n1')]).querySelector('scoreDef > staffGrp > staffDef')?.getAttribute('notationtype')).toBe('neume');
  });

  it('conformant: the scoreDef declares staff 1, which a Schematron rule of the schema requires for every staff; by default it stays empty', () => {
    const def = build(true, [note('n1')]).querySelector('scoreDef > staffGrp > staffDef');
    expect(def?.getAttribute('n')).toBe('1');
    expect(def?.getAttribute('lines')).toBe('5');
    expect(def?.getAttribute('notationtype')).toBe('neume');
    expect(build(false, [note('n1')]).querySelector('staffDef')).toBeNull();
  });

  it('conformant: oriscus, quilisma, strophicus and liquescent are empty children of an nc that keeps pitch and octave', () => {
    const d = build(true, [note('n1', NoteType.Oriscus), note('n2', NoteType.Quilisma), note('n3', NoteType.Strophicus), note('n4', NoteType.Normal, true)]);
    const ncs = Array.from(d.querySelectorAll('staff[n="1"] > layer neume > nc'));
    expect(ncs.length).toBe(5);       // four notes of the first line and one of the second
    expect(names(ncs[0])).toEqual(['oriscus']);
    expect(names(ncs[1])).toEqual(['quilisma']);
    expect(names(ncs[2])).toEqual(['strophicus']);
    expect(names(ncs[3])).toEqual(['liquescent']);
    expect(ncs[0].getAttribute('pname')).toBe('g');
    expect(ncs[0].getAttribute('oct')).toBe('4');
    expect(ncs[3].hasAttribute('curve')).toBeFalse();
    expect(d.querySelector('neume > oriscus, neume > liquescent, neume > quilisma, neume > strophicus')).toBeNull();
    expect(Array.from(d.querySelectorAll('oriscus, quilisma, strophicus, liquescent')).every(e => e.children.length === 0)).toBeTrue();
  });

  it('conformant: a note with a type and the liquescent flag carries both ornaments', () => {
    const d = build(true, [note('n1', NoteType.Oriscus, true)]);
    expect(names(d.querySelector('neume > nc'))).toEqual(['oriscus', 'liquescent']);
  });

  it('conformant: no xml:id occurs twice', () => {
    const d = build(true, [note('n1', NoteType.Oriscus), note('n2')]);
    const ids = Array.from(d.querySelectorAll('[*|id]')).map(e => e.getAttribute('xml:id'));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('conformant: an accidental is an accid of the syllable at its place in the sequence of neumes, not an nc', () => {
    const d = build(true, [], [[note('n1')], [note('f1', NoteType.Flat)], [note('n2')]]);
    const syllable = d.querySelector('syllable')!;
    expect(names(syllable)).toEqual(['syl', 'neume', 'accid', 'neume']);       // the unit with only the flat is no neume
    const accid = syllable.querySelector('accid')!;
    expect(accid.getAttribute('accid')).toBe('f');
    expect(accid.getAttribute('ploc')).toBe('g');
    expect(accid.getAttribute('oloc')).toBe('4');
    expect(syllable.querySelectorAll('nc').length).toBe(2);                    // the flat adds no pitch to the melody
  });

  it('conformant: natural and sharp become accid="n" and accid="s"; an accidental first in a unit stands before its neume', () => {
    const d = build(true, [], [[note('s1', NoteType.Sharp), note('n1')], [note('t1', NoteType.Natural)]]);
    const syllable = d.querySelector('syllable')!;
    expect(names(syllable)).toEqual(['syl', 'accid', 'neume', 'accid']);
    expect(Array.from(syllable.querySelectorAll('accid')).map(a => a.getAttribute('accid'))).toEqual(['s', 'n']);
  });

  it('also in the default structure an accidental is an accid of the syllable and adds no note', () => {
    const d = build(false, [], [[note('f1', NoteType.Flat)]]);
    expect(d.querySelector('syllable > accid')?.getAttribute('accid')).toBe('f');
    expect(d.querySelectorAll('syllable neume nc').length).toBe(1);            // only the note of the second line's syllable
  });

  it('with accidentals="note" an accidental stays an nc, as in earlier exports', () => {
    const d = build(false, [], [[note('f1', NoteType.Flat)]], 'note');
    expect(d.querySelector('accid')).toBeNull();
    expect(d.querySelectorAll('syllable neume nc').length).toBe(2);            // the flat and the note of the second line's syllable
  });

  it('hand-set attributes of a flat are written to its accid', () => {
    const root = emptyRootContainer();
    const formteil = emptyFormteilContainer(DocumentType.Level1, []);
    const zeile = emptyZeileContainer(1);
    const syl = emptySyllable(1);
    syl.notes = { spaced: [{ nonSpaced: [{ grouped: [{ ...note('f1', NoteType.Flat), meiAttrs: { func: 'caution' } }] }] }] } as any;
    zeile.children = [syl];
    formteil.children = [zeile];
    root.children = [formteil];
    const d = new DOMParser().parseFromString(emitMei(root, defaultMeiProfile()), 'application/xml');
    expect(d.querySelector('accid')?.getAttribute('func')).toBe('caution');
  });

  it('conformant: a note head with a stem up or down gets nc/@tilt n or s; no liquescent is claimed', () => {
    const d = build(true, [note('a1', NoteType.Ascending), note('d1', NoteType.Descending), note('n1')]);
    const ncs = Array.from(d.querySelectorAll('neume > nc'));
    expect(ncs.slice(0, 3).map(n => n.getAttribute('tilt'))).toEqual(['n', 's', null]);
    expect(d.querySelector('liquescent')).toBeNull();
  });

  it('conformant: a change of manuscript page is a pb with the folio in @label (and @n if it is one token), in the layer at its place; by default it is not written', () => {
    const make = (conformant: boolean): Document => {
      const root = emptyRootContainer();
      const formteil = emptyFormteilContainer(DocumentType.Level1, []);
      const zeile = emptyZeileContainer(1);
      const syl = emptySyllable(1);
      syl.text = 'A';
      syl.notes = { spaced: [{ nonSpaced: [{ grouped: [note('n1')] }] }] } as any;
      zeile.children = [syl, { uuid: 'fc1', kind: 'FolioChange', focus: false, text: '108' } as any, { uuid: 'fc1', kind: 'FolioChange', focus: false, text: 'f. 109' } as any, emptySyllable(2)];
      formteil.children = [zeile];
      root.children = [formteil];
      const profile = defaultMeiProfile();
      profile.schemaConformant = conformant;
      return new DOMParser().parseFromString(emitMei(root, profile), 'application/xml');
    };
    const on = make(true);
    expect(names(on.querySelector('layer')!)).toEqual(['syllable', 'pb', 'pb', 'syllable']);
    const pbs = Array.from(on.querySelectorAll('layer > pb'));
    expect(pbs.map(p => p.getAttribute('label'))).toEqual(['108', 'f. 109']);
    expect(pbs.map(p => p.getAttribute('n'))).toEqual(['108', null]);           // "f. 109" has a space: not a valid @n
    expect(new Set(pbs.map(p => p.getAttribute('xml:id'))).size).toBe(2);       // a repeated uuid in the data still gives unique ids
    expect(make(false).querySelector('pb')).toBeNull();
  });

  it('conformant: the xml-model lines name the released MEI 5.0 neumes schema; the default keeps the development URL', () => {
    const text = (conformant: boolean) => {
      const profile = defaultMeiProfile();
      profile.schemaConformant = conformant;
      return emitMei(emptyRootContainer(), profile);
    };
    expect(text(true)).toContain('href="https://music-encoding.org/schema/5.0/mei-Neumes.rng"');
    expect(text(true)).not.toContain('schema/dev/');
    expect(text(false)).toContain('href="https://music-encoding.org/schema/dev/mei-Neumes.rng"');
  });
  describe('parts of the Monodi data that the conformant structure adds', () => {
    function chant(conformant: boolean): Document {
      const root = emptyRootContainer();
      const formteil = emptyFormteilContainer(DocumentType.Level1, []);
      formteil.data = [{ name: 'Signatur', data: 'A b' }, { name: 'Status', data: 'Tropenelement' }, { name: 'Verweis', data: 'CAO 1' }] as any;
      const zeile = emptyZeileContainer(1);
      const syllables = ['Glo-', 'ri-', 'a', 'in', '…'].map((text, i) => {
        const syl = emptySyllable(i);
        syl.text = text;
        syl.notes = { spaced: i === 3 ? [{ nonSpaced: [{ grouped: [] }] }] : [{ nonSpaced: [{ grouped: [note('n' + i)] }] }] } as any;
        return syl;
      });
      syllables[3].syllableType = SyllableType.WithoutNotes;
      zeile.children = [syllables[0], syllables[1], { kind: LinePartKind.LineChange, uuid: 'lc', focus: false } as any,
        syllables[2], syllables[3], syllables[4]];
      formteil.children = [{ kind: ContainerKind.ParatextContainer, uuid: 'px', text: 'INTROITUS', paratextType: ParatextType.Gesang, focus: false } as any, zeile];
      root.children = [formteil];
      root.globalComment = { kind: 'CommentTreeLeaf', id: 'g', content: { kind: 'Text', content: 'General remark' } } as any;
      const profile = defaultMeiProfile();
      profile.schemaConformant = conformant;
      profile.emitHeader = true;
      return new DOMParser().parseFromString(emitMei(root, profile), 'application/xml');
    }

    it('writes the paratext as an annot with its type at the start of the layer of the line that follows it (an annot directly in a section crashes Verovio)', () => {
      const d = chant(true);
      const a = d.querySelector('layer > annot[type="paratext"]')!;
      expect(a.getAttribute('label')).toBe('Gesang');
      expect(a.textContent).toBe('INTROITUS');
      // the annotations keep their order: the reference of the form part comes first, then the paratext, then the syllables
      expect(names(a.parentElement)).toEqual(['annot', 'annot', 'syllable', 'syllable', 'sb', 'syllable', 'syllable', 'syllable']);
      expect(a.previousElementSibling?.getAttribute('type')).toBe('verweis');
      expect(d.querySelector('section > annot')).toBeNull();
    });

    it('writes a line change as an sb of type manuscriptLine in the layer, and keeps the sb of the edition line', () => {
      const d = chant(true);
      expect(d.querySelectorAll('section > sb:not([type])').length).toBe(1);
      expect(d.querySelector('layer > sb[type="manuscriptLine"]')?.previousElementSibling?.querySelector('syl')?.textContent).toBe('ri-');
    });

    it('derives the word position from the hyphen; an ellipsis gets none', () => {
      const syl = Array.from(chant(true).querySelectorAll('syl'));
      expect(syl.map(s => s.getAttribute('wordpos'))).toEqual(['i', 'm', 't', 's', null]);
      expect(syl.map(s => s.getAttribute('con'))).toEqual(['d', 'd', null, null, null]);
    });

    it('marks the type of a syllable that is not normal and leaves out a group without notes', () => {
      const d = chant(true);
      const s = d.querySelector('syllable[type="withoutNotes"]')!;
      expect(s.querySelector('syl')?.textContent).toBe('in');
      expect(s.querySelector('neume')).toBeNull();
    });

    it('writes Signatur as section/@label and Status as section/@type', () => {
      const s = chant(true).querySelector('section > section')!;
      expect(s.getAttribute('label')).toBe('A b');
      expect(s.getAttribute('type')).toBe('Tropenelement');
    });

    it('writes the general comment as an annot in fileDesc/notesStmt', () => {
      expect(chant(true).querySelector('fileDesc > notesStmt > annot[type="global-comment"]')?.textContent).toBe('General remark');
    });

    it('keeps the line change, word position and general comment out of the earlier structure (schemaConformant = false)', () => {
      const d = chant(false);
      expect(d.querySelector('sb[type]')).toBeNull();
      expect(d.querySelector('syl[wordpos]')).toBeNull();
      expect(d.querySelector('annot[type="global-comment"]')).toBeNull();
    });
  });
});

describe('MEI body structure: syllable types, paratext, line breaks, clefs, voices and contours', () => {
  const names = (e: Element | null) => Array.from(e?.children ?? []).map(c => c.localName);
  const nc = (uuid: string, base: BaseNote = BaseNote.G, octave = 4): any => ({ uuid, base, octave, noteType: NoteType.Normal, liquescent: false, focus: false });
  const syl = (uuid: string, text: string, type: SyllableType, ...bases: BaseNote[]): any => ({
    kind: LinePartKind.Syllable, uuid, text, syllableType: type,
    notes: { spaced: bases.map((b, i) => ({ nonSpaced: [{ grouped: [nc(uuid + '-n' + i, b)] }] })) }
  });

  function emit(parts: any[], tweak: (p: MeiMappingProfileV2) => void = () => {}, zeileExtra: any = {}, formteilExtra: any[] = []): Document {
    const root = emptyRootContainer();
    const formteil = emptyFormteilContainer(DocumentType.Level1, []);
    const zeile = emptyZeileContainer(1);
    zeile.children = parts;
    Object.assign(zeile, zeileExtra);
    formteil.children = [...formteilExtra, zeile];
    root.children = [formteil];
    const profile = defaultMeiProfile();
    tweak(profile);
    return new DOMParser().parseFromString(emitMei(root, profile), 'application/xml');
  }

  it('writes a syllable without notes as a syllable with @type, and an ellipsis as supplied around the syllable', () => {
    const d = emit([syl('a', 'Ky', SyllableType.WithoutNotes), syl('b', '', SyllableType.SourceEllipsis), syl('c', '', SyllableType.EditorialEllipsis, BaseNote.G)]);
    const layer = d.querySelector('layer')!;
    expect(names(layer)).toEqual(['syllable', 'supplied', 'supplied']);
    expect(layer.children[0].getAttribute('type')).toBe('withoutNotes');
    expect(layer.children[1].getAttribute('type')).toBe('sourceEllipsis');
    expect(layer.children[1].getAttribute('reason')).toBeTruthy();
    expect(names(layer.children[2])).toEqual(['syllable']);
    expect(layer.children[2].getAttribute('type')).toBe('editorialEllipsis');
    expect(layer.children[2].querySelector('nc')).not.toBeNull();
  });

  it('the form of a syllable type can be changed per type: gap, attribute or nothing', () => {
    const d = emit([syl('a', '', SyllableType.SourceEllipsis), syl('b', '', SyllableType.EditorialEllipsis), syl('c', 'x', SyllableType.WithoutNotes)], p => {
      p.syllableTypes = {
        SourceEllipsis: { form: 'gap', value: 'omitted', reason: 'abbreviated' },
        EditorialEllipsis: { form: 'attribute', value: 'ed' },
        WithoutNotes: { form: 'none', value: '' }
      };
    });
    const [a, b, c] = Array.from(d.querySelector('layer')!.children);
    expect(names(a)).toEqual(['gap']);
    expect(a.querySelector('gap')!.getAttribute('reason')).toBe('abbreviated');
    expect(b.getAttribute('type')).toBe('ed');
    expect(c.hasAttribute('type')).toBeFalse();
    expect(d.querySelector('supplied')).toBeNull();
  });

  it('writes no empty neume for a unit without notes', () => {
    const s = syl('a', 'x', SyllableType.Normal);
    s.notes = { spaced: [{ nonSpaced: [{ grouped: [] }] }] };
    expect(emit([s]).querySelector('neume')).toBeNull();
  });

  it('writes the paratext as an annot at the start of the layer of the following line, with its kind as @label', () => {
    const paratext = { kind: ContainerKind.ParatextContainer, uuid: 'p1', text: 'Ad missam', retro: false, paratextType: 'Feier' };
    const d = emit([syl('a', 'x', SyllableType.Normal, BaseNote.G)], () => {}, {}, [paratext as any]);
    const section = d.querySelector('section > section')!;
    expect(names(section)).toEqual(['sb', 'staff']);
    const annot = section.querySelector('staff > layer')!.children[0];
    expect(annot.localName).toBe('annot');
    expect(annot.getAttribute('type')).toBe('paratext');
    expect(annot.getAttribute('label')).toBe('Feier');
    expect(annot.textContent).toBe('Ad missam');
  });

  it('writes the signature and status of a form part as @label and @type, and the incipit as an annot', () => {
    const root = emptyRootContainer();
    const formteil = emptyFormteilContainer(DocumentType.Level1, []);
    formteil.data = [
      { name: FormteilDataName.Signatur, data: 'A b' }, { name: FormteilDataName.Status, data: 'Draft' },
      { name: FormteilDataName.LemmatisiertesTextInitium, data: 'Kyrie eleison' }
    ];
    root.children = [formteil];
    const d = new DOMParser().parseFromString(emitMei(root, defaultMeiProfile()), 'application/xml');
    const section = d.querySelector('section > section')!;
    expect(section.getAttribute('label')).toBe('A b');
    expect(section.getAttribute('type')).toBe('Draft');
    const initium = section.querySelector('annot[type="initium"]')!;
    expect(initium.textContent).toBe('Kyrie eleison');
    expect(initium.parentElement!.localName).toBe('layer');          // a form part without lines gets a staff for it: no annot stays directly in a section
    expect(d.querySelector('section > annot')).toBeNull();
  });

  it('writes a change of the manuscript line as an sb in the layer, unless the option is off', () => {
    const parts = [syl('a', 'x', SyllableType.Normal, BaseNote.G), { kind: LinePartKind.LineChange, uuid: 'lc', focus: false }, syl('b', 'y', SyllableType.Normal, BaseNote.A)];
    const sb = emit(parts).querySelector('layer > sb')!;
    expect(sb.getAttribute('type')).toBe('manuscriptLine');
    expect(sb.getAttribute('xml:id')).toBe('m-lc');
    expect(emit(parts, p => { p.lineBreaks = false; }).querySelector('layer > sb')).toBeNull();
  });

  it('takes the line of a clef from its position and declares the G clef on the second line in the staffDef', () => {
    const clef = (base: BaseNote, octave: number): any => ({ kind: LinePartKind.Clef, uuid: 'c' + base + octave, focus: false, base, octave, shape: 'c' });
    const d = emit([clef(BaseNote.E, 4), clef(BaseNote.G, 4), clef(BaseNote.B, 4), clef(BaseNote.D, 5), clef(BaseNote.F, 5), clef(BaseNote.A, 6)]);
    expect(Array.from(d.querySelectorAll('layer > clef')).map(c => c.getAttribute('line'))).toEqual(['1', '2', '3', '4', '5', '5']);
    expect(d.querySelector('clef')!.getAttribute('shape')).toBe('C');
    const def = d.querySelector('staffDef')!;
    expect([def.getAttribute('lines'), def.getAttribute('clef.shape'), def.getAttribute('clef.line')]).toEqual(['5', 'G', '2']);
    const f = emit([], p => { p.staff = { lines: 4, clefShape: 'F', clefLine: 3 }; }).querySelector('staffDef')!;
    expect([f.getAttribute('lines'), f.getAttribute('clef.shape'), f.getAttribute('clef.line')]).toEqual(['4', 'F', '3']);
  });

  it('writes each additional melody as a staff of its own with a layer, syllables that point to the syllable of voice 1, and a staffDef per staff', () => {
    const s = syl('a', 'x', SyllableType.Normal, BaseNote.G);
    s.additionalMelodies = [{ spaced: [{ nonSpaced: [{ grouped: [nc('v2n', BaseNote.C), nc('v2m', BaseNote.D)] }] }] }];
    const d = emit([s]);
    const section = d.querySelector('section > section')!;
    expect(names(section)).toEqual(['sb', 'staff', 'staff']);
    const staves = Array.from(section.querySelectorAll(':scope > staff'));
    expect(staves.map(st => st.getAttribute('n'))).toEqual(['1', '2']);
    expect(staves.map(st => names(st))).toEqual([['layer'], ['layer']]);
    const defs = Array.from(d.querySelectorAll('staffDef'));
    expect(defs.map(def => def.getAttribute('n'))).toEqual(['1', '2']);
    expect(defs.every(def => def.getAttribute('notationtype') === 'neume')).toBeTrue();
    const first = staves[0].querySelector('layer > syllable')!;
    const second = staves[1].querySelector('layer > syllable')!;
    expect(first.querySelector('syl')!.textContent).toBe('x');
    expect(second.getAttribute('corresp')).toBe('#m-a');
    expect(second.querySelector('syl')).toBeNull();
    expect(names(second)).toEqual(['neume']);
    // the neumes of the two voices align (same unit of the same syllable): only the neume of voice 2 has @synch, pointing to voice 1
    const n1 = first.querySelector('neume')!, n2 = second.querySelector('neume')!;
    expect(n1.getAttribute('xml:id')).toBe('m-a-neume1');
    expect(n1.hasAttribute('synch')).toBeFalse();
    expect(n2.getAttribute('synch')).toBe('#m-a-neume1');
    expect(Array.from(second.querySelectorAll('neume > nc')).map(n => n.getAttribute('pname'))).toEqual(['c', 'd']);
    expect(new Set(Array.from(d.querySelectorAll('[*|id]')).map(e => e.getAttribute('xml:id'))).size).toBe(d.querySelectorAll('[*|id]').length);
    const off = emit([s], p => { p.voices = false; });
    expect(off.querySelectorAll('staff').length).toBe(1);
    expect(off.querySelectorAll('staffDef').length).toBe(1);
  });

  it('declares a staffDef for the highest voice number of the document and writes a staff only on the lines that have that voice', () => {
    const two = syl('a', 'x', SyllableType.Normal, BaseNote.G);
    two.additionalMelodies = [{ spaced: [{ nonSpaced: [{ grouped: [nc('v2n', BaseNote.C)] }] }] }];
    const one = syl('b', 'y', SyllableType.Normal, BaseNote.A);
    const root = emptyRootContainer();
    const formteil = emptyFormteilContainer(DocumentType.Level1, []);
    const z1 = emptyZeileContainer(1); z1.children = [one];
    const z2 = emptyZeileContainer(2); z2.children = [two];
    formteil.children = [z1, z2];
    root.children = [formteil];
    const d = new DOMParser().parseFromString(emitMei(root, defaultMeiProfile()), 'application/xml');
    expect(d.querySelectorAll('staffDef').length).toBe(2);
    // line 1 has one staff; line 2 (a section of its own) has the staves of both voices
    const lines = Array.from(d.querySelectorAll('section section'));
    expect(lines.map(sec => Array.from(sec.children).filter(c => c.localName === 'staff').map(c => c.getAttribute('n')))).toEqual([['1'], ['1', '2']]);
  });

  it('writes the notes of an adiastematic line as contours (@intm) without pitch, unless pitches are asked for', () => {
    const s = syl('a', 'x', SyllableType.Normal, BaseNote.G, BaseNote.A, BaseNote.A, BaseNote.E);
    const contour = Array.from(emit([s], () => {}, { notation: 'adiastematic' }).querySelectorAll('nc'));
    expect(contour.map(n => n.getAttribute('intm'))).toEqual([null, 'u', 's', 'd']);
    expect(contour.every(n => !n.hasAttribute('pname') && !n.hasAttribute('oct'))).toBeTrue();
    expect(emit([s], () => {}, { notation: 'adiastematic' }).querySelector('staff')!.getAttribute('type')).toBe('adiastematic');
    const pitched = Array.from(emit([s], p => { p.adiastematic = 'pitch'; }, { notation: 'adiastematic' }).querySelectorAll('nc'));
    expect(pitched[0].getAttribute('pname')).toBe('g');
    expect(pitched[0].hasAttribute('intm')).toBeFalse();
    expect(Array.from(emit([s]).querySelectorAll('nc')).every(n => n.hasAttribute('pname'))).toBeTrue();
  });
});

describe('MEI body structure: placeholder box', () => {
  it('writes a box of the transcription as an empty space, so a comment on it has an anchor', () => {
    const root = emptyRootContainer();
    const formteil = emptyFormteilContainer(DocumentType.Level1, []);
    const zeile = emptyZeileContainer(1);
    zeile.children = [{ kind: LinePartKind.Box, uuid: 'bx', focus: false }];
    formteil.children = [zeile];
    root.children = [formteil];
    const d = new DOMParser().parseFromString(emitMei(root, defaultMeiProfile()), 'application/xml');
    expect(d.querySelector('layer > space')!.getAttribute('xml:id')).toBe('m-bx');
  });
});
