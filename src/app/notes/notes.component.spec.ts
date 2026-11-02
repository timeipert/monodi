import { waitForAsync, ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { NotesComponent } from './notes.component';
import { FocusService } from '../focus.service';
import { ToastrService } from 'ngx-toastr';
import { ToolsService } from '../tools.service';
import { UndoService } from '../undoService';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { ContextMenuService } from '../context-menu/context-menu.service';

describe('NotesComponent', () => {
  let component: NotesComponent;
  let fixture: ComponentFixture<NotesComponent>;

  const mockFocusService = {
    meiEditors: new Map(),
    focusedNoteUUID$: of(null),
    preferredFocus: 'Notes',
    mode: { kind: 'Normal' }
  };

  const mockToastrService = {
    info: () => {},
    warning: () => {},
    error: () => {},
    success: () => {}
  };

  const mockToolsService = {
    addStack: () => {},
    remove: () => {}
  };

  const mockUndoService = {
    deregisterNotesCallbacks: () => {}
  };

  const mockNgbModal = {
    open: () => {}
  };

  const mockContextMenuService = {
    open: () => {}
  };

  beforeEach(waitForAsync(() => {
    TestBed.configureTestingModule({
      declarations: [ NotesComponent ],
      providers: [
        { provide: FocusService, useValue: mockFocusService },
        { provide: ToastrService, useValue: mockToastrService },
        { provide: ToolsService, useValue: mockToolsService },
        { provide: UndoService, useValue: mockUndoService },
        { provide: NgbModal, useValue: mockNgbModal },
        { provide: ContextMenuService, useValue: mockContextMenuService }
      ]
    })
    .compileComponents();
  }));

  beforeEach(() => {
    fixture = TestBed.createComponent(NotesComponent);
    component = fixture.componentInstance;
    component.model = {
      uuid: 'syl-1',
      notes: { spaced: [] },
      text: 'Crux',
      syllableType: 'Normal'
    } as any;
    component.comments = [];
    component.readOnly = false;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should correctly identify highlighted notes', () => {
    component.highlightNoteUUIDs = new Set(['note-1', 'note-2']);
    const mockDrawable1 = { ref: { uuid: 'note-1' } } as any;
    const mockDrawable2 = { ref: { uuid: 'note-3' } } as any;
    expect(component.isHighlighted(mockDrawable1)).toBeTrue();
    expect(component.isHighlighted(mockDrawable2)).toBeFalse();
  });

  it('should scale stave widths and default sizes by staffScale input', () => {
    component.staffScale = 1.0;
    const baseWidth = component.getWidth();

    component.staffScale = 0.8;
    const scaledWidth = component.getWidth();

    expect(scaledWidth).toBeCloseTo(baseWidth * 0.8, 5);
  });
});
