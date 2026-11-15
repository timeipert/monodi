import { TestBed } from '@angular/core/testing';
import * as localforage from 'localforage';
import {
  loadCatalog, makeContext, planCantusImport, planCmImport, sha256Hex,
} from '@monodi/core/datasets';
import { MAX_DOCUMENTS_PER_IMPORT } from '@monodi/core/datasets';
import type { CantusSource, CmDocument, CmSource, FetchContext, LoadedCatalog } from '@monodi/core/datasets';
import { APIService } from './api.service';
import type { Document, Source } from './api.service';
import { NotesStore } from './notes-store';
import { PushCache } from './push-cache';
import { SYNC_EXCLUDED_KEY, SyncExclusions } from './sync-exclusions';
import { IMPORT_MANIFEST_KEY, RepositoryImportService } from './repository-import.service';

/** A repository served from memory: one Corpus Monodicum source with two chants and one Cantus source with three. */
class Repo {
  files = new Map<string, string>();
  /** Called with every address that is fetched, before the answer (a test uses it to change the workspace mid-import). */
  onFetch: ((url: string) => Promise<void>) | null = null;

  async put(url: string, content: unknown): Promise<{ bytes: number; sha256: string }> {
    const text = typeof content === 'string' ? content : JSON.stringify(content);
    this.files.set(url, text);
    const data = new TextEncoder().encode(text);
    return { bytes: data.byteLength, sha256: await sha256Hex(data.buffer.slice(0) as ArrayBuffer) };
  }

  context(): FetchContext {
    return makeContext({
      retries: 0,
      sleep: async () => {},
      fetch: (async (input: RequestInfo | URL) => {
        await this.onFetch?.(String(input));
        const text = this.files.get(String(input));
        return text === undefined ? new Response('missing', { status: 404 }) : new Response(text, { status: 200 });
      }) as typeof fetch,
    });
  }
}

const REPO = 'https://example.test/repo/';
const UPSTREAM = 'https://example.test/upstream/abc/';
const ROOT = (uuid: string) => ({ kind: 'RootContainer', uuid, children: [], comments: [], documentType: 'Level1' });
const CHANT_COLUMNS = ['cantus_id', 'folio', 'position', 'genre', 'office', 'feast', 'feast_code', 'mode', 'incipit',
  'full_text', 'volpiano', 'ref', 'image', 'db'];

function chantRow(ref: string, volpiano: string, fullText = 'Omnibus se invocantibus'): string[] {
  const values: Record<string, string> = {
    cantus_id: '004141', folio: '215r', position: '2.6', genre: 'A', office: 'M', feast: 'Nicolai', feast_code: '1',
    mode: '4', incipit: 'Omnibus se', full_text: fullText, volpiano, ref, image: '', db: 'CD',
  };
  return CHANT_COLUMNS.map((c) => values[c]);
}

async function buildRepo(): Promise<{ repo: Repo; catalog: LoadedCatalog; cm: any; cantus: any; cmDocs: CmDocument[]; cmSource: CmSource; cantusSource: CantusSource }> {
  const repo = new Repo();
  // Corpus Monodicum
  const sourceMeta = { id: 'A 1', quellensigle: 'A 1', bibliothek: 'Domarchiv', datierung: '12. Jh', jahrhundert: '12.', publish: 'all' };
  const sMeta = await repo.put(`${UPSTREAM}sources/A_1/A_1.meta.json`, sourceMeta);
  const docs: CmDocument[] = [];
  for (const n of [1, 2]) {
    const dir = `A_1-${n}`;
    const meta = await repo.put(`${UPSTREAM}sources/A_1/documents/${dir}/${dir}.meta.json`, {
      id: `uuid-${n}`, quelle_id: 'A 1', dokumenten_id: `A 1-${n}`, gattung1: n === 1 ? 'Tropus' : 'Sequenz', festtag: 'Nat',
      textinitium: `Incipit ${n}`, foliostart: `${n}r`, additionalData: { Editor: 'Ed' }, publish: 'all',
    });
    const notes = await repo.put(`${UPSTREAM}sources/A_1/documents/${dir}/${dir}.notes.json`, ROOT(`root-${n}`));
    docs.push({
      id: `uuid-${n}`, dokumenten_id: `A 1-${n}`, quelle_id: 'A 1', source: 'A_1', dir, gattung1: n === 1 ? 'Tropus' : 'Sequenz',
      gattung2: '', festtag: 'Nat', feier: '', textinitium: `Incipit ${n}`, foliostart: `${n}r`, notes_bytes: notes.bytes,
      meta_bytes: meta.bytes, notes_sha256: notes.sha256, meta_sha256: meta.sha256,
    });
  }
  const cmSource: CmSource = {
    id: 'A_1', quellensigle: 'A 1', bibliothek: 'Domarchiv', bibliotheksort: 'Aachen', bibliothekssignatur: '', datierung: '12. Jh',
    jahrhundert: '12.', herkunftsregion: '', herkunftsort: '', herkunftsinstitution: '', ordenstradition: '', quellentyp: '',
    status: '', editors: '', documents: 2, bytes: 0, meta_bytes: sMeta.bytes, meta_sha256: sMeta.sha256,
  };
  const cmDataset = {
    layout_version: 1, id: 'cm', kind: 'transcriptions', title: 'CM', description: 'd', upstream: { ref: 'abc' }, base: UPSTREAM,
    licence: { spdx: 'CC-BY-NC-4.0' }, counts: {},
    file_templates: {
      source_meta: 'sources/{source}/{source}.meta.json',
      document_meta: 'sources/{source}/documents/{dir}/{dir}.meta.json',
      document_notes: 'sources/{source}/documents/{dir}/{dir}.notes.json',
    },
    indexes: {
      sources: { path: 'sources.json', ...(await repo.put(`${REPO}cm/sources.json`, [cmSource])) },
      documents: {
        path: 'documents.json',
        ...(await repo.put(`${REPO}cm/documents.json`, {
          columns: Object.keys(docs[0]),
          rows: docs.map((d) => Object.values(d)),
        })),
      },
    },
  };
  const cmEntry = await repo.put(`${REPO}cm/dataset.json`, cmDataset);

  // Cantus Corpus: three chants, one with a melody
  const chunk = { source: 'cantusdatabase-1', part: 1, parts: 1, columns: CHANT_COLUMNS, rows: [
    chantRow('10', '1---f--g--h---f'), chantRow('11', ''), chantRow('12', '', 'Hodie nobis'),
  ] };
  const file = await repo.put(`${REPO}cantus/sources/cantusdatabase-1/chants-0001.json`, chunk);
  const cantusSource: CantusSource = {
    id: 'cantusdatabase-1', title: 'Graz 29', siglum: 'A-Gu 29', century: '14th century', num_century: '14', provenance: 'St-Lambrecht',
    cursus: 'Monastic', dbs: ['CD'], host: 'cantusdatabase.org', srclink: 'https://cantusdatabase.org/source/1', chant_path: 'chant',
    chant_sigla: ['A-Gu 29'], n_chants: 3, n_with_melody: 1, bytes: file.bytes,
    files: [{ path: 'sources/cantusdatabase-1/chants-0001.json', ...file }],
  };
  const cantusDataset = {
    layout_version: 1, id: 'cantus', kind: 'catalogue', title: 'Cantus', description: 'd', upstream: { release: 'v1.0' }, base: './',
    licence: { spdx: 'CC-BY-NC-SA-4.0' }, counts: {}, chant_columns: CHANT_COLUMNS,
    chant_url_template: 'https://{host}/{chant_path}/{ref}',
    indexes: { sources: { path: 'sources.json', ...(await repo.put(`${REPO}cantus/sources.json`, [cantusSource])) } },
  };
  const cantusEntry = await repo.put(`${REPO}cantus/dataset.json`, cantusDataset);

  await repo.put(`${REPO}catalog.json`, {
    layout_version: 1, title: 'T', datasets: [
      { id: 'cm', kind: 'transcriptions', title: 'CM', description: 'd', path: 'cm/dataset.json', ...cmEntry, licence: { spdx: 'x' }, upstream: {}, counts: {} },
      { id: 'cantus', kind: 'catalogue', title: 'Cantus', description: 'd', path: 'cantus/dataset.json', ...cantusEntry, licence: { spdx: 'x' }, upstream: {}, counts: {} },
    ],
  });
  const catalog = await loadCatalog(`${REPO}catalog.json`, repo.context());
  return { repo, catalog, cm: cmEntry, cantus: cantusEntry, cmDocs: docs, cmSource, cantusSource };
}

/** A Corpus Monodicum dataset of one source with `n` small chants, for the tests of the transfer. */
async function buildManyChants(n: number): Promise<{ repo: Repo; catalog: LoadedCatalog }> {
  const repo = new Repo();
  const sMeta = await repo.put(`${UPSTREAM}sources/M_1/M_1.meta.json`, { id: 'M 1', quellensigle: 'M 1', publish: 'all' });
  const docs: CmDocument[] = [];
  for (let i = 0; i < n; i++) {
    const dir = `M_1-${i}`;
    const meta = await repo.put(`${UPSTREAM}sources/M_1/documents/${dir}/${dir}.meta.json`, { id: `m-${i}`, quelle_id: 'M 1', dokumenten_id: `M 1-${i}`, publish: 'all' });
    const notes = await repo.put(`${UPSTREAM}sources/M_1/documents/${dir}/${dir}.notes.json`, ROOT(`r-${i}`));
    docs.push({
      id: `m-${i}`, dokumenten_id: `M 1-${i}`, quelle_id: 'M 1', source: 'M_1', dir, gattung1: '', gattung2: '', festtag: '', feier: '',
      textinitium: '', foliostart: '', notes_bytes: notes.bytes, meta_bytes: meta.bytes, notes_sha256: notes.sha256, meta_sha256: meta.sha256,
    });
  }
  const source = {
    id: 'M_1', quellensigle: 'M 1', bibliothek: '', bibliotheksort: '', bibliothekssignatur: '', datierung: '', jahrhundert: '',
    herkunftsregion: '', herkunftsort: '', herkunftsinstitution: '', ordenstradition: '', quellentyp: '', status: '', editors: '',
    documents: n, bytes: 0, meta_bytes: sMeta.bytes, meta_sha256: sMeta.sha256,
  };
  const dataset = {
    layout_version: 1, id: 'cm', kind: 'transcriptions', title: 'CM', description: 'd', upstream: { ref: 'abc' }, base: UPSTREAM,
    licence: { spdx: 'x' }, counts: {},
    file_templates: {
      source_meta: 'sources/{source}/{source}.meta.json',
      document_meta: 'sources/{source}/documents/{dir}/{dir}.meta.json',
      document_notes: 'sources/{source}/documents/{dir}/{dir}.notes.json',
    },
    indexes: {
      sources: { path: 'sources.json', ...(await repo.put(`${REPO}cm/sources.json`, [source])) },
      documents: { path: 'documents.json', ...(await repo.put(`${REPO}cm/documents.json`, { columns: Object.keys(docs[0]), rows: docs.map((d) => Object.values(d)) })) },
    },
  };
  const entry = await repo.put(`${REPO}cm/dataset.json`, dataset);
  await repo.put(`${REPO}catalog.json`, {
    layout_version: 1, datasets: [{ id: 'cm', kind: 'transcriptions', title: 'CM', description: 'd', path: 'cm/dataset.json', ...entry, licence: { spdx: 'x' }, upstream: {}, counts: {} }],
  });
  return { repo, catalog: await loadCatalog(`${REPO}catalog.json`, repo.context()) };
}

describe('RepositoryImportService', () => {
  let service: RepositoryImportService;
  let world: Awaited<ReturnType<typeof buildRepo>>;

  const storedSources = async () => (await localforage.getItem<Source[]>('monodi_sources')) || [];
  const storedDocuments = async () => (await localforage.getItem<Document[]>('monodi_documents')) || [];

  async function clearWorkspace() {
    await NotesStore.ensureMigrated();
    await NotesStore.removeMany(await NotesStore.getIndex());
    for (const key of ['monodi_sources', 'monodi_documents', IMPORT_MANIFEST_KEY, SYNC_EXCLUDED_KEY]) await localforage.removeItem(key);
  }

  beforeEach(async () => {
    TestBed.configureTestingModule({ providers: [APIService, RepositoryImportService] });
    service = TestBed.inject(RepositoryImportService);
    await clearWorkspace();
    world = await buildRepo();
    spyOn(service, 'context').and.callFake(() => world.repo.context());
  });

  afterEach(clearWorkspace);

  async function importCm(overwrite = false) {
    const dataset = await service.openDataset(world.catalog, world.catalog.catalog.datasets[0]);
    const index = await service.openCmIndex(dataset);
    const plan = planCmImport(index, new Set(['A_1']));
    return { dataset, index, summary: await service.importCm(dataset, index, plan, { overwrite }) };
  }

  it('imports a Corpus Monodicum source with its chants and notes and records the import', async () => {
    const { summary } = await importCm();
    expect(summary).toEqual({ sources: 1, documents: 2, keptExisting: 0, conversionWarnings: 0 });
    const sources = await storedSources();
    expect(sources.map((s) => s.id)).toEqual(['A 1']);
    expect(sources[0].bibliothek).toBe('Domarchiv');
    const documents = await storedDocuments();
    expect(documents.map((d) => d.id).sort()).toEqual(['uuid-1', 'uuid-2']);
    expect(documents[0].quelle_id).toBe('A 1');
    expect(documents[0].custom?.['Editor']).toBe('Ed');
    expect((await NotesStore.get('uuid-1')).uuid).toBe('root-1');
    // the link back to the page of the chant, for comparing the copy with the original
    expect(documents.find((d) => d.id === 'uuid-1')!.kommentar).toContain('Original page on corpus-monodicum.de: https://corpus-monodicum.de/d/');
    expect(documents.find((d) => d.id === 'uuid-1')!.custom?.['original_url']).toMatch(/^https:\/\/corpus-monodicum\.de\/d\//);
    const manifest = await service.getManifest();
    expect(manifest.records.length).toBe(1);
    expect(manifest.records[0].documentIds.sort()).toEqual(['uuid-1', 'uuid-2']);
    expect(manifest.records[0].upstreamRef).toBe('abc');
  });

  it('gives the documents of earlier imports the link to the original page, keeps their comments and does it only once', async () => {
    await importCm();
    const dataset = await service.openDataset(world.catalog, world.catalog.catalog.datasets[1]);
    const sources = await service.openCantusIndex(dataset);
    await service.importCantus(dataset, planCantusImport(sources, 'with-melody'), 'with-melody', { overwrite: false, alignText: false });
    // documents as an import before the link existed wrote them: no link, a comment that a person wrote
    const before = (await storedDocuments()).map((d) => {
      const custom = { ...(d.custom ?? {}) };
      delete custom['original_url'];
      return { ...d, kommentar: d.id === 'uuid-1' ? 'Folio damaged.' : '', custom };
    });
    await localforage.setItem('monodi_documents', before);

    expect(await service.addOriginalLinks()).toBe(before.length);
    const after = await storedDocuments();
    const cm = after.find((d) => d.id === 'uuid-1')!;
    expect(cm.kommentar).toBe('Folio damaged.\n\nOriginal page on corpus-monodicum.de: https://corpus-monodicum.de/d/uuid-1');
    expect(cm.custom?.['original_url']).toBe('https://corpus-monodicum.de/d/uuid-1');
    const cantus = after.find((d) => d.quelle_id === 'cantusdatabase-1')!;
    expect(cantus.kommentar).toBe('Original record in the Cantus Database: https://cantusdatabase.org/chant/10');
    expect(await service.addOriginalLinks()).toBe(0);
  });

  it('adds the link only to documents that an import wrote', async () => {
    await importCm();
    await localforage.setItem('monodi_documents', [...(await storedDocuments()), { id: 'mine', quelle_id: 'A 1', dokumenten_id: 'mine', kommentar: '' } as Document]);
    await service.addOriginalLinks();
    const mine = (await storedDocuments()).find((d) => d.id === 'mine')!;
    expect(mine.kommentar).toBe('');
    expect(mine.custom?.['original_url']).toBeUndefined();
  });

  it('leaves a chant that exists already as it is, unless told to replace it', async () => {
    await localforage.setItem('monodi_documents', [{ id: 'uuid-1', quelle_id: 'A 1', dokumenten_id: 'mine', textinitium: 'edited' } as Document]);
    await NotesStore.set('uuid-1', { edited: true });
    const fetched: string[] = [];
    world.repo.onFetch = async (url) => { fetched.push(url); };
    const first = await importCm(false);
    // the files of the chant that is kept are not even downloaded
    expect(fetched.some((u) => u.includes('A_1-1'))).toBeFalse();
    expect(fetched.some((u) => u.includes('A_1-2'))).toBeTrue();
    world.repo.onFetch = null;
    expect(first.summary.keptExisting).toBe(1);
    expect(first.summary.documents).toBe(1);
    expect((await NotesStore.get('uuid-1')).edited).toBeTrue();
    expect((await storedDocuments()).find((d) => d.id === 'uuid-1')!.dokumenten_id).toBe('mine');

    const second = await importCm(true);
    expect(second.summary.keptExisting).toBe(0);
    expect((await NotesStore.get('uuid-1')).uuid).toBe('root-1');
    expect((await storedDocuments()).find((d) => d.id === 'uuid-1')!.dokumenten_id).toBe('A 1-1');
  });

  it('does not overwrite a chant that a person adds while the import runs', async () => {
    let added = false;
    world.repo.onFetch = async (url) => {
      if (added || !url.endsWith('.notes.json')) return;
      added = true;
      // another part of the app stores a new document in the middle of the import
      await localforage.setItem('monodi_documents', [{ id: 'made-meanwhile', quelle_id: 'Mine', dokumenten_id: 'mm' } as Document]);
    };
    await importCm();
    const ids = (await storedDocuments()).map((d) => d.id).sort();
    expect(ids).toEqual(['made-meanwhile', 'uuid-1', 'uuid-2']);
  });

  it('keeps the metadata of a source that exists already, unless told to replace it', async () => {
    await localforage.setItem('monodi_sources', [{ id: 'A 1', quellensigle: 'A 1', bibliothek: 'My library' } as Source]);
    await importCm(false);
    expect((await storedSources())[0].bibliothek).toBe('My library');
    await importCm(true);
    expect((await storedSources())[0].bibliothek).toBe('Domarchiv');
    expect((await storedSources()).length).toBe(1);
  });

  it('refuses an import of more chants than one import takes, before it writes anything', async () => {
    const dataset = await service.openDataset(world.catalog, world.catalog.catalog.datasets[0]);
    const index = await service.openCmIndex(dataset);
    const plan = planCmImport(index, new Set(['A_1']));
    const tooMany = { ...plan, documents: new Array(MAX_DOCUMENTS_PER_IMPORT + 1).fill(plan.documents[0]) };
    await expectAsync(service.importCm(dataset, index, tooMany, { overwrite: false })).toBeRejectedWithError(/more than one import takes/);
    expect((await storedSources()).length).toBe(0);
  });

  it('fetches many chants at once, in order, and stores all of them', async () => {
    const many = await buildManyChants(120);
    world = { ...world, repo: many.repo, catalog: many.catalog };
    let inFlight = 0;
    let peak = 0;
    many.repo.onFetch = async () => {
      inFlight++; peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 4));
      inFlight--;
    };
    const dataset = await service.openDataset(many.catalog, many.catalog.catalog.datasets[0]);
    const index = await service.openCmIndex(dataset);
    const seen: number[] = [];
    const summary = await service.importCm(dataset, index, planCmImport(index, new Set(['M_1'])), {
      overwrite: false, onProgress: (p) => seen.push(p.bytesDone),
    });
    expect(summary.documents).toBe(120);
    expect((await storedDocuments()).length).toBe(120);
    expect((await NotesStore.getIndex()).length).toBe(120);
    expect(peak).toBeGreaterThan(24);   // the old code asked for 16 files at a time
    expect(peak).toBeLessThanOrEqual(49);  // 24 chants of two files each, and the source file
    expect(seen).toEqual([...seen].sort((a, b) => a - b)); // the progress never goes back
  });

  it('stops fetching ahead when the import fails', async () => {
    const many = await buildManyChants(60);
    world = { ...world, repo: many.repo, catalog: many.catalog };
    many.repo.files.set(`${UPSTREAM}sources/M_1/documents/M_1-3/M_1-3.notes.json`, JSON.stringify(ROOT('tampered')));
    let requests = 0;
    many.repo.onFetch = async () => { requests++; await new Promise((resolve) => setTimeout(resolve, 3)); };
    const dataset = await service.openDataset(many.catalog, many.catalog.catalog.datasets[0]);
    const index = await service.openCmIndex(dataset);
    await expectAsync(service.importCm(dataset, index, planCmImport(index, new Set(['M_1'])), { overwrite: false }))
      .toBeRejectedWithError(/checksum|SHA-256|bytes/);
    const after = requests;
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(requests).toBe(after);        // nothing is fetched after the error
    expect(after).toBeLessThan(121);      // and not all 120 files were fetched
    expect((await storedSources()).length).toBe(0);
  });

  it('applies the chant filter of the plan', async () => {
    const dataset = await service.openDataset(world.catalog, world.catalog.catalog.datasets[0]);
    const index = await service.openCmIndex(dataset);
    const plan = planCmImport(index, new Set(['A_1']), { genres: ['Sequenz'] });
    const summary = await service.importCm(dataset, index, plan, { overwrite: false });
    expect(summary.documents).toBe(1);
    expect((await storedDocuments()).map((d) => d.id)).toEqual(['uuid-2']);
  });

  it('stops at a file that does not match its checksum and leaves no empty source behind', async () => {
    const url = `${UPSTREAM}sources/A_1/documents/A_1-2/A_1-2.notes.json`;
    world.repo.files.set(url, JSON.stringify(ROOT('tampered')));
    await expectAsync(importCm()).toBeRejectedWithError(/checksum|SHA-256|bytes/);
    expect((await storedDocuments()).length).toBe(0);
    expect((await storedSources()).length).toBe(0);
    expect((await service.getManifest()).records.length).toBe(0);
  });

  it('reports a source that changed in the repository since the import', async () => {
    const { dataset, index } = await importCm();
    expect((await service.outdatedCmRecords(dataset, index)).length).toBe(0);
    const changed = { ...index, documents: index.documents.map((d) => ({ ...d, notes_sha256: 'f'.repeat(64) })) };
    expect((await service.outdatedCmRecords(dataset, changed)).map((r) => r.sourceId)).toEqual(['A_1']);
  });

  it('imports the Cantus chants with a melody as notes', async () => {
    const dataset = await service.openDataset(world.catalog, world.catalog.catalog.datasets[1]);
    const sources = await service.openCantusIndex(dataset);
    const plan = planCantusImport(sources, 'with-melody');
    const summary = await service.importCantus(dataset, plan, 'with-melody', { overwrite: false, alignText: false });
    expect(summary.documents).toBe(1);
    const documents = await storedDocuments();
    expect(documents.length).toBe(1);
    expect(documents[0].quelle_id).toBe('cantusdatabase-1');
    expect(documents[0].festtag).toBe('Nicolai');
    expect(documents[0].custom?.['cantus_chant']).toBe('https://cantusdatabase.org/chant/10');
    expect(documents[0].kommentar).toBe('Original record in the Cantus Database: https://cantusdatabase.org/chant/10');
    const notes = await NotesStore.get(documents[0].id);
    expect(JSON.stringify(notes)).toContain('"noteType"');
    const source = (await storedSources())[0];
    expect(source.quellensigle).toBe('A-Gu 29');
  });

  it('imports the Cantus chants without a melody as documents that hold the text in syllables', async () => {
    const dataset = await service.openDataset(world.catalog, world.catalog.catalog.datasets[1]);
    const sources = await service.openCantusIndex(dataset);
    const summary = await service.importCantus(dataset, planCantusImport(sources, 'without-melody'), 'without-melody',
      { overwrite: false, alignText: false });
    expect(summary.documents).toBe(2);
    const documents = await storedDocuments();
    const notes = await NotesStore.get(documents.find((d) => d.custom?.['full_text'] === 'Hodie nobis')!.id);
    const text = JSON.stringify(notes);
    expect(text).toContain('"WithoutNotes"');
    expect(text).toContain('Ho-');
    // the placeholder note of an empty syllable is a Normal note; no syllable of the document is of type Normal
    expect(text).not.toContain('"syllableType":"Normal"');
  });

  it('removes an import: its chants, notes and source, but not what a person added to the source', async () => {
    const { summary } = await importCm();
    expect(summary.documents).toBe(2);
    await localforage.setItem('monodi_documents', [...(await storedDocuments()), { id: 'mine', quelle_id: 'A 1', dokumenten_id: 'mine' } as Document]);
    await NotesStore.set('mine', { own: true });
    const record = (await service.getManifest()).records[0];
    const result = await service.removeImport(record);
    expect(result).toEqual({ documents: 2, sourceRemoved: false });
    expect((await storedDocuments()).map((d) => d.id)).toEqual(['mine']);
    expect((await storedSources()).map((s) => s.id)).toEqual(['A 1']);
    expect(await NotesStore.get('uuid-1')).toBeNull();
    expect((await NotesStore.get('mine')).own).toBeTrue();
    expect((await service.getManifest()).records.length).toBe(0);
  });

  it('leaves the sources that it creates out of the GitHub sync, and only those', async () => {
    await localforage.setItem('monodi_sources', [{ id: 'Own', quellensigle: 'Own' } as Source]);
    await importCm();
    expect(Array.from(await SyncExclusions.getAll())).toEqual(['A 1']);
    // a source that existed before is not touched: import into it again, the status stays as it is
    await SyncExclusions.remove(['A 1']);
    await importCm(true);
    expect((await SyncExclusions.getAll()).size).toBe(0);
  });

  it('puts nothing out of the sync when the person asks for it', async () => {
    const dataset = await service.openDataset(world.catalog, world.catalog.catalog.datasets[0]);
    const index = await service.openCmIndex(dataset);
    await service.importCm(dataset, index, planCmImport(index, new Set(['A_1'])), { overwrite: false, keepOutOfSync: false });
    expect((await SyncExclusions.getAll()).size).toBe(0);
  });

  it('leaves the Cantus sources out of the sync as well', async () => {
    const dataset = await service.openDataset(world.catalog, world.catalog.catalog.datasets[1]);
    const sources = await service.openCantusIndex(dataset);
    await service.importCantus(dataset, planCantusImport(sources, 'all'), 'all', { overwrite: false, alignText: false });
    expect(Array.from(await SyncExclusions.getAll())).toEqual(['cantusdatabase-1']);
  });

  it('includes a source in the sync and leaves it out again', async () => {
    await importCm();
    expect((await service.syncLeftOut()).has('A 1')).toBeTrue();
    await service.setSynced('A 1', true);
    expect((await service.syncLeftOut()).has('A 1')).toBeFalse();
    await service.setSynced('A 1', false);
    expect((await service.syncLeftOut()).has('A 1')).toBeTrue();
  });

  it('does not mark a source that the sync leaves out as deleted when its import is removed', async () => {
    await importCm();
    await service.removeImport((await service.getManifest()).records[0]);
    expect((await PushCache.getPendingDeletions()).has('A 1')).toBeFalse();
    expect((await SyncExclusions.getAll()).size).toBe(0);
  });

  it('marks a source that was included in the sync as deleted when its import is removed', async () => {
    await importCm();
    await service.setSynced('A 1', true);
    await service.removeImport((await service.getManifest()).records[0]);
    expect((await PushCache.getPendingDeletions()).has('A 1')).toBeTrue();
    await PushCache.clearDeleted(['A 1']);
  });

  it('removes the source as well when nothing else belongs to it', async () => {
    await importCm();
    const result = await service.removeImport((await service.getManifest()).records[0]);
    expect(result).toEqual({ documents: 2, sourceRemoved: true });
    expect((await storedSources()).length).toBe(0);
  });
});
