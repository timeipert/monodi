import { emitMei, defaultMeiProfile, upgradeMeiProfile, MEI_PRESETS } from '@monodi/core/mei';
import type { MeiMappingProfileV2 } from '@monodi/core/mei';
import { FIXTURES } from '../testdata';
import { structureTestDocument, trialDocument } from './mei-structure-testdoc';
import { MEI_OUTPUT_SHA256, MEI_PRESET_GOLDEN_XML } from './mei-structure.golden';

/**
 * The structure of the MEI body is data of the profile (`MeiBodyStructure`, state 2026-11-05). Before that change the profile had a
 * fixed switch `notation` (`neume` or `premensural`). This spec proves that the export did not change with it: the output of the two
 * built-in profiles (and of other profiles that were stored before the change) is compared byte for byte with the output of the emitter
 * at commit 50b6aa1c of monodi-platform (the last commit before the change).
 *
 * `MEI_OUTPUT_SHA256` holds the SHA-256 of that output for every document of `src/app/testdata` plus the two test documents of
 * `mei-structure-testdoc.ts`, each written with every profile of `PROFILES`. `MEI_PRESET_GOLDEN_XML` holds the full output of the test
 * document with both presets, so a reader can see what the presets write. A missing entry is printed as `MEI-GOLDEN <key> <value>` and
 * the spec fails. To change the output on purpose, delete the entries concerned, run this spec, and copy the printed lines into the
 * golden file (`mei-structure.golden.ts`).
 */
const preset = (id: string): MeiMappingProfileV2 => MEI_PRESETS.find(p => p.id === id)!.build();

/** A profile as it was stored before 2026-11-05: without `structure` (the field did not exist). */
const stored = (p: MeiMappingProfileV2): MeiMappingProfileV2 => { delete p.structure; return p; };
/** The editor's Notation menu (before 2026-11-05) wrote `notation` and renamed neume and note. */
const storedPremensural = (): MeiMappingProfileV2 => {
  const p = stored(defaultMeiProfile());
  p.notation = 'premensural';
  p.entities.neume.tag = 'ligature';
  p.entities.note.tag = 'note';
  return p;
};

/**
 * Profiles whose output must not change. `golden`: the key of the profile in the golden file when it differs from the name (a stored
 * profile brought up to date by `upgradeMeiProfile`, which writes `structure` into it, must write what it wrote before).
 */
const PROFILES: Record<string, { build: () => MeiMappingProfileV2; golden?: string }> = {
  'neumes-staves': { build: () => preset('neumes-staves') },
  'premensural-staves': { build: () => preset('premensural-staves') },
  'default': { build: () => stored(defaultMeiProfile()) },
  'default-earlier-structure': { build: () => ({ ...stored(defaultMeiProfile()), schemaConformant: false }) },
  'default-premensural-field': { build: storedPremensural },
  'default-syllable-off': { build: () => { const p = stored(defaultMeiProfile()); p.entities.syllable.enabled = false; return p; } },
  'default-neume-off': { build: () => { const p = stored(defaultMeiProfile()); p.entities.neume.enabled = false; return p; } },
  'neumes-staves-accid-as-note': { build: () => { const p = preset('neumes-staves'); p.accidentals = 'note'; return p; } },
  // the same profiles after the upgrade that the app runs when it loads the settings, and the default profile as made after the change
  'default-upgraded': { build: () => upgradeMeiProfile(stored(defaultMeiProfile())), golden: 'default' },
  'default-as-made': { build: () => defaultMeiProfile(), golden: 'default' },
  'default-premensural-field-upgraded': { build: () => upgradeMeiProfile(storedPremensural()), golden: 'default-premensural-field' }
};

const DOCUMENTS: { name: string; root: () => any }[] = [
  { name: 'structure-test-document', root: structureTestDocument },
  { name: 'trial-document', root: trialDocument },
  ...FIXTURES.map(f => ({ name: f.name, root: () => JSON.parse(JSON.stringify(f.doc)) }))
];

const NOW = new Date('2026-11-05T12:00:00Z');
const emit = (root: any, profile: MeiMappingProfileV2) => emitMei(root, profile, undefined, undefined, { now: NOW });

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

describe('MEI export unchanged by the structure description (output of commit 50b6aa1c)', () => {
  it('every document written with every profile gives the same bytes as before', async () => {
    const missing: string[] = [];
    const differing: string[] = [];
    for (const [profileName, { build, golden }] of Object.entries(PROFILES)) {
      for (const d of DOCUMENTS) {
        const key = `${golden ?? profileName}/${d.name}`;
        const hash = await sha256(emit(d.root(), build()));
        if (!(key in MEI_OUTPUT_SHA256)) { missing.push(key); console.log(`MEI-GOLDEN ${key} ${hash}`); }
        else if (MEI_OUTPUT_SHA256[key] !== hash) differing.push(`${profileName}/${d.name}`);
      }
    }
    expect(missing).toEqual([]);
    expect(differing).toEqual([]);
  });

  for (const id of ['neumes-staves', 'premensural-staves']) {
    it(`the ${id} preset writes the test document as before (full text)`, () => {
      const xml = emit(structureTestDocument(), preset(id));
      if (!(id in MEI_PRESET_GOLDEN_XML)) console.log(`MEI-GOLDEN-XML ${id} ${JSON.stringify(xml)}`);
      expect(xml).toBe(MEI_PRESET_GOLDEN_XML[id]);
    });
  }
});
