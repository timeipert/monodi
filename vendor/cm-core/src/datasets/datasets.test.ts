// Tests of the dataset client and the filters, on made-up data served from memory (no network).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DatasetError, catalogUrlForRepository, cantusChantUrl, cantusDocumentId, cantusDocumentMeta, cantusSourceMeta,
  chantsIn, chantsOfChunk, cmDocumentFacets, cmDocumentUrls, cmSourceFacets, cmSourceFingerprintParts, emptyManifest,
  encodePath, expandTable, fetchBytes, fetchCantusChants, fillTemplate, filterCantusSources, filterCmDocuments,
  filterCmSources, findRecord, fingerprintOf, loadCatalog, loadCmIndex, loadDataset, loadIndex, makeContext,
  outdatedRecords, parseManifest, planCantusImport, planCmImport, prefetch, recordKey, removeRecord, resolveBase,
  sha256Hex, takesChant, upsertRecord, MAX_DOCUMENTS_PER_IMPORT,
} from './index.ts';
import type { CantusChant, CantusSource, CmDocument, CmSource, FetchContext } from './index.ts';

// ── a small world served from memory ────────────────────────────────────────────────────────────────────────────

class World {
  files = new Map<string, string>();
  calls: string[] = [];
  /** Answers to give before the file itself, per URL (for example [500, 500]). */
  failures = new Map<string, number[]>();

  async put(url: string, content: unknown): Promise<{ bytes: number; sha256: string }> {
    const text = typeof content === 'string' ? content : JSON.stringify(content);
    this.files.set(url, text);
    const data = new TextEncoder().encode(text);
    return { bytes: data.byteLength, sha256: await sha256Hex(data.buffer.slice(0) as ArrayBuffer) };
  }

  context(extra: Partial<FetchContext> = {}): FetchContext {
    return makeContext({
      retries: 3,
      sleep: async () => {},
      fetch: (async (input: RequestInfo | URL) => {
        const url = String(input);
        this.calls.push(url);
        const queued = this.failures.get(url);
        if (queued?.length) {
          const status = queued.shift()!;
          if (status === 0) throw new TypeError('Failed to fetch');
          return new Response('error', { status });
        }
        const text = this.files.get(url);
        if (text === undefined) return new Response('missing', { status: 404 });
        return new Response(text, { status: 200 });
      }) as typeof fetch,
      ...extra,
    });
  }
}

const REPO = 'https://example.test/repo/';
const UPSTREAM = 'https://example.test/upstream/abc/';

function cmSource(over: Partial<CmSource> = {}): CmSource {
  return {
    id: 'A_1', quellensigle: 'A 1', bibliothek: 'Domarchiv', bibliotheksort: 'Aachen', bibliothekssignatur: 'Hs 1',
    datierung: '12. Jh', jahrhundert: '12.', herkunftsregion: 'Quellen deutscher Herkunft', herkunftsort: 'Aachen',
    herkunftsinstitution: '', ordenstradition: '', quellentyp: 'Graduale', status: '', editors: 'Ed One',
    documents: 2, bytes: 1000, meta_bytes: 100, meta_sha256: 'a'.repeat(64), ...over,
  };
}

function cmDocument(over: Partial<CmDocument> = {}): CmDocument {
  return {
    id: 'uuid-1', dokumenten_id: 'A 1-1', quelle_id: 'A 1', source: 'A_1', dir: 'A_1-1', gattung1: 'Tropus',
    gattung2: '', festtag: 'Nativitas', feier: '', textinitium: 'Hodie cantandus', foliostart: '1r', notes_bytes: 400,
    meta_bytes: 50, notes_sha256: 'b'.repeat(64), meta_sha256: 'c'.repeat(64), ...over,
  };
}

function cantusSource(over: Partial<CantusSource> = {}): CantusSource {
  return {
    id: 'cantusdatabase-1', title: 'Graz, Universitätsbibliothek, 29', siglum: 'A-Gu 29', century: '14th century',
    num_century: '14', provenance: 'St-Lambrecht', cursus: 'Monastic', dbs: ['CD'], host: 'cantusdatabase.org',
    srclink: 'https://cantusdatabase.org/source/1', chant_path: 'chant', chant_sigla: ['A-Gu 29'], n_chants: 3,
    n_with_melody: 1, bytes: 900, files: [], ...over,
  };
}

const COLUMNS = ['cantus_id', 'folio', 'position', 'genre', 'office', 'feast', 'feast_code', 'mode', 'incipit',
  'full_text', 'volpiano', 'ref', 'image', 'db'];

function chantRow(over: Record<string, string> = {}): string[] {
  const base: Record<string, string> = {
    cantus_id: '004141', folio: '215r', position: '2.6', genre: 'A', office: 'M', feast: 'Nicolai',
    feast_code: '14120600', mode: '4', incipit: 'Omnibus se', full_text: 'Omnibus se invocantibus', volpiano: '',
    ref: '245439', image: '', db: 'CD', ...over,
  };
  return COLUMNS.map((c) => base[c]);
}

/** Catalogue with one Corpus Monodicum dataset (absolute base) and one Cantus dataset (relative base). */
async function buildWorld(): Promise<{ world: World; catalogUrl: string }> {
  const world = new World();
  const sources = [cmSource(), cmSource({ id: 'Mü_3', quellensigle: 'Mü 3', jahrhundert: '14., 15.', herkunftsregion: 'R' })];
  const documents = {
    columns: ['id', 'dokumenten_id', 'quelle_id', 'source', 'dir', 'gattung1', 'gattung2', 'festtag', 'feier', 'textinitium',
      'foliostart', 'notes_bytes', 'meta_bytes', 'notes_sha256', 'meta_sha256'],
    rows: [cmDocument(), cmDocument({ id: 'uuid-2', dokumenten_id: 'Mü 3-1', source: 'Mü_3', dir: 'Mü_3-1', gattung1: 'Sequenz' })]
      .map((d) => [d.id, d.dokumenten_id, d.quelle_id, d.source, d.dir, d.gattung1, d.gattung2, d.festtag, d.feier,
        d.textinitium, d.foliostart, d.notes_bytes, d.meta_bytes, d.notes_sha256, d.meta_sha256]),
  };
  const cmSources = await world.put(`${REPO}cm/sources.json`, sources);
  const cmDocuments = await world.put(`${REPO}cm/documents.json`, documents);
  const cmDataset = {
    layout_version: 1, id: 'cm', kind: 'transcriptions', title: 'CM', description: 'd', upstream: { repo: 'x/y', ref: 'abc' },
    base: UPSTREAM, licence: { spdx: 'CC-BY-NC-4.0' }, counts: {},
    file_templates: {
      source_meta: 'sources/{source}/{source}.meta.json',
      document_meta: 'sources/{source}/documents/{dir}/{dir}.meta.json',
      document_notes: 'sources/{source}/documents/{dir}/{dir}.notes.json',
    },
    indexes: { sources: { path: 'sources.json', ...cmSources }, documents: { path: 'documents.json', ...cmDocuments } },
  };
  const cmEntry = await world.put(`${REPO}cm/dataset.json`, cmDataset);

  const chunk1 = { source: 'cantusdatabase-1', part: 1, parts: 2, columns: COLUMNS, rows: [chantRow(), chantRow({ ref: '2', volpiano: '1---f--g' })] };
  const chunk2 = { source: 'cantusdatabase-1', part: 2, parts: 2, columns: COLUMNS, rows: [chantRow({ ref: 'https://x.test/chant/9' })] };
  const f1 = await world.put(`${REPO}cantus/sources/cantusdatabase-1/chants-0001.json`, chunk1);
  const f2 = await world.put(`${REPO}cantus/sources/cantusdatabase-1/chants-0002.json`, chunk2);
  const cSources = [cantusSource({
    files: [{ path: 'sources/cantusdatabase-1/chants-0001.json', ...f1 }, { path: 'sources/cantusdatabase-1/chants-0002.json', ...f2 }],
  })];
  const cIndex = await world.put(`${REPO}cantus/sources.json`, cSources);
  const cDataset = {
    layout_version: 1, id: 'cantus', kind: 'catalogue', title: 'Cantus', description: 'd', upstream: { release: 'v1.0' },
    base: './', licence: { spdx: 'CC-BY-NC-SA-4.0' }, counts: {}, chant_columns: COLUMNS,
    chant_url_template: 'https://{host}/{chant_path}/{ref}', indexes: { sources: { path: 'sources.json', ...cIndex } },
  };
  const cEntry = await world.put(`${REPO}cantus/dataset.json`, cDataset);

  const catalog = {
    layout_version: 1, title: 'T', datasets: [
      { id: 'cm', kind: 'transcriptions', title: 'CM', description: 'd', path: 'cm/dataset.json', ...cmEntry,
        licence: { spdx: 'CC-BY-NC-4.0' }, upstream: {}, counts: {} },
      { id: 'cantus', kind: 'catalogue', title: 'Cantus', description: 'd', path: 'cantus/dataset.json', ...cEntry,
        licence: { spdx: 'CC-BY-NC-SA-4.0' }, upstream: {}, counts: {} },
    ],
  };
  await world.put(`${REPO}catalog.json`, catalog);
  return { world, catalogUrl: `${REPO}catalog.json` };
}

// ── addresses ─────────────────────────────────────────────────────────────────────────────────────────────────────

describe('addresses', () => {
  it('encodes every segment and keeps the slashes', () => {
    assert.equal(encodePath('sources/Mü_5539/a b.json'), 'sources/M%C3%BC_5539/a%20b.json');
  });

  it('resolves a relative base against the dataset file and uses an absolute base as it is', () => {
    assert.equal(resolveBase('./', 'https://x.test/r/cantus/dataset.json'), 'https://x.test/r/cantus/');
    assert.equal(resolveBase('https://y.test/u/abc', 'https://x.test/r/cantus/dataset.json'), 'https://y.test/u/abc/');
  });

  it('fills templates and refuses a missing value', () => {
    assert.equal(fillTemplate('a/{x}/{y}', { x: '1', y: '2' }), 'a/1/2');
    assert.throws(() => fillTemplate('a/{x}', {}), /needs a value for \{x\}/);
  });

  it('reads a repository typed by a person', () => {
    assert.equal(catalogUrlForRepository('corpus-monodicum/monodi-datasets'),
      'https://raw.githubusercontent.com/corpus-monodicum/monodi-datasets/HEAD/catalog.json');
    assert.equal(catalogUrlForRepository(' https://github.com/a/b.git '), 'https://raw.githubusercontent.com/a/b/HEAD/catalog.json');
    assert.equal(catalogUrlForRepository('a/b@v2'), 'https://raw.githubusercontent.com/a/b/v2/catalog.json');
    assert.equal(catalogUrlForRepository('not a repository'), null);
  });
});

// ── fetching with integrity ─────────────────────────────────────────────────────────────────────────────────────

describe('fetchBytes', () => {
  it('returns a file that matches its size and hash', async () => {
    const world = new World();
    const expected = await world.put('https://t.test/a', 'hello');
    const data = await fetchBytes('https://t.test/a', expected, world.context());
    assert.equal(new TextDecoder().decode(data), 'hello');
  });

  it('repeats after a server error and after a network error', async () => {
    const world = new World();
    const expected = await world.put('https://t.test/a', 'hello');
    world.failures.set('https://t.test/a', [500, 0, 429]);
    await fetchBytes('https://t.test/a', expected, world.context());
    assert.equal(world.calls.length, 4);
  });

  it('does not repeat a missing file', async () => {
    const world = new World();
    await assert.rejects(fetchBytes('https://t.test/none', {}, world.context()), (e: DatasetError) => e.status === 404);
    assert.equal(world.calls.length, 1);
  });

  it('rejects a file that does not match the hash after the repetitions', async () => {
    const world = new World();
    const expected = await world.put('https://t.test/a', 'hello');
    world.files.set('https://t.test/a', 'hellp');
    await assert.rejects(fetchBytes('https://t.test/a', expected, world.context()), (e: DatasetError) => e.kind === 'integrity');
    assert.equal(world.calls.length, 4);
  });

  it('rejects a file of the wrong size', async () => {
    const world = new World();
    await world.put('https://t.test/a', 'hello');
    await assert.rejects(fetchBytes('https://t.test/a', { bytes: 3 }, world.context()), /has 5 bytes, the index lists 3/);
  });

  it('stops at once when the context is cancelled', async () => {
    const world = new World();
    await world.put('https://t.test/a', 'hello');
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(fetchBytes('https://t.test/a', {}, world.context({ signal: controller.signal })), (e: DatasetError) => e.kind === 'aborted');
    assert.equal(world.calls.length, 0);
  });
});

describe('prefetch', () => {
  const ctx = () => makeContext({ sleep: async () => {} });
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  it('hands out the results in the order of the items and keeps at most `window` ahead', async () => {
    let running = 0;
    let peak = 0;
    const started: number[] = [];
    const feed = prefetch([1, 2, 3, 4, 5, 6, 7, 8], async (n) => {
      started.push(n); running++; peak = Math.max(peak, running);
      await wait(n % 2 === 0 ? 1 : 6); // later items finish first
      running--; return n * 10;
    }, 3, ctx());
    const got: number[] = [];
    for (let i = 0; i < 8; i++) got.push((await feed.take()).value);
    assert.deepEqual(got, [10, 20, 30, 40, 50, 60, 70, 80]);
    assert.ok(peak <= 3, `peak ${peak}`);
    assert.deepEqual(started, [1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('starts the first window at once and refills it as results are taken', async () => {
    const started: number[] = [];
    const feed = prefetch([1, 2, 3, 4, 5], async (n) => { started.push(n); return n; }, 2, ctx());
    assert.deepEqual(started, [1, 2]);
    await feed.take();
    assert.deepEqual(started, [1, 2, 3]);
    feed.close();
  });

  it('throws the error of an item when it is taken and aborts the items behind it', async () => {
    const aborted: number[] = [];
    const feed = prefetch([1, 2, 3], async (n, inner) => {
      if (n === 1) { await wait(2); throw new DatasetError('boom', 'integrity'); }
      await new Promise<void>((resolve, reject) => {
        inner.signal!.addEventListener('abort', () => { aborted.push(n); reject(new DatasetError('stop', 'aborted')); });
        setTimeout(resolve, 200);
      });
      return n;
    }, 3, ctx());
    await assert.rejects(feed.take(), /boom/);
    await wait(5);
    assert.deepEqual(aborted.sort(), [2, 3]);
    await assert.rejects(feed.take(), (e: DatasetError) => e.kind === 'aborted');
  });

  it('follows the cancel of the context and says when there is nothing left', async () => {
    const controller = new AbortController();
    const feed = prefetch([1, 2], async (n, inner) => {
      await new Promise<void>((resolve, reject) => {
        inner.signal!.addEventListener('abort', () => reject(new DatasetError('stop', 'aborted')));
        setTimeout(resolve, 100);
      });
      return n;
    }, 2, makeContext({ signal: controller.signal }));
    controller.abort();
    await assert.rejects(feed.take(), (e: DatasetError) => e.kind === 'aborted');
    const done = prefetch([1], async (n) => n, 1, ctx());
    await done.take();
    await assert.rejects(done.take(), /nothing left/);
  });
});

// ── the chain of hashes ─────────────────────────────────────────────────────────────────────────────────────────

describe('catalogue and indexes', () => {
  it('follows the chain from the catalogue to the index of the Corpus Monodicum', async () => {
    const { world, catalogUrl } = await buildWorld();
    const ctx = world.context();
    const loaded = await loadCatalog(catalogUrl, ctx);
    assert.deepEqual(loaded.catalog.datasets.map((d) => d.id), ['cm', 'cantus']);
    const cm = await loadDataset(loaded, loaded.catalog.datasets[0], ctx);
    assert.equal(cm.baseUrl, UPSTREAM);
    const index = await loadCmIndex(cm, ctx);
    assert.equal(index.sources.length, 2);
    assert.equal(index.documents[1].dokumenten_id, 'Mü 3-1');
  });

  it('resolves the relative base of the Cantus dataset', async () => {
    const { world, catalogUrl } = await buildWorld();
    const ctx = world.context();
    const loaded = await loadCatalog(catalogUrl, ctx);
    const cantus = await loadDataset(loaded, loaded.catalog.datasets[1], ctx);
    assert.equal(cantus.baseUrl, `${REPO}cantus/`);
    assert.equal((await loadIndex<CantusSource[]>(cantus, 'sources', ctx))[0].id, 'cantusdatabase-1');
  });

  it('refuses a dataset file that was changed after the catalogue was written', async () => {
    const { world, catalogUrl } = await buildWorld();
    const ctx = world.context();
    const loaded = await loadCatalog(catalogUrl, ctx);
    world.files.set(`${REPO}cm/dataset.json`, world.files.get(`${REPO}cm/dataset.json`)!.replace('"CM"', '"XX"'));
    await assert.rejects(loadDataset(loaded, loaded.catalog.datasets[0], ctx), (e: DatasetError) => e.kind === 'integrity');
  });

  it('refuses another layout version with a clear message', async () => {
    const world = new World();
    await world.put(`${REPO}catalog.json`, { layout_version: 2, datasets: [] });
    await assert.rejects(loadCatalog(`${REPO}catalog.json`, world.context()), /layout version 2; this version of Monodi reads version 1/);
  });

  it('refuses a dataset whose files are on another host or not served over https', async () => {
    for (const base of ['https://elsewhere.test/data/', 'http://example.test/data/']) {
      const world = new World();
      const dataset = await world.put(`${REPO}x/dataset.json`, { layout_version: 1, id: 'x', kind: 'catalogue', base, indexes: {} });
      await world.put(`${REPO}catalog.json`, { layout_version: 1, datasets: [{ id: 'x', kind: 'catalogue', path: 'x/dataset.json', ...dataset }] });
      const ctx = world.context();
      const loaded = await loadCatalog(`${REPO}catalog.json`, ctx);
      await assert.rejects(loadDataset(loaded, loaded.catalog.datasets[0], ctx), (e: DatasetError) => e.kind === 'format' && /host|https/.test(e.message), base);
    }
  });

  it('refuses a catalogue entry that names a file on another host', async () => {
    const world = new World();
    await world.put(`${REPO}catalog.json`, {
      layout_version: 1, datasets: [{ id: 'x', kind: 'catalogue', path: 'https://elsewhere.test/dataset.json', bytes: 1, sha256: 'a'.repeat(64) }],
    });
    await assert.rejects(loadCatalog(`${REPO}catalog.json`, world.context()), /another host/);
  });

  it('fills the optional parts of a catalogue entry and a dataset so a screen can show any repository', async () => {
    const world = new World();
    const dataset = await world.put(`${REPO}x/dataset.json`, { layout_version: 1, id: 'x', kind: 'catalogue', base: './', indexes: {} });
    await world.put(`${REPO}catalog.json`, { layout_version: 1, datasets: [{ id: 'x', kind: 'catalogue', path: 'x/dataset.json', ...dataset }] });
    const ctx = world.context();
    const loaded = await loadCatalog(`${REPO}catalog.json`, ctx);
    const entry = loaded.catalog.datasets[0];
    assert.equal(entry.title, 'x');
    assert.equal(entry.licence.spdx, 'unknown');
    assert.deepEqual(entry.counts, {});
    const opened = await loadDataset(loaded, entry, ctx);
    assert.equal(opened.dataset.licence.spdx, 'unknown');
    assert.deepEqual(opened.dataset.upstream, {});
  });

  it('has a positive limit of chants per import', () => {
    assert.ok(MAX_DOCUMENTS_PER_IMPORT > 0 && MAX_DOCUMENTS_PER_IMPORT < 888_010);
  });

  it('expands a table into objects', () => {
    assert.deepEqual(expandTable({ columns: ['a', 'b'], rows: [[1, 2], [3, 4]] }), [{ a: 1, b: 2 }, { a: 3, b: 4 }]);
  });
});

// ── Corpus Monodicum ────────────────────────────────────────────────────────────────────────────────────────────

describe('Corpus Monodicum', () => {
  const sources = [cmSource(), cmSource({ id: 'Mü_3', quellensigle: 'Mü 3', jahrhundert: '14., 15.', herkunftsregion: 'R', bibliotheksort: 'München', bibliothek: 'Staatsbibliothek', herkunftsort: 'Dießen' })];

  it('filters sources by text without regard to accents, by century and by region', () => {
    assert.deepEqual(filterCmSources(sources, { text: 'munchen' }).map((s) => s.id), ['Mü_3']);
    assert.deepEqual(filterCmSources(sources, { centuries: [15] }).map((s) => s.id), ['Mü_3']);
    assert.deepEqual(filterCmSources(sources, { centuries: [12, 14] }).map((s) => s.id), ['A_1', 'Mü_3']);
    assert.deepEqual(filterCmSources(sources, { regions: ['R'] }).map((s) => s.id), ['Mü_3']);
    assert.deepEqual(filterCmSources(sources, { text: 'aachen domarchiv' }).map((s) => s.id), ['A_1']);
  });

  it('lists the centuries and regions of the sources with their counts', () => {
    const facets = cmSourceFacets(sources);
    assert.deepEqual(facets.centuries, [{ value: 12, count: 1 }, { value: 14, count: 1 }, { value: 15, count: 1 }]);
    assert.equal(facets.regions.length, 2);
  });

  it('plans an import with the bytes of the sources and chants that pass the filter', () => {
    const documents = [cmDocument(), cmDocument({ id: 'u2', dir: 'A_1-2', gattung1: 'Sequenz' }), cmDocument({ id: 'u3', source: 'Mü_3', dir: 'M-1' })];
    const index = { sources, documents };
    const all = planCmImport(index, new Set(['A_1']));
    assert.equal(all.documents.length, 2);
    assert.equal(all.bytes, 100 + 2 * (50 + 400));
    assert.equal(all.files, 1 + 4);
    assert.equal(all.storedBytes, Math.round(all.bytes / 2));
    const sequences = planCmImport(index, new Set(['A_1', 'Mü_3']), { genres: ['Sequenz'] });
    assert.deepEqual(sequences.sources.map((s) => s.id), ['A_1']);
    assert.equal(sequences.documents.length, 1);
    assert.equal(planCmImport(index, new Set(['A_1']), { text: 'nothing like it' }).sources.length, 0);
  });

  it('filters chants and lists genres and feasts', () => {
    const documents = [cmDocument(), cmDocument({ id: 'u2', gattung1: 'Sequenz', festtag: 'Pascha', textinitium: 'Victimae' })];
    assert.deepEqual(filterCmDocuments(documents, { feasts: ['Pascha'] }).map((d) => d.id), ['u2']);
    assert.deepEqual(filterCmDocuments(documents, { text: 'victimae' }).map((d) => d.id), ['u2']);
    assert.deepEqual(cmDocumentFacets(documents).genres.map((g) => g.value).sort(), ['Sequenz', 'Tropus']);
  });

  it('builds the addresses of the files of a chant with an umlaut in its path', async () => {
    const { world, catalogUrl } = await buildWorld();
    const ctx = world.context();
    const loaded = await loadCatalog(catalogUrl, ctx);
    const cm = await loadDataset(loaded, loaded.catalog.datasets[0], ctx);
    assert.deepEqual(cmDocumentUrls(cm, cmDocument({ source: 'Mü_3', dir: 'Mü_3-1' })), {
      meta: `${UPSTREAM}sources/M%C3%BC_3/documents/M%C3%BC_3-1/M%C3%BC_3-1.meta.json`,
      notes: `${UPSTREAM}sources/M%C3%BC_3/documents/M%C3%BC_3-1/M%C3%BC_3-1.notes.json`,
    });
  });

  it('changes the fingerprint parts when the notes of a chant change', () => {
    const before = cmSourceFingerprintParts(sources[0], [cmDocument()]);
    const after = cmSourceFingerprintParts(sources[0], [cmDocument({ notes_sha256: 'd'.repeat(64) })]);
    assert.notDeepEqual(before, after);
  });
});

// ── Cantus Corpus ───────────────────────────────────────────────────────────────────────────────────────────────

describe('Cantus Corpus', () => {
  const sources = [
    cantusSource(),
    cantusSource({ id: 'cantussk-2', siglum: 'SK 2', title: 'Bratislava', num_century: '15', cursus: '', host: 'cantus.sk', n_chants: 5, n_with_melody: 0, bytes: 100 }),
  ];

  it('filters sources, among them "only sources with a melody"', () => {
    assert.deepEqual(filterCantusSources(sources, { withMelodyOnly: true }).map((s) => s.id), ['cantusdatabase-1']);
    assert.deepEqual(filterCantusSources(sources, { text: 'bratislava' }).map((s) => s.id), ['cantussk-2']);
    assert.deepEqual(filterCantusSources(sources, { centuries: [15] }).map((s) => s.id), ['cantussk-2']);
    assert.deepEqual(filterCantusSources(sources, { cursus: ['Monastic'], hosts: ['cantusdatabase.org'] }).map((s) => s.id), ['cantusdatabase-1']);
  });

  it('counts the chants of each selection and plans the import', () => {
    assert.equal(chantsIn(sources[0], 'with-melody'), 1);
    assert.equal(chantsIn(sources[0], 'without-melody'), 2);
    assert.equal(chantsIn(sources[1], 'all'), 5);
    const melodies = planCantusImport(sources, 'with-melody');
    assert.deepEqual(melodies.sources.map((s) => s.id), ['cantusdatabase-1']);
    assert.equal(melodies.chants, 1);
    assert.equal(melodies.downloadBytes, 900);
    const toTranscribe = planCantusImport(sources, 'without-melody');
    assert.equal(toTranscribe.chants, 2 + 5);
    assert.equal(toTranscribe.melodies, 0);
    const everything = planCantusImport(sources, 'all');
    assert.equal(everything.chants, 8);
    assert.equal(everything.melodies, 1);
    assert.ok(everything.storedBytes > toTranscribe.storedBytes);
  });

  it('reads the chunks of a source and takes the chants of a selection', async () => {
    const { world, catalogUrl } = await buildWorld();
    const ctx = world.context();
    const loaded = await loadCatalog(catalogUrl, ctx);
    const cantus = await loadDataset(loaded, loaded.catalog.datasets[1], ctx);
    const index = await loadIndex<CantusSource[]>(cantus, 'sources', ctx);
    const chants = await fetchCantusChants(cantus, index[0], ctx);
    assert.equal(chants.length, 3);
    assert.deepEqual(chants.filter((c) => takesChant(c, 'with-melody')).map((c) => c.ref), ['2']);
    assert.equal(chants.filter((c) => takesChant(c, 'without-melody')).length, 2);
    assert.equal(chants.filter((c) => takesChant(c, 'all')).length, 3);
  });

  it('refuses a chunk with other columns than the dataset lists', () => {
    assert.throws(() => chantsOfChunk({ source: 's', part: 1, parts: 1, columns: ['a'], rows: [] }, COLUMNS), /other columns/);
  });

  it('maps a source and a chant to the keys the ZIP import reads', async () => {
    const { world, catalogUrl } = await buildWorld();
    const ctx = world.context();
    const loaded = await loadCatalog(catalogUrl, ctx);
    const cantus = await loadDataset(loaded, loaded.catalog.datasets[1], ctx);
    const source = sources[0];
    const meta = cantusSourceMeta(source);
    assert.equal(meta['quellensigle'], 'A-Gu 29');
    assert.equal(meta['id'], 'cantusdatabase-1');
    assert.equal(meta['jahrhundert'], '14.');
    const chant = chantsOfChunk({ source: source.id, part: 1, parts: 1, columns: COLUMNS, rows: [chantRow({ volpiano: '1---f' })] }, COLUMNS)[0];
    const doc = cantusDocumentMeta(cantus, source, chant) as Record<string, any>;
    assert.equal(doc['quelle_id'], 'cantusdatabase-1');
    assert.equal(doc['dokumenten_id'], 'A-Gu 29 215r 004141');
    assert.equal(doc['festtag'], 'Nicolai');
    assert.equal(doc['textinitium'], 'Omnibus se');
    assert.equal(doc['additionalData'].cantus_chant, 'https://cantusdatabase.org/chant/245439');
    assert.equal(doc['additionalData'].original_url, 'https://cantusdatabase.org/chant/245439');
    assert.equal(doc['kommentar'], 'Original record in the Cantus Database: https://cantusdatabase.org/chant/245439');
  });

  it('gives chants stable identifiers that are safe in an address and uses a complete link as it is', async () => {
    const { world, catalogUrl } = await buildWorld();
    const ctx = world.context();
    const loaded = await loadCatalog(catalogUrl, ctx);
    const cantus = await loadDataset(loaded, loaded.catalog.datasets[1], ctx);
    const plain = chantsOfChunk({ source: 's', part: 1, parts: 1, columns: COLUMNS, rows: [chantRow()] }, COLUMNS)[0] as CantusChant;
    const linked = { ...plain, ref: 'https://other.test/chant/77?x=1' };
    assert.equal(cantusDocumentId(sources[0], plain), 'cantusdatabase-1-245439');
    assert.equal(cantusDocumentId(sources[0], linked), 'cantusdatabase-1-chant-77_x_1');
    assert.equal(cantusChantUrl(cantus, sources[0], linked), 'https://other.test/chant/77?x=1');
  });
});

// ── the record of imports ───────────────────────────────────────────────────────────────────────────────────────

describe('manifest', () => {
  const record = { datasetId: 'cm', sourceId: 'A_1', workspaceSourceId: 'A 1', upstreamRef: 'abc', fingerprint: 'f1', documentIds: ['d1'], importedAt: '2026-11-14T10:00:00Z' };

  it('adds, merges the documents of an earlier import of the same source, and removes', () => {
    let manifest = upsertRecord(emptyManifest(), record);
    manifest = upsertRecord(manifest, { ...record, fingerprint: 'f2', documentIds: ['d2'] });
    assert.equal(manifest.records.length, 1);
    assert.deepEqual(findRecord(manifest, 'cm', 'A_1')!.documentIds.sort(), ['d1', 'd2']);
    assert.equal(findRecord(manifest, 'cm', 'A_1')!.fingerprint, 'f2');
    assert.equal(removeRecord(manifest, 'cm', 'A_1').records.length, 0);
  });

  it('reads a stored manifest tolerantly', () => {
    assert.deepEqual(parseManifest(null), emptyManifest());
    assert.deepEqual(parseManifest({ records: 5 }), emptyManifest());
    assert.equal(parseManifest({ records: [record, { datasetId: 'x' }] }).records.length, 1);
  });

  it('finds the records whose source has another fingerprint now', () => {
    const manifest = upsertRecord(emptyManifest(), record);
    assert.equal(outdatedRecords(manifest, new Map([[recordKey('cm', 'A_1'), 'f1']])).length, 0);
    assert.equal(outdatedRecords(manifest, new Map([[recordKey('cm', 'A_1'), 'f9']])).length, 1);
    assert.equal(outdatedRecords(manifest, new Map()).length, 0);
  });

  it('computes a fingerprint that depends on every part', async () => {
    const a = await fingerprintOf(['x', 'y'], sha256Hex);
    assert.equal(a, await fingerprintOf(['x', 'y'], sha256Hex));
    assert.notEqual(a, await fingerprintOf(['x', 'z'], sha256Hex));
    assert.match(a, /^[0-9a-f]{64}$/);
  });
});

// ── links back to the original page ─────────────────────────────────────────────────────────────────────────────

import { cmDocumentPageUrl, withOriginalLink } from './links.ts';

describe('links back to the original page', () => {
  it('writes the link into the comment and the custom field', () => {
    const m = withOriginalLink({ id: 'a', kommentar: '', additionalData: { x: '1' } }, 'https://example.org/c/1', 'Original');
    assert.equal(m['kommentar'], 'Original: https://example.org/c/1');
    assert.deepEqual(m['additionalData'], { x: '1', original_url: 'https://example.org/c/1' });
  });

  it('keeps a comment that is there and adds the link after a blank line', () => {
    const m = withOriginalLink({ id: 'a', kommentar: 'Folio damaged.' }, 'https://example.org/c/1', 'Original');
    assert.equal(m['kommentar'], 'Folio damaged.\n\nOriginal: https://example.org/c/1');
    assert.deepEqual(m['additionalData'], { original_url: 'https://example.org/c/1' });
  });

  it('adds the same link only once and does not change the metadata it was given', () => {
    const once = withOriginalLink({ id: 'a', kommentar: '' }, 'https://example.org/c/1', 'Original');
    const twice = withOriginalLink(once, 'https://example.org/c/1', 'Original');
    assert.equal(twice['kommentar'], once['kommentar']);
    const input = { id: 'a', kommentar: 'x' };
    withOriginalLink(input, 'https://example.org/c/2', 'Original');
    assert.equal(input.kommentar, 'x');
  });

  it('the page of a Corpus Monodicum document is the document id under corpus-monodicum.de/d/', () => {
    assert.equal(cmDocumentPageUrl('8840bf6b-cf61-4e16-aa43-800b50c9a21a'), 'https://corpus-monodicum.de/d/8840bf6b-cf61-4e16-aa43-800b50c9a21a');
  });
});
