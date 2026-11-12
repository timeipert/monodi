// The structure of the MEI body as data of the profile (structure.ts): reading it from stored profiles, the two built-in structures,
// and the checks that warn about invalid MEI or a structure the import does not read back. What the emitter writes for a structure is
// tested in the app (apps/monodi/src/app/mei/mei-structure.spec.ts and mei-structure-golden.spec.ts), because the emitter needs a
// browser DOM.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MEI_PRESETS, defaultMeiProfile, upgradeMeiProfile } from './mapping.model.ts';
import type { MeiMappingProfileV2 } from './mapping.model.ts';
import type { MeiSchemaCatalog } from './schema-catalog.ts';
import {
  MEI_MENSURAL_SCHEMA_URL, applyBodyStructurePreset, bodyStructureIssues, bodyStructureOf, effectiveGroupMode, effectiveNeumeMode,
  effectiveSyllableMode, matchingBodyStructurePreset, neumeBodyStructure, premensuralBodyStructure
} from './structure.ts';

/** A profile as stored before 2026-11-05: no `structure`, maybe the field `notation`. */
function storedProfile(notation?: 'neume' | 'premensural'): MeiMappingProfileV2 {
  const p = defaultMeiProfile();
  delete p.structure;
  if (notation) p.notation = notation;
  return p;
}

/** A small schema: what the neume structure needs, plus `ncGrp` in `neume` and the premensural elements in `layer`. */
function catalog(): MeiSchemaCatalog {
  const el = (children: string[], attrs: string[] = []) => ({ children, attrs });
  return {
    format: 1, id: 'test', label: 'test schema', schemaVersion: '5.0', origin: 'bundled',
    attrDefs: { notationtype: { name: 'notationtype', type: 'enum', values: [{ value: 'neume' }, { value: 'mensural' }] } },
    elements: {
      section: el(['staff', 'sb']), staff: el(['layer']), layer: el(['syllable', 'accid', 'ligature', 'note']),
      syllable: el(['syl', 'neume', 'accid']), syl: el([]), neume: el(['nc', 'ncGrp']), ncGrp: el(['nc']), nc: el(['oriscus', 'quilisma', 'strophicus', 'liquescent']),
      oriscus: el([]), quilisma: el([]), strophicus: el([]), liquescent: el([]), accid: el([]),
      ligature: el(['note']), note: el(['verse', 'plica']), verse: el(['syl']), plica: el([]), staffDef: el([], ['notationtype'])
    }
  };
}

describe('structure of the MEI body', () => {
  it('a profile stored without a structure gets the built-in structure its field `notation` named', () => {
    assert.deepEqual(bodyStructureOf(storedProfile()), neumeBodyStructure());
    assert.deepEqual(bodyStructureOf(storedProfile('neume')), neumeBodyStructure());
    assert.deepEqual(bodyStructureOf(storedProfile('premensural')), premensuralBodyStructure());
  });

  it('an incomplete stored structure (for example from a profile file) is completed from the neume structure', () => {
    const p = storedProfile();
    p.structure = { text: { holder: 'note' } } as never;
    const s = bodyStructureOf(p);
    assert.equal(s.text.holder, 'note');
    assert.equal(s.text.position, 'first');
    assert.deepEqual(s.text.wrappers, []);
    assert.equal(s.voice.staff, 'staff');
    assert.equal(s.accid.element, 'accid');
  });

  it('upgradeMeiProfile writes the structure into a stored profile and removes `notation`', () => {
    const p = upgradeMeiProfile(storedProfile('premensural'));
    assert.deepEqual(p.structure, premensuralBodyStructure());
    assert.equal('notation' in p, false);
    const q = upgradeMeiProfile(storedProfile());
    assert.deepEqual(q.structure, neumeBodyStructure());
  });

  it('a built-in structure sets the structure and the element names of syllable, text, neume and note', () => {
    const p = applyBodyStructurePreset(defaultMeiProfile(), 'premensural');
    assert.equal(p.structure?.syllable, 'never');
    assert.equal(p.structure?.schemaUrl, MEI_MENSURAL_SCHEMA_URL);
    assert.equal(p.entities.neume.tag, 'ligature');
    assert.equal(p.entities.note.tag, 'note');
    assert.equal(matchingBodyStructurePreset(p)?.id, 'premensural');
    applyBodyStructurePreset(p, 'neume');
    assert.equal(p.entities.neume.tag, 'neume');
    assert.equal(p.entities.note.tag, 'nc');
    assert.equal(matchingBodyStructurePreset(p)?.id, 'neume');
  });

  it('the profile presets have the built-in structures; a change of an element name makes a structure of its own', () => {
    const neumes = MEI_PRESETS.find(x => x.id === 'neumes-staves')!.build();
    const premensural = MEI_PRESETS.find(x => x.id === 'premensural-staves')!.build();
    assert.equal(matchingBodyStructurePreset(neumes)?.id, 'neume');
    assert.equal(matchingBodyStructurePreset(premensural)?.id, 'premensural');
    neumes.entities.note.tag = 'note';
    assert.equal(matchingBodyStructurePreset(neumes), null);
    premensural.structure!.group = { element: 'ligature', mode: 'several', attributes: [] };
    assert.equal(matchingBodyStructurePreset(premensural), null);
    // a group name kept while the group level is not written changes nothing in the output
    premensural.structure!.group.mode = 'never';
    assert.equal(matchingBodyStructurePreset(premensural)?.id, 'premensural');
  });

  it('the switch of an entity rule and an empty group name turn a level off', () => {
    const p = defaultMeiProfile();
    assert.equal(effectiveSyllableMode(p), 'always');
    p.entities.syllable.enabled = false;
    assert.equal(effectiveSyllableMode(p), 'never');
    p.structure!.neume = 'several';
    assert.equal(effectiveNeumeMode(p), 'several');
    p.entities.neume.enabled = false;
    assert.equal(effectiveNeumeMode(p), 'never');
    p.structure!.group.mode = 'always';
    assert.equal(effectiveGroupMode(p.structure!), 'never');
    p.structure!.group.element = 'ncGrp';
    assert.equal(effectiveGroupMode(p.structure!), 'always');
  });
});

describe('checks of a structure', () => {
  it('the neume structure has no problems; the premensural structure is reported where it is not valid MEI (state 2026-11-05)', () => {
    const neumes = MEI_PRESETS.find(x => x.id === 'neumes-staves')!.build();
    assert.deepEqual(bodyStructureIssues(neumes, catalog()), []);
    // The premensural structure writes the text into the ligature, ornaments into the note and notationtype="premensural", none of
    // which MEI allows; it leaves out the syllable element, so the import cannot restore syllables without notes. The export writes it
    // anyway, as before the structure became data (commit 50b6aa1c).
    const premensural = MEI_PRESETS.find(x => x.id === 'premensural-staves')!.build();
    const issues = bodyStructureIssues(premensural, catalog());
    const found = new Set(issues.map(i => `${i.kind} ${i.level}`));
    assert.deepEqual([...found].sort(), ['import syllable', 'mei note', 'mei staffDef', 'mei text']);
    assert.ok(issues.some(i => /does not allow <verse> in <ligature>/.test(i.message)));
    assert.ok(issues.some(i => /"premensural" is not a value of staffDef\/@notationtype/.test(i.message)));
  });

  it('a name that is not an XML name stops the export; an unknown element is written as given, with a warning', () => {
    const p = defaultMeiProfile();
    p.entities.note.tag = 'my note';
    p.structure!.group = { element: 'neumeGroup', mode: 'always', attributes: [] };
    const issues = bodyStructureIssues(p, catalog());
    assert.ok(issues.some(i => i.kind === 'error' && i.level === 'note'));
    assert.ok(issues.some(i => i.kind === 'mei' && i.level === 'group' && /<neumeGroup> is not an element of the schema/.test(i.message)));
  });

  it('the nesting is checked level by level, with both places of a level written only with several children', () => {
    const p = defaultMeiProfile();
    p.structure!.group = { element: 'ncGrp', mode: 'always', attributes: [] };
    assert.deepEqual(bodyStructureIssues(p, catalog()), []);
    // `several`: a group of one note leaves its note in the neume (allowed), a group of several notes is an ncGrp in the neume (allowed)
    p.structure!.group.mode = 'several';
    assert.deepEqual(bodyStructureIssues(p, catalog()), []);
    // a neume written only with several children puts a single nc into the syllable, which the schema does not allow
    p.structure!.neume = 'several';
    const issues = bodyStructureIssues(p, catalog());
    assert.ok(issues.some(i => i.kind === 'mei' && i.level === 'group' && /<ncGrp> in <syllable>/.test(i.message)), JSON.stringify(issues));
  });

  it('the text: its wrappers and its holder are checked, and a text in a syllable that is not written is reported', () => {
    const p = defaultMeiProfile();
    p.structure!.text.wrappers = ['verse'];
    assert.ok(bodyStructureIssues(p, catalog()).some(i => i.level === 'text' && /<verse> in <syllable>/.test(i.message)));
    p.structure!.syllable = 'never';
    const issues = bodyStructureIssues(p);
    assert.ok(issues.some(i => i.kind === 'import' && i.level === 'text'));
    assert.ok(issues.some(i => i.kind === 'import' && i.level === 'syllable'));
  });

  it('elements around a syllable, neume or note are written but not read back by the import', () => {
    const p = defaultMeiProfile();
    p.entities.neume.wrappers = ['choice'];
    const issues = bodyStructureIssues(p);
    assert.ok(issues.some(i => i.kind === 'import' && i.level === 'neume' && /<choice>/.test(i.message)), JSON.stringify(issues));
  });

  it('the import needs different element names per level and two different stem values', () => {
    const p = defaultMeiProfile();
    p.entities.neume.tag = 'nc';
    p.structure!.stem.down = 'n';
    const issues = bodyStructureIssues(p);
    assert.ok(issues.some(i => i.kind === 'import' && i.level === 'note' && /<nc> stands for two levels/.test(i.message)));
    assert.ok(issues.some(i => i.kind === 'import' && i.level === 'stem'));
  });
});
