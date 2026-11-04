import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { WelcomeComponent } from './welcome.component';
import { APIService } from '../api.service';
import { UserService } from '../user.service';
import { BackupReminderService } from '../backup-reminder.service';
import { PageTitleService } from '../page-title.service';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { of } from 'rxjs';
import { NO_ERRORS_SCHEMA } from '@angular/core';

describe('WelcomeComponent', () => {
  let component: WelcomeComponent;
  let fixture: ComponentFixture<WelcomeComponent>;
  let sources: any[];
  let documents: any[];
  let backup: { lastChangeAt: number; lastBackupAt: number; unbacked: boolean };
  const router = { navigate: jasmine.createSpy('navigate') };

  const mockAPIService = {
    listSources: () => of({ kind: 'SourcesRetrieved', sources }),
    listDocuments: () => of({ kind: 'DocumentsRetrieved', documents }),
  };

  const mockUserService = {
    user: of({ token: 'mock-token', user: 'local-user', roles: ['admin'] })
  };

  beforeEach(() => {
    sources = [];
    documents = [];
    backup = { lastChangeAt: 0, lastBackupAt: 0, unbacked: false };
    router.navigate.calls.reset();
    localStorage.removeItem('monodi_recent_documents');
    TestBed.configureTestingModule({
      declarations: [WelcomeComponent],
      providers: [
        { provide: APIService, useValue: mockAPIService },
        { provide: UserService, useValue: mockUserService },
        { provide: PageTitleService, useValue: { reset: () => {} } },
        { provide: NgbModal, useValue: { open: () => {} } },
        { provide: Router, useValue: router },
        {
          provide: BackupReminderService,
          useValue: {
            lastChangeAt: () => backup.lastChangeAt,
            lastBackupAt: () => backup.lastBackupAt,
            hasUnbackedChanges: () => backup.unbacked,
          },
        },
      ],
      schemas: [NO_ERRORS_SCHEMA]
    });

    fixture = TestBed.createComponent(WelcomeComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => localStorage.removeItem('monodi_recent_documents'));

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should initialize with default states', () => {
    expect(component.loading).toBeTrue();
    expect(component.hasData).toBeFalse();
    expect(component.sourcesCount).toBe(0);
    expect(component.documentsCount).toBe(0);
  });

  it('should detect when workspace contains data', () => {
    sources = [{ id: 'src-1', quellensigle: 'A' }];
    fixture.detectChanges();
    expect(component.sourcesCount).toBe(1);
    expect(component.hasData).toBeTrue();
    expect(component.loading).toBeFalse();
  });

  it('lists the source of the last opened document first and points "New document" at it', () => {
    sources = [{ id: 's1', quellensigle: 'Alpha' }, { id: 's2', quellensigle: 'Beta' }, { id: 's3', quellensigle: 'Gamma' }];
    documents = [
      { id: 'd1', quelle_id: 's1' }, { id: 'd2', quelle_id: 's1' },
      { id: 'd3', quelle_id: 's2' }, { id: 'd4', quelle_id: 's3' }, { id: 'd5', quelle_id: 's3' }, { id: 'd6', quelle_id: 's3' },
    ];
    localStorage.setItem('monodi_recent_documents', JSON.stringify([{ id: 'd3', quelle_id: 's2', timestamp: '2026-11-03T10:00:00Z' }]));
    fixture.detectChanges();
    // last used source first, then by number of documents
    expect(component.topSources.map(s => s.sigle)).toEqual(['Beta', 'Gamma', 'Alpha']);
    expect(component.topSources[1].docCount).toBe(3);
    expect(component.continueDoc.id).toBe('d3');
    expect(component.newDocumentRoute).toEqual(['/document', 's2']);
    expect(component.newDocumentSourceName).toBe('Beta');
  });

  it('falls back to the first source when no document was opened yet', () => {
    sources = [{ id: 's1', quellensigle: 'Alpha' }];
    fixture.detectChanges();
    expect(component.continueDoc).toBeUndefined();
    expect(component.newDocumentRoute).toEqual(['/document', 's1']);
  });

  it('reports the backup state', () => {
    sources = [{ id: 's1', quellensigle: 'Alpha' }];
    fixture.detectChanges();
    expect(component.backupState).toBe('none');

    backup = { lastChangeAt: 2000, lastBackupAt: 3000, unbacked: false };
    component.loadDashboardData();
    expect(component.backupState).toBe('clean');
    expect(component.lastEditAt).toBe(2000);

    backup = { lastChangeAt: 4000, lastBackupAt: 3000, unbacked: true };
    component.loadDashboardData();
    expect(component.backupState).toBe('dirty');
  });

  it('opens the search page with the typed text', () => {
    component.quickQuery = '  Ad te levavi ';
    component.quickSearch();
    expect(router.navigate).toHaveBeenCalledWith(['/search'], { queryParams: { q: 'Ad te levavi' } });
    router.navigate.calls.reset();
    component.quickQuery = ' ';
    component.quickSearch();
    expect(router.navigate).toHaveBeenCalledWith(['/search'], {});
  });
});
