import { emitMei } from './mei-emitter';
import { defaultMeiProfile } from './mei-mapping.model';
import { emptyRootContainer } from '../types/model';
import { Document as MonodiDocument, PublicationSettings, Source } from '../api.service';
import { METADATA_MAPPING } from './metadata-mapping.generated';
import { HANDLED, NOT_YET_AVAILABLE } from './mei-header-mapped';
import { CHILD_ORDER, HeaderWriter, parsePath } from './mei-header-writer';
import { HEADER_LEVEL2_GOLDEN } from './mei-header.golden';

describe('MEI header levels', () => {
  const now = new Date('2026-10-24T10:00:00Z');

  const documentMeta: MonodiDocument = {
    id: 'uuid-1', quelle_id: 'q1', dokumenten_id: 'Ex_1-1v-12', gattung1: 'Tropus', gattung2: 'Introitus-Tropus',
    festtag: 'Nativitas', feier: 'Mass', textinitium: 'Hodie', bibliographischerverweis: 'AH 47, 12', druckausgabe: 'Edition 1',
    zeilenstart: '12', foliostart: '1v', kommentar: 'A comment.', editionsstatus: 'ediert', custom: { melody: 'M 7' }
  };
  const sourceMeta = { quellensigle: 'Ex 1', bibliothek: 'Example Library', bibliotheksort: 'Exampletown', bibliothekssignatur: 'Cod. 1', datierung: '13. Jh.' } as Source;
  const publication: PublicationSettings = {
    publisher: 'Example Project', address: ['Street 1', '12345 Town'], funderName: 'Example Academy', seriesTitle: 'Example Series',
    documentBaseUri: 'https://example.org/d/', language: 'en', licenseUri: 'https://creativecommons.org/licenses/by/4.0/', licenseLabel: 'CC BY 4.0',
    contributors: [{ name: 'Given Family', role: 'Project direction', orcid: '0000-0000-0000-0001' }]
  };

  function emit(level: 1 | 2 | 3, withData = true, pub: PublicationSettings | null = publication) {
    const root = emptyRootContainer();
    root.comments = [{ startUUID: 'a', endUUID: 'b', text: 'note', readingWitnesses: ['Wit A'] } as any];
    const profile = defaultMeiProfile();
    profile.headerLevel = level;
    const xml = emitMei(root, profile, withData ? documentMeta : undefined, withData ? 'Ex 1' : undefined, { sourceMeta: withData ? sourceMeta : undefined, publication: pub ?? undefined, now, appVersion: '0.9.1' });
    return new DOMParser().parseFromString(xml, 'application/xml');
  }
  const q = (d: Document, sel: string) => d.querySelector(sel);
  const names = (e: Element | null) => Array.from(e?.children ?? []).map(c => c.localName);

  it('level 1 (default) keeps the baseline header: no publisher, no encodingDesc, sourceDesc before notesStmt', () => {
    const d = emit(1);
    expect(q(d, 'meiHead > fileDesc > pubStmt')!.children.length).toBe(0);
    expect(q(d, 'encodingDesc')).toBeNull();
    expect(names(q(d, 'fileDesc'))).toEqual(['titleStmt', 'pubStmt', 'sourceDesc', 'notesStmt']);
    expect(q(d, 'title')!.textContent).toBe('Ex_1-1v-12');
    expect(Array.from(d.querySelectorAll('term')).map(t => t.getAttribute('type'))).toEqual(['gattung1', 'gattung2', 'festtag', 'feier']);
  });

  it('a profile without headerLevel behaves as level 1', () => {
    const root = emptyRootContainer();
    const a = emitMei(root, defaultMeiProfile(), documentMeta, 'Ex 1', { publication, now });
    const profile = defaultMeiProfile();
    profile.headerLevel = 1;
    expect(emitMei(root, profile, documentMeta, 'Ex 1', { publication, now })).toBe(a);
  });

  it('level 2 writes publisher, licence, source, folio and encoding in schema order', () => {
    const d = emit(2);
    expect(names(q(d, 'meiHead'))).toEqual(['fileDesc', 'encodingDesc', 'workList', 'manifestationList', 'revisionDesc']);
    expect(names(q(d, 'fileDesc'))).toEqual(['titleStmt', 'editionStmt', 'pubStmt', 'seriesStmt', 'notesStmt', 'sourceDesc']);
    expect(q(d, 'meiHead')!.getAttribute('xml:lang')).toBe('en');
    expect(q(d, 'pubStmt corpName')!.textContent).toBe('Example Project');
    expect(q(d, 'pubStmt useRestrict')!.getAttribute('auth.uri')).toBe('https://creativecommons.org/licenses/by/4.0/');
    expect(q(d, 'pubStmt date')!.getAttribute('isodate')).toBe('2026-10-24');
    expect(q(d, 'pubStmt > identifier')!.textContent).toBe('https://example.org/d/uuid-1');
    expect(q(d, 'seriesStmt title')!.textContent).toBe('Example Series');
    expect(q(d, 'seriesStmt respStmt resp')!.textContent).toBe('Project direction');
    expect(q(d, 'editionStmt edition')!.textContent).toBe('ediert');
    expect(q(d, 'work > identifier')!.textContent).toBe('Ex_1-1v-12');
    expect(q(d, 'locus')!.getAttribute('from')).toBe('1v');
    expect(q(d, 'locus')!.textContent).toBe('f. 1v, l. 12');
    expect(Array.from(d.querySelectorAll('term[type="genre"]')).map(t => t.textContent)).toEqual(['Tropus', 'Introitus-Tropus']);
    expect(q(d, 'term[type="melody"]')!.textContent).toBe('M 7');
    expect(Array.from(d.querySelectorAll('biblList > bibl')).map(b => b.getAttribute('type'))).toEqual([null, 'printed-edition']);
    expect(q(d, 'item > identifier')!.textContent).toBe('Cod. 1');
    expect(q(d, 'repository corpName')!.textContent).toBe('Example Library, Exampletown');
    expect(q(d, 'application')!.getAttribute('version')).toBe('0.9.1');
    expect(q(d, 'revisionDesc change')!.getAttribute('isodate')).toBe('2026-10-24');
    expect(d.querySelectorAll('sourceDesc > source').length).toBe(2);   // own source and the witness "Wit A"
    expect(q(d, 'sourceDesc > source')!.getAttribute('xml:id')).toBe('wit-ex-1');
  });

  it('level 2 equals the golden header, which is validated against the bundled MEI 5.0 schema (npm run check:mei-header)', () => {
    const normalize = (x: string) => x.replace(/>\s+</g, '><').trim();
    const head = new XMLSerializer().serializeToString(emit(2).querySelector('meiHead')!);
    expect(normalize(head)).toBe(normalize(HEADER_LEVEL2_GOLDEN));
  });

  it('level 2 keeps the critical comments of the baseline', () => {
    const d = emit(2);
    // The document comment and the critical comment; no draft marker because a licence is set.
    expect(d.querySelectorAll('notesStmt > annot').length).toBe(2);
    expect(q(d, 'notesStmt > annot[type="document"]')!.textContent).toBe('A comment.');
  });

  it('ORCID of a contributor appears only from level 3', () => {
    expect(q(emit(2), 'seriesStmt persName')!.hasAttribute('codedval')).toBeFalse();
    expect(q(emit(3), 'seriesStmt persName')!.getAttribute('codedval')).toBe('0000-0000-0000-0001');
  });

  it('without a licence the export is marked as a draft (rule 3)', () => {
    const d = emit(2, true, { ...publication, licenseUri: '', licenseLabel: '' });
    expect(q(d, 'annot[type="status"]')!.textContent).toContain('Draft: not for publication');
    expect(q(emit(2), 'annot[type="status"]')).toBeNull();
  });

  it('missing data produces no empty elements and still a valid skeleton', () => {
    const d = emit(2, false, null);
    expect(q(d, 'fileDesc > titleStmt > title')!.textContent).toBe('Exported from Monodi+');
    expect(q(d, 'fileDesc > pubStmt')).not.toBeNull();
    ['seriesStmt', 'workList', 'manifestationList', 'editionStmt', 'encodingDesc > appInfo > application > version'].forEach(sel => {
      expect(q(d, sel)).toBeNull();
    });
    Array.from(d.querySelectorAll('meiHead *')).forEach(e => {
      const empty = e.children.length === 0 && !(e.textContent ?? '').trim() && e.attributes.length === 0;
      expect(empty).toBeFalse();
    });
  });

  it('never writes an e-mail address from the contributor list', () => {
    const d = emit(3, true, { ...publication, contributors: [{ name: 'Given Family', role: 'Editor' }] });
    expect(new XMLSerializer().serializeToString(d)).not.toContain('@');
  });
});

describe('MEI header mapping coverage', () => {
  it('every mapping entry with an MEI target has a handler or a documented reason', () => {
    const unknown = METADATA_MAPPING.entries.map(e => e.id).filter(id => !HANDLED.includes(id) && !(id in NOT_YET_AVAILABLE));
    expect(unknown).toEqual([]);
  });

  it('handlers and reasons refer to existing entries only', () => {
    const ids = METADATA_MAPPING.entries.map(e => e.id);
    expect(HANDLED.filter(id => !ids.includes(id))).toEqual([]);
    expect(Object.keys(NOT_YET_AVAILABLE).filter(id => !ids.includes(id))).toEqual([]);
  });

  it('every MEI path of the mapping can be parsed and expanded', () => {
    const w = new HeaderWriter(document.implementation.createDocument('http://www.music-encoding.org/ns/mei', 'mei', null), 'meiHead', METADATA_MAPPING.aliases);
    METADATA_MAPPING.entries.forEach(e => e.targets.forEach(t => {
      expect(() => parsePath(w.expand(t.path).replace('[@type]', "[@type='x']"))).not.toThrow();
    }));
  });

  it('the schema order table names only MEI header parents', () => {
    expect(Object.keys(CHILD_ORDER)).toContain('fileDesc');
  });
});
