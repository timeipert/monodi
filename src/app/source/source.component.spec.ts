import { waitForAsync, ComponentFixture, TestBed } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { of, throwError } from 'rxjs';
import { convertToParamMap, ActivatedRoute } from '@angular/router';
import { NO_ERRORS_SCHEMA } from '@angular/core';

import { SourceComponent } from './source.component';
import { APIService } from '../api.service';
import { UserService } from '../user.service';
import { ToastrService } from 'ngx-toastr';
import { ToolsService } from '../tools.service';
import { PageTitleService } from '../page-title.service';

describe('SourceComponent', () => {
  let component: SourceComponent;
  let fixture: ComponentFixture<SourceComponent>;

  const mockActivatedRoute = {
    paramMap: of(convertToParamMap({ id: 'mock-source-id' })),
    queryParamMap: of(convertToParamMap({})),
    queryParams: of({}),
    snapshot: {
      paramMap: convertToParamMap({ id: 'mock-source-id' }),
      queryParamMap: convertToParamMap({})
    }
  };

  const mockAPIService = {
    getSettings: () => of({ kind: 'SettingsRetrieved', settings: {} }),
    getSource: () => of({ kind: 'SourceRetrieved', source: { id: 'mock-source-id', quellensigle: 'Sigle', custom: {} } }),
    listDocuments: () => of({ kind: 'DocumentsRetrieved', documents: [] }),
    createSource: () => of({ kind: 'SourceCreated', id: 'mock-id' }),
    updateSource: () => of({ kind: 'Ok' }),
    removeDocument: () => of({ kind: 'Ok' }),
    updateSettings: () => of({ kind: 'Ok' }),
    getDocumentNotes: () => of({ kind: 'NotesRetrieved', data: { children: [] } })
  };

  const mockUserService = {
    user: of({ token: 'mock-token', name: 'Mock User' }),
    logout: () => {}
  };

  const mockToastrService = {
    error: () => {},
    success: () => {},
    info: () => {},
    warning: () => {}
  };

  const mockToolsService = {
    addStack: () => {},
    remove: () => {}
  };

  const mockPageTitleService = {
    set: () => {}
  };

  beforeEach(waitForAsync(() => {
    TestBed.configureTestingModule({
      declarations: [ SourceComponent ],
      imports: [ RouterTestingModule ],
      schemas: [ NO_ERRORS_SCHEMA ],
      providers: [
        { provide: ActivatedRoute, useValue: mockActivatedRoute },
        { provide: APIService, useValue: mockAPIService },
        { provide: UserService, useValue: mockUserService },
        { provide: ToastrService, useValue: mockToastrService },
        { provide: ToolsService, useValue: mockToolsService },
        { provide: PageTitleService, useValue: mockPageTitleService }
      ]
    })
    .compileComponents();
  }));

  beforeEach(() => {
    fixture = TestBed.createComponent(SourceComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('saving', () => {
    it('keeps saving after a save failed, and says so', () => {
      const update = spyOn(mockAPIService, 'updateSource').and.returnValues(
        throwError(() => new Error('The storage is full')) as any,
        of({ kind: 'Ok' }) as any);
      const toast = spyOn(mockToastrService, 'error');

      component.update();                       // fails
      expect(component.isSaving).toBeFalse();
      expect(toast).toHaveBeenCalledTimes(1);
      expect(String((toast.calls.mostRecent().args as unknown[])[0])).toContain('The storage is full');

      component.update();                       // the next one must really run
      expect(update).toHaveBeenCalledTimes(2);
      expect(component.isSaving).toBeFalse();
    });

    it('does not tell the person again for every failed autosave in a row', () => {
      spyOn(mockAPIService, 'updateSource').and.returnValue(throwError(() => new Error('full')) as any);
      const toast = spyOn(mockToastrService, 'error');
      component.update(); component.update(); component.update();
      expect(toast).toHaveBeenCalledTimes(1);
    });
  });
});
