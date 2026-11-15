import { CommonModule } from '@angular/common';
import { ChangeDetectorRef } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { ToastrService } from 'ngx-toastr';
import type { CantusSource, CmDocument, CmSource, LoadedCatalog, LoadedDataset } from '@monodi/core/datasets';
import { GithubService } from '../github.service';
import { RepositoryImportService } from '../repository-import.service';
import { RepositoryImportComponent } from './repository-import.component';

function cmSource(id: string, sigle: string, bytes: number): CmSource {
  return {
    id, quellensigle: sigle, bibliothek: 'Library', bibliotheksort: 'Place', bibliothekssignatur: '', datierung: '12. Jh',
    jahrhundert: '12.', herkunftsregion: 'Region', herkunftsort: '', herkunftsinstitution: '', ordenstradition: '',
    quellentyp: 'Graduale', status: '', editors: '', documents: 1, bytes, meta_bytes: 10, meta_sha256: 'a'.repeat(64),
  };
}

function cmDocument(source: string, n: number, bytes: number): CmDocument {
  return {
    id: `${source}-${n}`, dokumenten_id: `${source} ${n}`, quelle_id: source, source, dir: `${source}-${n}`, gattung1: 'Tropus',
    gattung2: '', festtag: 'Nat', feier: '', textinitium: 'Hodie', foliostart: '1r', notes_bytes: bytes, meta_bytes: 10,
    notes_sha256: 'b'.repeat(64), meta_sha256: 'c'.repeat(64),
  };
}

function cantusSource(chants: number): CantusSource {
  return {
    id: 'cantusdatabase-1', title: 'Big source', siglum: 'X 1', century: '14th century', num_century: '14', provenance: 'P',
    cursus: 'Monastic', dbs: ['CD'], host: 'cantusdatabase.org', srclink: 'https://cantusdatabase.org/source/1',
    chant_path: 'chant', chant_sigla: ['X 1'], n_chants: chants, n_with_melody: 0, bytes: 1000, files: [],
  };
}

describe('RepositoryImportComponent', () => {
  let fixture: ComponentFixture<RepositoryImportComponent>;
  let component: RepositoryImportComponent;
  let storage: { usage: number; quota: number } | null;
  let cantusSources: CantusSource[];

  const catalog = {
    url: 'https://example.test/catalog.json',
    catalog: {
      layout_version: 1, title: 'T', datasets: [
        { id: 'cm', kind: 'transcriptions', title: 'Corpus Monodicum', description: 'd', path: 'cm/dataset.json', bytes: 1, sha256: 'x',
          licence: { spdx: 'CC-BY-NC-4.0' }, upstream: {}, counts: { sources: 2, documents: 2 } },
        { id: 'cantus', kind: 'catalogue', title: 'CantusCorpus', description: 'd', path: 'cantus/dataset.json', bytes: 1, sha256: 'y',
          licence: { spdx: 'CC-BY-NC-SA-4.0' }, upstream: {}, counts: { sources: 1, chants: 60000 } },
      ],
    },
  } as unknown as LoadedCatalog;

  const datasetOf = (index: number) => ({
    entry: catalog.catalog.datasets[index], url: 'https://example.test/x/dataset.json', baseUrl: 'https://example.test/x/',
    dataset: { licence: { spdx: 'x' }, upstream: {} },
  } as unknown as LoadedDataset);

  beforeEach(async () => {
    storage = { usage: 0, quota: 100_000_000 };
    cantusSources = [cantusSource(60_000)];
    const service = jasmine.createSpyObj<RepositoryImportService>('RepositoryImportService', [
      'openCatalog', 'openDataset', 'openCmIndex', 'openCantusIndex', 'getManifest', 'storageEstimate', 'syncLeftOut', 'setSynced',
    ]);
    (service as any).defaultCatalogUrl = 'https://example.test/catalog.json';
    service.openCatalog.and.callFake(async () => catalog);
    service.openDataset.and.callFake(async (_c, entry) => datasetOf(catalog.catalog.datasets.indexOf(entry)));
    service.openCmIndex.and.callFake(async () => ({
      sources: [cmSource('A_1', 'A 1', 4000), cmSource('B_2', 'B 2', 200_000_000)],
      documents: [cmDocument('A_1', 1, 3000), cmDocument('B_2', 1, 200_000_000)],
    }));
    service.openCantusIndex.and.callFake(async () => cantusSources);
    service.getManifest.and.callFake(async () => ({ version: 1, records: [] }));
    service.storageEstimate.and.callFake(async () => storage);
    service.syncLeftOut.and.callFake(async () => new Set<string>());
    service.setSynced.and.callFake(async () => undefined);

    await TestBed.configureTestingModule({
      declarations: [RepositoryImportComponent],
      imports: [CommonModule, FormsModule],
      providers: [
        { provide: RepositoryImportService, useValue: service },
        { provide: ToastrService, useValue: { success() {}, info() {}, error() {} } },
        { provide: GithubService, useValue: { isConnected: false } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(RepositoryImportComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  /**
   * Renders the component view now. The fields of the component change without a signal or an event that marks the view
   * dirty, and `fixture.detectChanges()` of this test harness then neither refreshes the view nor passes the dev-mode
   * check (NG0100 on a conditional); the running app, with zone.js, renders the same view without an error.
   */
  const render = () => fixture.debugElement.injector.get(ChangeDetectorRef).detectChanges();

  const text = () => (fixture.nativeElement as HTMLElement).textContent!.replace(/\s+/g, ' ');

  it('lists the datasets of the catalogue with their licence', () => {
    expect(text()).toContain('Corpus Monodicum');
    expect(text()).toContain('CantusCorpus');
    expect(text()).toContain('CC-BY-NC-SA-4.0');
  });

  it('filters the sources of the Corpus Monodicum and sizes the selection before anything is downloaded', async () => {
    await component.openDataset(catalog.catalog.datasets[0]);
    render();
    expect(component.cmShown.map((s) => s.id)).toEqual(['A_1', 'B_2']);
    component.cmText = 'a 1';
    component.recompute();
    expect(component.cmShown.map((s) => s.id)).toEqual(['A_1']);
    component.cmText = '';
    component.toggleCm('A_1');
    expect(component.selectedCount).toBe(1);
    expect(component.itemCount).toBe(1);
    expect(component.downloadBytes).toBe(10 + 10 + 3000);
    expect(component.canImport).toBeTrue();
  });

  it('blocks an import that does not fit into the free browser storage', async () => {
    await component.openDataset(catalog.catalog.datasets[0]);
    component.toggleCm('B_2');
    render();
    expect(component.storageState).toBe('over');
    expect(component.canImport).toBeFalse();
    expect(text()).toContain('does not fit');
  });

  it('marks an import that takes more than half of the free space', async () => {
    storage = { usage: 0, quota: 3000 };
    component.storage = storage;
    await component.openDataset(catalog.catalog.datasets[0]);
    component.toggleCm('A_1');
    expect(component.storedBytes).toBeGreaterThan(1000);
    expect(component.storageState).toBe('tight');
    expect(component.canImport).toBeTrue();
  });

  it('blocks an import of more chants than one import takes', async () => {
    cantusSources = [{ ...cantusSource(60_000), n_with_melody: 0 }];
    await component.openDataset(catalog.catalog.datasets[1]);
    component.chantSelection = 'all';
    component.toggleCantus('cantusdatabase-1');
    render();
    expect(component.itemCount).toBe(60_000);
    expect(component.tooMany).toBeTrue();
    expect(component.canImport).toBeFalse();
    expect(text()).toContain('chants at once are not taken');
  });

  it('leaves out of the plan a source that has no chant for the chosen kind', async () => {
    await component.openDataset(catalog.catalog.datasets[1]);
    component.chantSelection = 'with-melody';
    component.toggleCantus('cantusdatabase-1');
    expect(component.selectedCount).toBe(0);
    expect(component.canImport).toBeFalse();
  });

  it('reads another repository that a person typed, and refuses text that is not a repository', async () => {
    const service = TestBed.inject(RepositoryImportService) as jasmine.SpyObj<RepositoryImportService>;
    component.repositoryText = 'not a repository';
    await component.useRepository();
    expect(component.catalogError).toContain('owner/name');
    component.repositoryText = 'someone/their-datasets@v2';
    await component.useRepository();
    expect(service.openCatalog).toHaveBeenCalledWith('https://raw.githubusercontent.com/someone/their-datasets/v2/catalog.json');
  });
});
