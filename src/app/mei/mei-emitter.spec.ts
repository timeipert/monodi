import { TestBed } from '@angular/core/testing';
import { emitMei } from './mei-emitter';
import { defaultMeiProfile } from './mei-mapping.model';
import { 
  emptyRootContainer, 
  emptyFormteilContainer, 
  emptyZeileContainer, 
  emptySyllable, 
  emptyClef, 
  emptyParatextContainer,
  DocumentType, 
  BaseNote, 
  NoteType,
  ContainerKind,
  LinePartKind
} from '../types/model';
import { setNoteFlagDefs } from '../notes/note-flags';
import { Document as MonodiDocument } from '../api.service';

describe('MeiEmitter', () => {
  function nc(uuid: string, base: BaseNote = BaseNote.G): any {
    return { uuid, base, octave: 4, noteType: NoteType.Normal, liquescent: false, focus: false };
  }

  function ncsOf(spaced: any[], placement?: 'next' | 'previous', selector = 'nc'): Element[] {
    const root = emptyRootContainer();
    const formteil = emptyFormteilContainer(DocumentType.Level1, []);
    const zeile = emptyZeileContainer(1);
    const syl = emptySyllable(1);
    syl.text = 'A';
    syl.notes = { spaced };
    zeile.children = [syl];
    formteil.children = [zeile];
    root.children = [formteil];
    const profile = defaultMeiProfile();
    if (placement) profile.gapPlacement = placement;
    const doc = new DOMParser().parseFromString(emitMei(root, profile), 'application/xml');
    return Array.from(doc.querySelectorAll(selector));
  }

  it('puts con="g" on the nc after a break between non-ligated groups (*u), none for a ligature ([*u])', () => {
    const gapped = ncsOf([{ nonSpaced: [{ grouped: [nc('a')] }, { grouped: [nc('b', BaseNote.A)] }] }]);
    expect(gapped.map(n => n.getAttribute('con'))).toEqual([null, 'g']);

    const ligature = ncsOf([{ nonSpaced: [{ grouped: [nc('a'), nc('b', BaseNote.A)] }] }]);
    expect(ligature.map(n => n.getAttribute('con'))).toEqual([null, null]);
  });

  it('supports gapPlacement "previous" and keeps the gap between neumes on the last nc', () => {
    const prev = ncsOf([{ nonSpaced: [{ grouped: [nc('a')] }, { grouped: [nc('b', BaseNote.A)] }] }], 'previous');
    expect(prev.map(n => n.getAttribute('con'))).toEqual(['g', null]);

    const neumes = ncsOf([
      { nonSpaced: [{ grouped: [nc('a'), nc('b', BaseNote.A)] }] },
      { nonSpaced: [{ grouped: [nc('c')] }] }
    ]);
    expect(neumes.map(n => n.getAttribute('con'))).toEqual([null, 'g', null]);
  });

  it('should flatten ncs into syllable when neume entity is disabled', () => {
    const root = emptyRootContainer();
    const formteil = emptyFormteilContainer(DocumentType.Level1, []);
    const zeile = emptyZeileContainer(1);
    const syl = emptySyllable(1);
    syl.text = 'A';
    syl.notes = {
      spaced: [{
        nonSpaced: [{
          grouped: [{
            uuid: 'n-1',
            base: BaseNote.G,
            octave: 4,
            noteType: NoteType.Normal,
            liquescent: false,
            focus: false
          }]
        }]
      }]
    };
    zeile.children = [syl];
    formteil.children = [zeile];
    root.children = [formteil];

    const profile = defaultMeiProfile();
    profile.entities.neume.enabled = false;

    const xml = emitMei(root, profile);
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, 'application/xml');

    expect(doc.querySelector('neume')).toBeNull();
    expect(doc.querySelector('syllable > nc')).not.toBeNull();
  });

  it('should add wrappers around syllable when configured', () => {
    const root = emptyRootContainer();
    const formteil = emptyFormteilContainer(DocumentType.Level1, []);
    const zeile = emptyZeileContainer(1);
    const syl = emptySyllable(1);
    zeile.children = [syl];
    formteil.children = [zeile];
    root.children = [formteil];

    const profile = defaultMeiProfile();
    profile.entities.syllable.wrappers = ['my-syl-wrapper'];

    const xml = emitMei(root, profile);
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, 'application/xml');

    expect(doc.querySelector('my-syl-wrapper > syllable')).not.toBeNull();
  });

  it('should render static attribute rules and respect omitIfEmpty', () => {
    const root = emptyRootContainer();
    const formteil = emptyFormteilContainer(DocumentType.Level1, []);
    const zeile = emptyZeileContainer(1);
    const clef = emptyClef();
    clef.shape = 'C';
    zeile.children = [clef];
    formteil.children = [zeile];
    root.children = [formteil];

    const profile = defaultMeiProfile();
    
    // Add static attribute rule
    profile.entities.clef.attributes.push({
      name: 'custom-static',
      source: 'static',
      value: 'static-value'
    });

    // Add field attribute rule that will be empty and should be omitted
    profile.entities.clef.attributes.push({
      name: 'custom-empty',
      source: 'field',
      value: 'non-existent-field',
      omitIfEmpty: true
    });

    // Add field attribute rule that will be empty and should NOT be omitted (thus sets empty string)
    profile.entities.clef.attributes.push({
      name: 'custom-empty-present',
      source: 'field',
      value: 'non-existent-field',
      omitIfEmpty: false
    });

    const xml = emitMei(root, profile);
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, 'application/xml');

    const clefEl = doc.querySelector('clef');
    expect(clefEl).not.toBeNull();
    expect(clefEl!.getAttribute('custom-static')).toBe('static-value');
    expect(clefEl!.hasAttribute('custom-empty')).toBe(false);
    expect(clefEl!.getAttribute('custom-empty-present')).toBe('');
  });

  it('should produce identical output for legacy comments without new fields', () => {
    const root = emptyRootContainer();
    const comment = {
      startUUID: 'u1',
      endUUID: 'u2',
      text: 'legacy note text',
      emendation: true
    };
    root.comments = [comment];
    const profile = defaultMeiProfile();
    profile.emitHeader = true;

    const xml = emitMei(root, profile);
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, 'application/xml');

    const annot = doc.querySelector('annot');
    expect(annot).not.toBeNull();
    expect(annot!.getAttribute('type')).toBe('emendation');
    expect(annot!.hasAttribute('cert')).toBe(false);
    expect(doc.querySelector('sourceDesc')).toBeNull();
  });

  it('should enrich header with witnesses, certainty, type list, and nested annotations', () => {
    const root = emptyRootContainer();
    const comment = {
      startUUID: 'u1',
      endUUID: 'u2',
      text: 'enriched note text',
      emendation: true,
      category: 'variant' as any,
      intervention: 'correction' as any,
      certainty: 'high' as any,
      readingWitnesses: ['WitnessA', 'WitnessB'],
      lines: [
        { kind: 'ZeileContainer', id: 'z1', children: [] } as any,
        { kind: 'ZeileContainer', id: 'z2', children: [] } as any
      ]
    };
    root.comments = [comment];
    const profile = defaultMeiProfile();
    profile.emitHeader = true;

    const xml = emitMei(root, profile, undefined, 'MainSource');
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, 'application/xml');

    // Test sourceDesc
    const sourceDesc = doc.querySelector('sourceDesc');
    expect(sourceDesc).not.toBeNull();
    const sources = sourceDesc!.querySelectorAll('source');
    expect(sources.length).toBe(3); // MainSource, WitnessA, WitnessB
    expect(sources[0].getAttribute('xml:id')).toBe('wit-mainsource');
    expect(sources[1].getAttribute('xml:id')).toBe('wit-witnessa');

    // Test annot
    const annot = doc.querySelector('notesStmt > annot');
    expect(annot).not.toBeNull();
    expect(annot!.getAttribute('type')).toBe('emendation correction cat:variant');
    expect(annot!.getAttribute('cert')).toBe('high');

    // Test nested annot readings
    const nestedAnnots = annot!.querySelectorAll('annot');
    expect(nestedAnnots.length).toBe(2);
    expect(nestedAnnots[0].getAttribute('source')).toBe('#wit-witnessa');
    expect(nestedAnnots[1].getAttribute('source')).toBe('#wit-witnessb');
    const nestedPtrs = annot!.querySelectorAll('ptr');
    expect(nestedPtrs.length).toBe(2);
    expect(nestedPtrs[0].getAttribute('target')).toBe('#m-comment-0-reading-0');
  });

  it('should not wrap notes inline if inlineInterventions is false', () => {
    const root = emptyRootContainer();
    const formteil = emptyFormteilContainer(DocumentType.Level1, []);
    const zeile = emptyZeileContainer(1);
    const syl = emptySyllable(1);
    syl.notes = {
      spaced: [
        {
          nonSpaced: [
            {
              grouped: [
                { uuid: 'note-1', base: BaseNote.C, noteType: NoteType.Normal } as any
              ]
            }
          ]
        }
      ]
    };
    zeile.children = [syl];
    formteil.children = [zeile];
    root.children = [formteil];

    const comment = {
      startUUID: 'note-1',
      endUUID: 'note-1',
      text: 'unclear comment',
      intervention: 'unclear' as any,
      certainty: 'high' as any
    };
    root.comments = [comment];

    const profile = defaultMeiProfile();
    profile.inlineInterventions = false;

    const xml = emitMei(root, profile);
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, 'application/xml');

    const noteEl = doc.querySelector('nc');
    expect(noteEl).not.toBeNull();
    expect(doc.querySelector('unclear')).toBeNull();
  });

  it('should not wrap notes inline even when inlineInterventions is true (due to MEI 5 schema validity constraints at nc level)', () => {
    const root = emptyRootContainer();
    const formteil = emptyFormteilContainer(DocumentType.Level1, []);
    const zeile = emptyZeileContainer(1);
    const syl = emptySyllable(1);
    syl.notes = {
      spaced: [
        {
          nonSpaced: [
            {
              grouped: [
                { uuid: 'note-1', base: BaseNote.C, noteType: NoteType.Normal } as any
              ]
            }
          ]
        }
      ]
    };
    zeile.children = [syl];
    formteil.children = [zeile];
    root.children = [formteil];

    const comment = {
      startUUID: 'note-1',
      endUUID: 'note-1',
      text: 'unclear comment',
      intervention: 'unclear' as any,
      certainty: 'high' as any
    };
    root.comments = [comment];

    const profile = defaultMeiProfile();
    profile.inlineInterventions = true;

    const xml = emitMei(root, profile);
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, 'application/xml');

    const noteEl = doc.querySelector('nc');
    expect(noteEl).not.toBeNull();
    expect(doc.querySelector('unclear')).toBeNull();
  });

  it('applies pattern rules per note, preferring a manuscript-specific rule over a global one', () => {
    const spaced = [{ nonSpaced: [{ grouped: [nc('a'), nc('b', BaseNote.A)] }] }]; // [*u]
    const root = emptyRootContainer();
    const formteil = emptyFormteilContainer(DocumentType.Level1, []);
    const zeile = emptyZeileContainer(1);
    const syl = emptySyllable(1);
    syl.notes = { spaced };
    zeile.children = [syl];
    formteil.children = [zeile];
    root.children = [formteil];

    const profile = defaultMeiProfile();
    profile.patternRules = [
      { id: 'g', pattern: '[*u]', enabled: true, nc: [{ tilt: 'n' }, { tilt: 's' }] },
      { id: 'm', pattern: '[*u]', sigle: 'X', enabled: true, nc: [{ tilt: 'e' }, { pname: 'z', q: 'x' }] }
    ];
    const run = (sigle?: string) => Array.from(new DOMParser()
      .parseFromString(emitMei(root, profile, undefined, sigle), 'application/xml').querySelectorAll('nc'));

    expect(run().map(n => n.getAttribute('tilt'))).toEqual(['n', 's']);
    const x = run('X');
    expect(x.map(n => n.getAttribute('tilt'))).toEqual(['e', null]);
    expect(x[1].getAttribute('q')).toBe('x');
    expect(x[1].getAttribute('pname')).toBe('a'); // pitch is never overridden
  });

  it('maps note flags to attributes and element names', () => {
    setNoteFlagDefs([{ key: 'V', label: 'Virga', abbrev: 'V', mei: { type: 'virga' } },
                     { key: 'W', label: 'Other', abbrev: 'W', meiTag: 'virga' }]);
    try {
      const a = nc('a'); a.flags = ['V'];
      const b = nc('b', BaseNote.A); b.flags = ['W'];
      const out = ncsOf([{ nonSpaced: [{ grouped: [a, b] }] }], undefined, 'neume > *');
      expect(out[0].getAttribute('type')).toBe('virga');
      expect(out[0].tagName).toBe('nc');
      expect(out[1].tagName).toBe('virga');
    } finally {
      setNoteFlagDefs([]);
    }
  });
});
