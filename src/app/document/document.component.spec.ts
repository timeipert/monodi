import { waitForAsync, ComponentFixture, TestBed } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { of } from 'rxjs';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { convertToParamMap, ActivatedRoute } from '@angular/router';

import { DocumentComponent } from './document.component';
import { APIService } from '../api.service';
import { UserService } from '../user.service';
import { UndoService } from '../undoService';
import { StatusLineService } from '../status-line.service';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { ToolsService } from '../tools.service';
import { DragStateService } from '../dragger/drag-state.service';
import { NavigationService } from '../notationsdokumentation/navigation.service';
import { MeiExportService } from '../mei-export.service';
import { PageTitleService } from '../page-title.service';
import { FocusService } from '../focus.service';

describe('DocumentComponent', () => {
  let component: DocumentComponent;
  let fixture: ComponentFixture<DocumentComponent>;

  const mockActivatedRoute = {
    paramMap: of(convertToParamMap({ source: 'mock-source', id: 'mock-id' })),
    queryParams: of({ view: 'transcription' })
  };

  const mockAPIService = {
    getSettings: () => of({ kind: 'SettingsRetrieved', settings: {} }),
    getSource: () => of({ kind: 'SourceRetrieved', source: {} }),
    getDocument: () => of({ kind: 'DocumentRetrieved', document: { id: 'mock-id', quelle_id: 'mock-source', foliostart: '1r', custom: {} } }),
    getDocumentNotes: () => of({ kind: 'NotesRetrieved', data: { kind: 'RootContainer', uuid: 'root-1', children: [], comments: [] } }),
    getSigle: () => of({ kind: 'SigleRetrieved', sigle: 'mock-sigle' }),
    updateSource: () => of({ kind: 'Ok' }),
    saveDocument: () => of({ kind: 'Ok' })
  };

  const mockUserService = {
    user: of({ token: 'mock-token', name: 'Mock User' }),
    logout: () => {}
  };

  const mockUndoService = {
    registerUnDo: () => {},
    registerAutosave: () => {},
    beforeChange: () => {},
    undo: () => {}
  };

  const mockStatusLineService = {
    error: () => {},
    success: () => {},
    info: () => {},
    warning: () => {}
  };

  const mockNgbModal = {
    open: () => {}
  };

  const mockToolsService = {
    addStack: () => {},
    remove: () => {}
  };

  const mockDragStateService = {
    setRootData: () => {}
  };

  const mockNavigationService = {
    openIiifViewerForFolio: () => {}
  };

  const mockMeiExportService = {
    export: () => {}
  };

  const mockPageTitleService = {
    set: () => {}
  };

  const mockFocusService = {
    preferredFocus: 'Notes',
    mode: { kind: 'Normal' }
  };

  beforeEach(waitForAsync(() => {
    TestBed.configureTestingModule({
      declarations: [ DocumentComponent ],
      imports: [ RouterTestingModule ],
      schemas: [ NO_ERRORS_SCHEMA ],
      providers: [
        { provide: ActivatedRoute, useValue: mockActivatedRoute },
        { provide: APIService, useValue: mockAPIService },
        { provide: UserService, useValue: mockUserService },
        { provide: UndoService, useValue: mockUndoService },
        { provide: StatusLineService, useValue: mockStatusLineService },
        { provide: NgbModal, useValue: mockNgbModal },
        { provide: ToolsService, useValue: mockToolsService },
        { provide: DragStateService, useValue: mockDragStateService },
        { provide: NavigationService, useValue: mockNavigationService },
        { provide: MeiExportService, useValue: mockMeiExportService },
        { provide: PageTitleService, useValue: mockPageTitleService },
        { provide: FocusService, useValue: mockFocusService }
      ]
    })
    .compileComponents();
  }));

  beforeEach(() => {
    fixture = TestBed.createComponent(DocumentComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
