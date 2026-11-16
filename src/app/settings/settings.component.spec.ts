import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { SettingsComponent } from './settings.component';
import { APIService } from '../api.service';
import { UserService } from '../user.service';
import { GithubService } from '../github.service';
import { PageTitleService } from '../page-title.service';
import { StatusLineService } from '../status-line.service';
import { ActivatedRoute } from '@angular/router';

describe('SettingsComponent', () => {
  let component: SettingsComponent;
  let fixture: ComponentFixture<SettingsComponent>;

  const mockAPIService = {
    getSettings: () => of({ kind: 'SettingsRetrieved', settings: {} }),
    updateSettings: () => of({ kind: 'Ok' }),
    storagePersisted: null
  };

  const mockUserService = {
    user: of({ token: 'mock-token', name: 'Mock User' })
  };

  const mockGithubService = {
    config: { token: '', owner: '', repo: '', branch: 'main' },
    saveConfig: () => {},
    testConnection: () => Promise.resolve(true),
    clearConfig: () => {}
  };

  const mockPageTitleService = {
    set: () => {}
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      declarations: [SettingsComponent],
      providers: [
        { provide: APIService, useValue: mockAPIService },
        { provide: UserService, useValue: mockUserService },
        { provide: GithubService, useValue: mockGithubService },
        { provide: PageTitleService, useValue: mockPageTitleService },
        { provide: StatusLineService, useValue: { success: () => {}, error: () => {} } },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParams: {} }, queryParamMap: of({ get: () => null }) } }
      ],
      schemas: [ NO_ERRORS_SCHEMA ]
    });
    fixture = TestBed.createComponent(SettingsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
