import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, NO_ERRORS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { BehaviorSubject, of } from 'rxjs';
import { ToastrService } from 'ngx-toastr';
import { APIService } from '../api.service';
import { BackupReminderService } from '../backup-reminder.service';
import { CantusIndexService } from '../cantus-index.service';
import { PageTitleService } from '../page-title.service';
import { RepositoryImportService } from '../repository-import.service';
import { UserService } from '../user.service';
import { VolpianoService } from '../volpiano.service';
import { findAction } from './import-export-actions';
import { ImportExportComponent } from './import-export.component';

describe('ImportExportComponent', () => {
  let fixture: ComponentFixture<ImportExportComponent>;
  let component: ImportExportComponent;
  let params: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
  let router: jasmine.SpyObj<Router>;
  let backup: { lastBackupAt: () => number; hasUnbackedChanges: () => boolean };
  let manifestRecords: unknown[];

  const text = () => (fixture.nativeElement as HTMLElement).textContent!.replace(/\s+/g, ' ');
  const render = () => fixture.debugElement.injector.get(ChangeDetectorRef).detectChanges();

  async function create(query: Record<string, string> = {}) {
    params = new BehaviorSubject(convertToParamMap(query));
    await TestBed.configureTestingModule({
      declarations: [ImportExportComponent],
      imports: [CommonModule, FormsModule],
      schemas: [NO_ERRORS_SCHEMA],
      providers: [
        { provide: ActivatedRoute, useValue: { queryParamMap: params } },
        { provide: Router, useValue: router },
        { provide: UserService, useValue: { user: of({ user: 'u', roles: [], token: 't' }) } },
        {
          provide: APIService,
          useValue: {
            listSources: () => of({ kind: 'SourcesRetrieved', sources: [{}, {}] }),
            listDocuments: () => of({ kind: 'DocumentsRetrieved', documents: [{}, {}, {}] }),
          },
        },
        { provide: BackupReminderService, useValue: backup },
        { provide: RepositoryImportService, useValue: { getManifest: async () => ({ version: 1, records: manifestRecords }) } },
        { provide: ToastrService, useValue: { success() {}, error() {}, info() {} } },
        { provide: PageTitleService, useValue: { set() {} } },
        { provide: VolpianoService, useValue: {} },
        { provide: CantusIndexService, useValue: {} },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(ImportExportComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    await component.loadStatus(); // the status is read in the background after the start; wait for it here
    render();
  }

  beforeEach(() => {
    router = jasmine.createSpyObj<Router>('Router', ['navigate']);
    backup = { lastBackupAt: () => 0, hasUnbackedChanges: () => false };
    manifestRecords = [];
  });

  it('opens on the import tab with its three sections in order', async () => {
    await create();
    expect(component.tab).toBe('import');
    const titles = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('.io-section-title')).map((e) => e.textContent!.trim());
    expect(titles).toEqual(['Start from existing data', 'Add chants', 'Add manuscript annotations']);
    expect(text()).not.toContain('Publish and print');
  });

  it('shows the export sections when the address says tab=export, and marks the backup as recommended', async () => {
    await create({ tab: 'export' });
    expect(component.tab).toBe('export');
    const titles = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('.io-section-title')).map((e) => e.textContent!.trim());
    expect(titles).toEqual(['Publish and print', 'Back up and share']);
    expect(text()).toContain('Recommended');
  });

  it('changes the tab through the address, so a reload and a link keep it', async () => {
    await create();
    component.setTab('export');
    expect(router.navigate).toHaveBeenCalledWith([], jasmine.objectContaining({ queryParams: { tab: 'export' }, replaceUrl: true }));
    component.setTab('import');
    expect(router.navigate).toHaveBeenCalledWith([], jasmine.objectContaining({ queryParams: { tab: null } }));
  });

  it('shows what the workspace holds and says that no backup was made', async () => {
    await create();
    expect(component.status).toEqual(jasmine.objectContaining({ sources: 2, documents: 3 }));
    expect(component.backupState).toBe('none');
    expect(text()).toContain('2 sources · 3 chants');
    expect(text()).toContain('No backup made in this browser yet');
  });

  it('tells a backup that is up to date from one that is behind the changes', async () => {
    backup = { lastBackupAt: () => Date.now() - 3 * 86_400_000, hasUnbackedChanges: () => false };
    await create();
    expect(component.backupState).toBe('ok');
    expect(component.backupText).toBe('Last backup 3 days ago; nothing changed since');

    TestBed.resetTestingModule();
    backup = { lastBackupAt: () => Date.now() - 3 * 86_400_000, hasUnbackedChanges: () => true };
    await create();
    expect(component.backupState).toBe('old');
    expect(component.backupText).toContain('later changes are not backed up');
  });

  it('shows what came from repositories only when something did, with a way to manage it', async () => {
    await create();
    expect(text()).not.toContain('came from repositories');

    TestBed.resetTestingModule();
    manifestRecords = [{ documentIds: ['a', 'b'] }, { documentIds: ['c'] }];
    await create();
    expect(component.status?.importedSources).toBe(2);
    expect(text()).toContain('3 chants of 2 sources came from repositories');
    component.openImported();
    expect(component.showRepositoryDialog).toBeTrue();
    expect(component.repositoryStartTab).toBe('imported');
  });

  it('opens the repository dialog on its first tab, and sends the other actions to the Sources page', async () => {
    await create();
    component.run(findAction('repository')!);
    expect(component.showRepositoryDialog).toBeTrue();
    expect(component.repositoryStartTab).toBe('datasets');
    component.run(findAction('import-zip')!);
    expect(router.navigate).toHaveBeenCalledWith(['/sources'], { queryParams: { ws: 'import-zip' } });
  });

  it('follows a goal to its tab and starts the action', async () => {
    await create();
    component.startGoal({ goal: 'x', answer: 'y', actionId: 'export-pdf' });
    expect(router.navigate).toHaveBeenCalledWith([], jasmine.objectContaining({ queryParams: { tab: 'export' } }));
    expect(router.navigate).toHaveBeenCalledWith(['/sources'], { queryParams: { ws: 'export-pdf' } });
  });
});
