import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import * as localforage from 'localforage';
import { APIService, Document, Source } from './api.service';

describe('APIService', () => {
  let service: APIService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [APIService]
    });
    service = TestBed.inject(APIService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should initialize storagePersisted as null or boolean', () => {
    // Should be boolean or null depending on browser support in spec runner
    const val = service.storagePersisted;
    expect(val === null || typeof val === 'boolean').toBeTrue();
  });

  describe('stored lists', () => {
    const TOKEN = 't';
    const source = (id: string | undefined, sigle = id ?? 'x'): any => ({
      id, quellensigle: sigle, herkunftsregion: '', herkunftsort: '', herkunftsinstitution: '', ordenstradition: '',
      quellentyp: '', bibliotheksort: '', bibliothek: '', bibliothekssignatur: '', kommentar: '', datierung: '',
    });
    const doc = (id: string, quelle_id = 's1'): Document => ({
      id, quelle_id, dokumenten_id: id, gattung1: '', gattung2: '', festtag: '', feier: '', textinitium: id,
      bibliographischerverweis: '', druckausgabe: '', zeilenstart: '', foliostart: '', kommentar: '', editionsstatus: '',
    } as Document);
    const storedDocIds = async () => ((await localforage.getItem<Document[]>('monodi_documents')) || []).map(d => d.id);

    /** Puts the given lists into storage as another part of the app would, and makes the service read them. */
    async function seed(sources: unknown[], documents: unknown[]) {
      await new Promise(r => setTimeout(r, 50));          // let the service's own start-up reads finish first
      await localforage.setItem('monodi_sources', sources);
      await localforage.setItem('monodi_documents', documents);
      service.invalidateCache();
    }

    afterEach(async () => {
      await localforage.setItem('monodi_sources', []);
      await localforage.setItem('monodi_documents', []);
    });

    it('gives every caller the same list when several ask for it at once', async () => {
      await seed([source('a'), source(undefined, 'no id')], []);
      const lists = await Promise.all([1, 2, 3].map(() => firstValueFrom(service.listSources(TOKEN))));
      const ids = lists.map(l => (l as any).sources.map((s: Source) => s.id).join());
      expect(new Set(ids).size).toBe(1);
      expect((lists[0] as any).sources.length).toBe(2);
    });

    it('stores the repaired ids, so the same source keeps its id on the next start', async () => {
      await seed([source(undefined, 'no id')], []);
      const listed = (await firstValueFrom(service.listSources(TOKEN))) as any;
      const stored = (await localforage.getItem<Source[]>('monodi_sources'))!;
      expect(listed.sources[0].id).toBeTruthy();
      expect(stored[0].id).toBe(listed.sources[0].id);
    });

    it('does not let two overlapping deletes undo each other', async () => {
      await seed([source('s1')], [doc('A'), doc('B'), doc('C')]);
      await Promise.all([
        firstValueFrom(service.deleteDocuments(TOKEN, JSON.stringify(['A']))),
        firstValueFrom(service.deleteDocuments(TOKEN, JSON.stringify(['B']))),
      ]);
      const listed = (await firstValueFrom(service.listDocuments(TOKEN))) as any;
      expect(listed.documents.map((d: Document) => d.id)).toEqual(['C']);
      expect(await storedDocIds()).toEqual(['C']);
    });

    it('keeps a document that is created while another one is deleted', async () => {
      await seed([source('s1')], [doc('A'), doc('B')]);
      const created = firstValueFrom(service.createDocument(TOKEN, { document: doc('', 's1'), notes: {} as any }));
      const removed = firstValueFrom(service.removeDocument(TOKEN, 'A'));
      const [c] = await Promise.all([created, removed]) as any[];
      const ids = await storedDocIds();
      expect(ids.sort()).toEqual(['B', c.id].sort());
    });

    it('does not let one failed write block the ones behind it', async () => {
      await seed([source('s1')], [doc('A'), doc('B')]);
      const real = localforage.setItem.bind(localforage);
      let failNext = true;
      spyOn(localforage, 'setItem').and.callFake(((key: string, value: any) => {
        if (failNext && key === 'monodi_documents') { failNext = false; return Promise.reject(new Error('quota')); }
        return real(key, value);
      }) as any);
      await expectAsync(firstValueFrom(service.deleteDocuments(TOKEN, JSON.stringify(['A'])))).toBeRejected();
      await firstValueFrom(service.deleteDocuments(TOKEN, JSON.stringify(['B'])));
      expect(await storedDocIds()).not.toContain('B');
    });

    it('serves what another part of the app wrote after the cache was invalidated', async () => {
      await seed([source('s1')], []);
      await firstValueFrom(service.listSources(TOKEN));
      await localforage.setItem('monodi_sources', [source('s1'), source('s2')]);
      service.invalidateCache();
      const listed = (await firstValueFrom(service.listSources(TOKEN))) as any;
      expect(listed.sources.map((s: Source) => s.id)).toEqual(['s1', 's2']);
    });
  });
});
