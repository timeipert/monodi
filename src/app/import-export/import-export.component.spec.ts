import { CommonModule } from '@angular/common';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { of } from 'rxjs';
import { APIService } from '../api.service';
import { CantusIndexService } from '../cantus-index.service';
import { PageTitleService } from '../page-title.service';
import { StatusLineService } from '../status-line.service';
import { UserService } from '../user.service';
import { VolpianoService } from '../volpiano.service';
import { findAction } from './import-export-actions';
import { ImportExportComponent } from './import-export.component';

describe('ImportExportComponent', () => {
  let fixture: ComponentFixture<ImportExportComponent>;
  let component: ImportExportComponent;
  let router: jasmine.SpyObj<Router>;
  const el = () => fixture.nativeElement as HTMLElement;

  beforeEach(async () => {
    router = jasmine.createSpyObj<Router>('Router', ['navigate']);
    await TestBed.configureTestingModule({
      declarations: [ImportExportComponent],
      imports: [CommonModule, FormsModule],
      schemas: [NO_ERRORS_SCHEMA],
      providers: [
        { provide: Router, useValue: router },
        { provide: UserService, useValue: { user: of({ user: 'u', roles: [], token: 't' }) } },
        { provide: APIService, useValue: {} },
        { provide: StatusLineService, useValue: { success() {}, error() {}, info() {} } },
        { provide: PageTitleService, useValue: { set() {} } },
        { provide: VolpianoService, useValue: {} },
        { provide: CantusIndexService, useValue: {} },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(ImportExportComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('shows the two columns Import and Export with every action once, as title and format', () => {
    const cols = Array.from(el().querySelectorAll('.io-col-title')).map((h) => h.textContent!.trim());
    expect(cols).toEqual(['Import', 'Export']);
    const rows = Array.from(el().querySelectorAll('.io-row'));
    const all = [...component.importSections, ...component.exportSections].flatMap((s) => s.actions);
    expect(rows.length).toBe(all.length);
    expect(rows[0].querySelector('.io-format')!.textContent!.trim()).toBe(all[0].format);
    expect(rows[0].getAttribute('title')).toContain(all[0].keeps);
  });

  it('opens the repository dialog, and sends the other actions to the Sources page', () => {
    component.run(findAction('repository')!);
    expect(component.showRepositoryDialog).toBeTrue();
    component.run(findAction('import-zip')!);
    expect(router.navigate).toHaveBeenCalledWith(['/sources'], { queryParams: { ws: 'import-zip' } });
  });
});
