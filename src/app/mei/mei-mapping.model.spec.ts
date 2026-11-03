import { 
  defaultMeiProfile, 
  migrateV1MeiMappings, 
  MeiEntityKey, upgradeMeiProfile } from './mei-mapping.model';

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
    expect(profile.version).toBe(2);
    expect(profile.skeleton).toEqual(['music', 'body', 'mdiv', 'score']);
    expect(profile.emitHeader).toBe(true);

    const expectedKeys: MeiEntityKey[] = [
      'formteil', 'zeile', 'paratext', 'syllable', 'syllableText', 'neume',
      'note', 'clef', 'oriscus', 'quilisma', 'strophicus', 'liquescent'
    ];

    expectedKeys.forEach(key => {
      expect(profile.entities[key]).toBeDefined();
      expect(profile.entities[key].enabled).toBe(true);
      expect(profile.entities[key].tag).toBeTruthy();
      expect(profile.entities[key].tag.length).toBeGreaterThan(0);
    });
  });

  it('should yield a profile deep-equal to defaultMeiProfile except id and name when migrating exact v1 default', () => {
    const defaultProfile = defaultMeiProfile();
    const migratedProfile = migrateV1MeiMappings(v1Default);

    // Deep equal except id and name
    expect(migratedProfile.version).toBe(defaultProfile.version);
    expect(migratedProfile.skeleton).toEqual(defaultProfile.skeleton);
    expect(migratedProfile.emitHeader).toBe(defaultProfile.emitHeader);
    expect(migratedProfile.entities).toEqual(defaultProfile.entities);
    
    // Check that id and name are indeed different or separate
    expect(migratedProfile.id).toBe('migrated');
    expect(defaultProfile.id).toBe('default');
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
    expect(migratedProfile.entities.note.tag).toBe('custom-nc-tag');
    
    // Create copy of default entities, update the note tag and compare
    const expectedEntities = JSON.parse(JSON.stringify(defaultProfile.entities));
    expectedEntities.note.tag = 'custom-nc-tag';
    
    expect(migratedProfile.entities).toEqual(expectedEntities);
  });
});

describe('upgradeMeiProfile', () => {
  it('replaces the earlier defaults of paratext, clef line and section attributes, and leaves changed settings alone', () => {
    const old = defaultMeiProfile();
    old.entities.paratext = { enabled: false, tag: 'dir', wrappers: [], attributes: [], textFrom: 'text' };
    old.entities.clef.attributes[1] = { name: 'line', source: 'static', value: '1' };
    old.entities.formteil.attributes = [];
    const up = upgradeMeiProfile(old);
    expect(up.entities.paratext.enabled).toBe(true);
    expect(up.entities.paratext.tag).toBe('annot');
    expect(up.entities.clef.attributes[1]).toEqual({ name: 'line', source: 'field', value: 'line' });
    expect(up.entities.formteil.attributes.map(a => a.name)).toEqual(['label', 'type']);

    const own = defaultMeiProfile();
    own.entities.paratext = { enabled: false, tag: 'rend', wrappers: [], attributes: [] };
    own.entities.clef.attributes[1] = { name: 'line', source: 'static', value: '3' };
    own.entities.formteil.attributes = [{ name: 'n', source: 'field', value: 'uuid' }];
    const kept = upgradeMeiProfile(own);
    expect(kept.entities.paratext.tag).toBe('rend');
    expect(kept.entities.clef.attributes[1].value).toBe('3');
    expect(kept.entities.formteil.attributes.length).toBe(1);
  });
});
