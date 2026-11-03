import { validateMeiProfile } from './mei-validation';
import { defaultMeiProfile, MeiMappingProfileV2 } from '@monodi/core/mei';

describe('MeiMapping Editor Validation', () => {
  let profile: MeiMappingProfileV2;

  beforeEach(() => {
    // Clone the default profile for mutation in tests
    profile = JSON.parse(JSON.stringify(defaultMeiProfile()));
  });

  it('1. REGRESSION TEST: validating defaultMeiProfile() yields ZERO warnings and zero errors', () => {
    const errors = validateMeiProfile(profile);
    expect(errors.length).toBe(0);
  });

  it('2. Empty tag on an enabled entity yields exactly one warning naming that entity', () => {
    profile.entities.note.tag = '   ';
    profile.entities.note.enabled = true;
    const errors = validateMeiProfile(profile);
    expect(errors.length).toBe(1);
    expect(errors[0].entity).toBe('note');
    expect(errors[0].isError).toBe(false);
  });

  it('3. Duplicate attribute name within one rule yields a warning', () => {
    profile.entities.syllable.attributes.push({ name: 'xml:id', source: 'static', value: 'duplicate' });
    profile.entities.syllable.attributes.push({ name: 'xml:id', source: 'static', value: 'duplicate2' });
    const errors = validateMeiProfile(profile);
    expect(errors.length).toBe(1);
    expect(errors[0].entity).toBe('syllable');
    expect(errors[0].message).toContain('Duplicate attribute "xml:id"');
  });

  it('4. source field with a key not in ENTITY_FIELDS for that entity yields a warning', () => {
    // 'base' is valid for 'note', but not for 'syllable'
    profile.entities.syllable.attributes.push({ name: 'fake', source: 'field', value: 'base' });
    const errors1 = validateMeiProfile(profile);
    expect(errors1.length).toBe(1);
    expect(errors1[0].entity).toBe('syllable');
    expect(errors1[0].message).toContain('references invalid data field "base"');

    // Test that the same field on 'note' produces no warning
    profile = JSON.parse(JSON.stringify(defaultMeiProfile()));
    profile.entities.note.attributes.push({ name: 'fake', source: 'field', value: 'base' });
    const errors2 = validateMeiProfile(profile);
    expect(errors2.length).toBe(0);
  });

  it('5. Disabled entity with an empty tag yields NO warning', () => {
    profile.entities.note.tag = '';
    profile.entities.note.enabled = false;
    const errors = validateMeiProfile(profile);
    expect(errors.length).toBe(0);
  });

  it('6. Empty skeleton array yields a warning', () => {
    profile.skeleton = [];
    const errors = validateMeiProfile(profile);
    expect(errors.length).toBe(1);
    expect(errors[0].entity).toBe('skeleton');
    expect(errors[0].isError).toBe(false);
  });
});
