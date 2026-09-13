import { waitForAsync, ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { RouterTestingModule } from '@angular/router/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';

import { SourcesOverviewComponent } from './sources-overview.component';
import { APIService } from '../api.service';
import { UserService } from '../user.service';
import { ToastrService } from 'ngx-toastr';
import { PageTitleService } from '../page-title.service';

describe('SourcesOverviewComponent', () => {
  let component: SourcesOverviewComponent;
  let fixture: ComponentFixture<SourcesOverviewComponent>;

  const mockAPIService = {
    listSources: () => of({ kind: 'SourcesRetrieved', sources: [] }),
    listDocuments: () => of({ kind: 'DocumentsRetrieved', documents: [] }),
    createSource: () => of({ kind: 'SourceCreated', id: 'mock-id' }),
    removeSource: () => of({ kind: 'Ok' })
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

  const mockPageTitleService = {
    set: () => {}
  };

  beforeEach(waitForAsync(() => {
    TestBed.configureTestingModule({
      declarations: [ SourcesOverviewComponent ],
      imports: [ RouterTestingModule ],
      schemas: [ NO_ERRORS_SCHEMA ],
      providers: [
        { provide: APIService, useValue: mockAPIService },
        { provide: UserService, useValue: mockUserService },
        { provide: ToastrService, useValue: mockToastrService },
        { provide: PageTitleService, useValue: mockPageTitleService }
      ]
    })
    .compileComponents();
  }));

  beforeEach(() => {
    fixture = TestBed.createComponent(SourcesOverviewComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
