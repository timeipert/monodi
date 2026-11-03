import { waitForAsync, ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { NotesComponent } from './notes.component';
import { FocusService } from '../focus.service';
import { ToastrService } from 'ngx-toastr';
import { ToolsService } from '../tools.service';
import { UndoService } from '../undoService';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { ContextMenuService } from '../context-menu/context-menu.service';
import { SyllableType } from '../types/model';

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
    deregisterNotesCallbacks: () => {},
    beforeChange: () => {},
    registerNotesCallbacks: () => {}
  };

  const mockNgbModal = {
    open: () => {}
  };

  const mockContextMenuService = {
    open: jasmine.createSpy('open')
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

  describe('syllable types', () => {
    const staffLines = () => fixture.nativeElement.querySelectorAll('svg line').length;
    const render = () => { (component as any).cdr.markForCheck(); fixture.detectChanges(); };
    const menuItem = () => mockContextMenuService.open.calls.mostRecent().args[1].find((i: any) => i.label === 'Syllable type');

    beforeEach(() => mockContextMenuService.open.calls.reset());

    it('draws the staff for a normal syllable, also without notes, and no staff for the other types', () => {
      component.showGClef = true;
      component.model.syllableType = SyllableType.Normal;
      render();
      expect(staffLines()).toBe(5);
      expect(fixture.nativeElement.querySelector('.auto-clef')).not.toBeNull();
      for (const type of [SyllableType.WithoutNotes, SyllableType.SourceEllipsis, SyllableType.EditorialEllipsis]) {
        component.model.syllableType = type;
        render();
        expect(staffLines()).withContext(type).toBe(0);
        expect(fixture.nativeElement.querySelector('.auto-clef')).withContext(type).toBeNull();
      }
    });

    it('tints the place of a syllable without staff only while it has the focus', () => {
      component.model.syllableType = SyllableType.WithoutNotes;
      render();
      expect(fixture.nativeElement.querySelector('.bare-focus')).toBeNull();
      component.hasFocus[0] = true;
      render();
      expect(fixture.nativeElement.querySelector('.bare-focus')).not.toBeNull();
    });

    it('offers the type in the menu of the staff and of the text, marking the current one', () => {
      const event = new MouseEvent('contextmenu');
      for (const open of [() => component.onStaffContextMenu(event), () => component.onSyllableContextMenu(event)]) {
        component.model.syllableType = SyllableType.WithoutNotes;
        open();
        expect(menuItem().children.length).toBe(4);
        expect(menuItem().children.filter((c: any) => c.checked).map((c: any) => c.label)).toEqual(['Without notes (no staff)']);
      }
    });

    it('sets the chosen type from the menu', () => {
      component.model.syllableType = SyllableType.Normal;
      component.onStaffContextMenu(new MouseEvent('contextmenu'));
      menuItem().children.find((c: any) => c.label.startsWith('Source ellipsis')).action();
      expect(component.model.syllableType).toBe(SyllableType.SourceEllipsis);
    });

    it('cycles through all types with the tool bar action', () => {
      component.model.syllableType = SyllableType.Normal;
      const seen = [1, 2, 3, 4].map(() => { component.changeType(); return component.model.syllableType; });
      expect(seen).toEqual([SyllableType.WithoutNotes, SyllableType.SourceEllipsis, SyllableType.EditorialEllipsis, SyllableType.Normal]);
    });
  });
});
