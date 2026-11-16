import { waitForAsync, ComponentFixture, TestBed } from '@angular/core/testing';
import { ClefComponent } from './clef.component';
import { FocusService } from '../focus.service';
import { ToolsService } from '../tools.service';
import { UndoService } from '../undoService';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { ContextMenuService } from '../context-menu/context-menu.service';
import { StatusLineService } from '../status-line.service';

describe('ClefComponent', () => {
  let component: ClefComponent;
  let fixture: ComponentFixture<ClefComponent>;

  const mockFocusService = {
    preferredFocus: 'Notes',
    mode: { kind: 'Normal' }
  };

  const mockToolsService = {
    addStack: () => {},
    remove: () => {}
  };

  const mockUndoService = {
    undo: () => {}
  };

  const mockNgbModal = {
    open: () => {}
  };

  const mockContextMenuService = {
    open: () => {}
  };

  const mockStatusLineService = {
    info: () => {},
    warning: () => {},
    error: () => {},
    success: () => {}
  };

  beforeEach(waitForAsync(() => {
    TestBed.configureTestingModule({
      declarations: [ ClefComponent ],
      providers: [
        { provide: FocusService, useValue: mockFocusService },
        { provide: ToolsService, useValue: mockToolsService },
        { provide: UndoService, useValue: mockUndoService },
        { provide: NgbModal, useValue: mockNgbModal },
        { provide: ContextMenuService, useValue: mockContextMenuService },
        { provide: StatusLineService, useValue: mockStatusLineService }
      ]
    })
    .compileComponents();
  }));

  beforeEach(() => {
    fixture = TestBed.createComponent(ClefComponent);
    component = fixture.componentInstance;
    component.model = {
      uuid: 'clef-1',
      shape: 'C',
      octave: 4,
      base: 'c',
      line: 3,
      focus: false
    } as any;
    component.comments = [];
    component.readOnly = false;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should accept staffScale input correctly', () => {
    component.staffScale = 1.2;
    expect(component.staffScale).toBe(1.2);
  });
});
