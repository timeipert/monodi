import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { defaultMeiProfile, migrateV1MeiMappings, upgradeMeiProfile } from './mapping.model.ts';
import type { MeiEntityKey } from './mapping.model.ts';

describe('MeiMappingModelV2', () => {
  const v1Default = {
    formteilContainer: { tag: 'section' },
    zeileContainer: { tag: 'sb' },
    syllable: { tag: 'syllable', textTag: 'syl' },
    neume: { tag: 'neume' },
    note: {
      tag: 'nc',
      pitchAttr: 'pname',
      octaveAttr: 'oct',
      liquescentAttr: 'curve',
      liquescentValue: 'c',
      connectionAttr: 'con',
      connectionGapValue: 'g'
    },
    clef: {
      tag: 'clef',
      shapeAttr: 'shape',
      lineAttr: 'line',
      defaultLine: '1'
    },
    paratextContainer: { tag: 'dir' },
    oriscus: { tag: 'oriscus' },
    quilisma: { tag: 'quilisma' },
    strophicus: { tag: 'strophicus' },
    liquescentElement: { tag: 'liquescent' }
  };

  it('should have all 12 entity keys with non-empty tags in defaultMeiProfile', () => {
    const profile = defaultMeiProfile();
    assert.equal(profile.version, 2);
    assert.deepEqual(profile.skeleton, ['music', 'body', 'mdiv', 'score']);
    assert.equal(profile.emitHeader, true);

    const expectedKeys: MeiEntityKey[] = [
      'formteil', 'zeile', 'paratext', 'syllable', 'syllableText', 'neume',
      'note', 'clef', 'oriscus', 'quilisma', 'strophicus', 'liquescent'
    ];

    expectedKeys.forEach(key => {
      assert.notEqual(profile.entities[key], undefined);
      assert.equal(profile.entities[key].enabled, true);
      assert.ok(profile.entities[key].tag);
      assert.ok((profile.entities[key].tag.length) > 0);
    });
  });

  it('should yield a profile deep-equal to defaultMeiProfile except id and name when migrating exact v1 default', () => {
    const defaultProfile = defaultMeiProfile();
    const migratedProfile = migrateV1MeiMappings(v1Default);

    // Deep equal except id and name
    assert.equal(migratedProfile.version, defaultProfile.version);
    assert.deepEqual(migratedProfile.skeleton, defaultProfile.skeleton);
    assert.equal(migratedProfile.emitHeader, defaultProfile.emitHeader);
    assert.deepEqual(migratedProfile.entities, defaultProfile.entities);
    
    // Check that id and name are indeed different or separate
    assert.equal(migratedProfile.id, 'migrated');
    assert.equal(defaultProfile.id, 'default');
  });

  it('should change only entities.note.tag when migrating a v1 with a renamed note tag', () => {
    const customV1 = {
      ...v1Default,
      note: {
        ...v1Default.note,
        tag: 'custom-nc-tag'
      }
    };

    const defaultProfile = defaultMeiProfile();
    const migratedProfile = migrateV1MeiMappings(customV1);

    // Only note tag changes, everything else in entities remains the same
    assert.equal(migratedProfile.entities.note.tag, 'custom-nc-tag');
    
    // Create copy of default entities, update the note tag and compare
    const expectedEntities = JSON.parse(JSON.stringify(defaultProfile.entities));
    expectedEntities.note.tag = 'custom-nc-tag';
    
    assert.deepEqual(migratedProfile.entities, expectedEntities);
  });
});

describe('upgradeMeiProfile', () => {
  it('replaces the earlier defaults of paratext, clef line and section attributes, and leaves changed settings alone', () => {
    const old = defaultMeiProfile();
    old.entities.paratext = { enabled: false, tag: 'dir', wrappers: [], attributes: [], textFrom: 'text' };
    old.entities.clef.attributes[1] = { name: 'line', source: 'static', value: '1' };
    old.entities.formteil.attributes = [];
    const up = upgradeMeiProfile(old);
    assert.equal(up.entities.paratext.enabled, true);
    assert.equal(up.entities.paratext.tag, 'annot');
    assert.deepEqual(up.entities.clef.attributes[1], { name: 'line', source: 'field', value: 'line' });
    assert.deepEqual(up.entities.formteil.attributes.map(a => a.name), ['label', 'type']);

    const own = defaultMeiProfile();
    own.entities.paratext = { enabled: false, tag: 'rend', wrappers: [], attributes: [] };
    own.entities.clef.attributes[1] = { name: 'line', source: 'static', value: '3' };
    own.entities.formteil.attributes = [{ name: 'n', source: 'field', value: 'uuid' }];
    const kept = upgradeMeiProfile(own);
    assert.equal(kept.entities.paratext.tag, 'rend');
    assert.equal(kept.entities.clef.attributes[1].value, '3');
    assert.equal(kept.entities.formteil.attributes.length, 1);
  });
});
