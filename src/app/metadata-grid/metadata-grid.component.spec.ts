import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { ScrollingModule } from '@angular/cdk/scrolling';
import { RouterTestingModule } from '@angular/router/testing';
import { Observable, of, throwError } from 'rxjs';
import { ToastrService } from 'ngx-toastr';

import { MetadataGridComponent } from './metadata-grid.component';
import { APIService, Document, Source } from '../api.service';
import { BackupReminderService } from '../backup-reminder.service';
import { PageTitleService } from '../page-title.service';
import { UserService } from '../user.service';

function doc(i: number, label: string, source = 'src1'): Document {
  return { id: 'd' + i, quelle_id: source, dokumenten_id: label, gattung1: '', gattung2: '', festtag: '', feier: '', textinitium: '', bibliographischerverweis: '', druckausgabe: '', zeilenstart: '', foliostart: '', kommentar: '', editionsstatus: '' };
}

const SOURCE: Source = { id: 'src1', quellensigle: 'Cod 1', herkunftsregion: '', herkunftsort: '', herkunftsinstitution: '', ordenstradition: '', quellentyp: '', bibliotheksort: '', bibliothek: '', bibliothekssignatur: '', kommentar: '', datierung: '' };

describe('MetadataGridComponent', () => {
  let fixture: ComponentFixture<MetadataGridComponent>;
  let component: MetadataGridComponent;
  let documents: Document[];
  let deleteDocuments: jasmine.Spy;
  let updateDocumentsMetadata: jasmine.Spy;

  async function create(deleteResult: () => Observable<unknown> = () => of({ kind: 'UploadFinished', errors: [] })) {
    deleteDocuments = jasmine.createSpy('deleteDocuments').and.callFake((_t: string, data: string) => {
      const gone = new Set(JSON.parse(data) as string[]);
      documents = documents.filter((d) => !gone.has(d.id));
      return deleteResult();
    });
    updateDocumentsMetadata = jasmine.createSpy('updateDocumentsMetadata').and.callFake((_t: string, patches: { id: string; fields: Record<string, string> }[]) => {
      documents = documents.map((d) => { const p = patches.find((x) => x.id === d.id); return p ? { ...d, ...p.fields } : d; });
      return of({ kind: 'MetadataUpdated', updated: patches.length, missing: 0, rejectedFields: 0 });
    });
    await TestBed.configureTestingModule({
      declarations: [MetadataGridComponent],
      imports: [FormsModule, ScrollingModule, RouterTestingModule],
      providers: [
        {
          provide: APIService,
          useValue: {
            listSources: () => of({ kind: 'SourcesRetrieved', sources: [SOURCE] }),
            listDocuments: () => of({ kind: 'DocumentsRetrieved', documents }),
            getSettings: () => of({ kind: 'SettingsRetrieved', settings: {} }),
            deleteDocuments,
            updateDocumentsMetadata,
            updateSourcesMetadata: () => of({ kind: 'MetadataUpdated', updated: 0, missing: 0, rejectedFields: 0 }),
            deleteSources: () => of({ kind: 'UploadFinished', errors: [] }),
          },
        },
        { provide: UserService, useValue: { user: of({ token: 't', user: 'u', roles: [] }), logout: () => {} } },
        { provide: ToastrService, useValue: { success: () => {}, error: () => {}, info: () => {}, warning: () => {} } },
        { provide: PageTitleService, useValue: { set: () => {} } },
        { provide: BackupReminderService, useValue: { hasUnbackedChanges: () => false } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(MetadataGridComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function filterEndingOnGs() {
    component.addFilter();
    const f = component.view!.filters[0];
    f.column = 'dokumenten_id';
    f.op = 'endsWith';
    f.value = 'GS';
    component.filtersChanged();
  }

  function selectEndingOnGs() {
    filterEndingOnGs();
    component.view!.toggleAll();
  }

  beforeEach(() => {
    documents = [];
    for (let i = 0; i < 30; i++) documents.push(doc(i, i % 2 ? `Pa ${i} GS` : `Pa ${i}`));
    documents.push(doc(100, 'GS Pa 100'), doc(101, 'Pa 101 GSX'));
  });

  it('shows every document of every source, as one table', async () => {
    await create();
    expect(component.view!.rowCount).toBe(32);
    expect(component.view!.columns[1].label).toBe('Source');
  });

  it('deletes exactly the rows whose ID ends on GS, after the count has been typed', async () => {
    await create();
    selectEndingOnGs();
    expect(component.view!.selectedCount).toBe(15);
    component.askDelete();
    expect(component.requiredTyping).toBe('15');
    expect(component.canConfirmDelete).toBeFalse();
    component.typedCount = '14';
    expect(component.canConfirmDelete).toBeFalse();
    component.typedCount = '15';
    expect(component.canConfirmDelete).toBeTrue();

    await component.confirmDelete();

    expect(deleteDocuments).toHaveBeenCalledTimes(1);
    const sent = new Set(JSON.parse(deleteDocuments.calls.mostRecent().args[1]) as string[]);
    expect(sent.size).toBe(15);
    expect(Array.from(sent).every((id) => documents.every((d) => d.id !== id))).toBeTrue();
    expect(documents.length).toBe(17);                          // "GS Pa 100" and "Pa 101 GSX" were not touched
    expect(component.showDelete).toBeFalse();
    expect(component.view!.rowCount).toBe(17);                  // reloaded, filter kept
    expect(component.view!.filters.length).toBe(1);
  });

  it('a small deletion needs no typed confirmation', async () => {
    await create();
    component.view!.toggleAt(0);
    component.view!.toggleAt(1);
    component.askDelete();
    expect(component.requiredTyping).toBeNull();
    expect(component.canConfirmDelete).toBeTrue();
  });

  it('only what is visible can be deleted: narrowing the filter drops the rest of the selection', async () => {
    await create();
    component.view!.toggleAll();
    expect(component.view!.selectedCount).toBe(32);
    filterEndingOnGs();
    expect(component.view!.selectedIds().length).toBe(15);
  });

  it('a failing delete leaves the dialog usable (busy flag cleared) and the documents alone', async () => {
    spyOn(console, 'warn');   // the component logs the failure
    await create(() => throwError(() => new Error('disk full')));
    selectEndingOnGs();
    component.askDelete();
    component.typedCount = '15';
    await component.confirmDelete();
    expect(component.deleteBusy).toBeFalse();
    expect(component.showDelete).toBeTrue();
  });

  describe('editing', () => {
    it('collects edits, sends them in one call on save and shows the stored result afterwards', async () => {
      await create();
      const view = component.view!;
      view.selectCell(0, 2);                          // Text Initium of the first row (default sort: by Document ID)
      component.startEdit(0, 2, 'Edited');
      component.commitEdit();
      view.selectCell(1, 2);
      component.startEdit(1, 2, 'Edited 2');
      component.commitEdit();
      expect(component.totalDirty).toBe(2);
      expect(component.hasChanges()).toBeTrue();
      expect(updateDocumentsMetadata).not.toHaveBeenCalled();     // nothing is written before Save

      await component.save();

      expect(updateDocumentsMetadata).toHaveBeenCalledTimes(1);
      const patches = updateDocumentsMetadata.calls.mostRecent().args[1] as { id: string; fields: Record<string, string> }[];
      expect(patches.length).toBe(2);
      expect(patches.every((p) => Object.keys(p.fields).join() === 'textinitium')).toBeTrue();
      expect(component.hasChanges()).toBeFalse();
      expect(component.view!.cellValue(0, 2)).toBe('Edited');      // rebuilt from what is stored
    });

    it('keeps the edits when saving fails, and the save button works again', async () => {
      await create();
      spyOn(console, 'warn');
      component.startEdit(0, 2, 'Edited');
      component.commitEdit();
      updateDocumentsMetadata.and.returnValue(throwError(() => new Error('quota')));
      await component.save();
      expect(component.saveBusy).toBeFalse();
      expect(component.hasChanges()).toBeTrue();
    });

    it('refuses to delete while there are unsaved edits (the tables would be rebuilt and the edits lost)', async () => {
      await create();
      component.startEdit(0, 2, 'Edited');
      component.commitEdit();
      component.view!.toggleAll();
      component.askDelete();
      expect(component.showDelete).toBeFalse();
    });

    it('does not open an editor in a read-only column, and refuses an empty value in a required one', async () => {
      await create();
      component.startEdit(0, 1, 'x');                 // Source
      expect(component.editing).toBeNull();
      const id = component.view!.cellValue(0, 0);
      component.startEdit(0, 0, '');
      component.commitEdit();
      expect(component.view!.cellValue(0, 0)).toBe(id);
      expect(component.hasChanges()).toBeFalse();
    });
  });
});
