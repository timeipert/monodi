import { waitForAsync, ComponentFixture, TestBed } from '@angular/core/testing';
import { CommentComponent } from './comment.component';
import { FormsModule } from '@angular/forms';
import { NgbActiveModal, NgbModule, NgbPopoverModule } from '@ng-bootstrap/ng-bootstrap';
import { ToastrService } from 'ngx-toastr';
import { CUSTOM_ELEMENTS_SCHEMA, NO_ERRORS_SCHEMA } from '@angular/core';

describe('CommentComponent', () => {
  let component: CommentComponent;
  let fixture: ComponentFixture<CommentComponent>;

  const mockToastrService = {
    warning: () => {},
    info: () => {},
    error: () => {},
    success: () => {}
  };

  const mockActiveModal = {
    close: () => {},
    dismiss: () => {}
  };

  beforeEach(waitForAsync(() => {
    TestBed.configureTestingModule({
      declarations: [ CommentComponent ],
      imports: [ FormsModule, NgbModule, NgbPopoverModule ],
      schemas: [ NO_ERRORS_SCHEMA, CUSTOM_ELEMENTS_SCHEMA ],
      providers: [
        { provide: ToastrService, useValue: mockToastrService },
        { provide: NgbActiveModal, useValue: mockActiveModal }
      ]
    })
    .compileComponents();
  }));

  beforeEach(() => {
    fixture = TestBed.createComponent(CommentComponent);
    component = fixture.componentInstance;
    component.comments = [];
    component.originals = [];
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('Deferred deletion and undo behavior', () => {
    let mockComment1: any;
    let mockComment2: any;
    let emittedValues: any[];

    beforeEach(() => {
      mockComment1 = { text: 'Comment 1', commentType: 'text' };
      mockComment2 = { text: 'Comment 2', commentType: 'text' };
      component.comments = [mockComment1, mockComment2];
      component.originals = [{} as any, {} as any];
      emittedValues = [];
      component.saveEvent.subscribe((val) => {
        emittedValues.push(JSON.parse(JSON.stringify(val)));
      });
      component.ngOnInit();
    });

    it('(a) soft-delete then undo -> comments array unchanged and no null emitted', () => {
      // First click on delete button to arm it
      component.deleteComment(mockComment1);
      expect(component.isArmed).toBe(true);

      // Second click to soft-delete
      component.deleteComment(mockComment1);
      expect(component.pendingDeletion).toEqual({ index: 0, comment: mockComment1 });
      expect(component.comments[0]).toBe(mockComment1); // Still holds the object
      expect(emittedValues.length).toBe(0); // No emission yet

      // Undo deletion
      component.undoDeletion();
      expect(component.pendingDeletion).toBeNull();
      expect(component.comments[0]).toBe(mockComment1);
      expect(emittedValues.length).toBe(0); // Still no emission
    });

    it('(b) soft-delete then commit -> slot nulled and exactly one emission containing the null', () => {
      // Arm and soft-delete
      component.deleteComment(mockComment1);
      component.deleteComment(mockComment1);

      // Commit deletion
      component.commitPendingDeletion();
      expect(component.comments[0]).toBeNull();
      expect(emittedValues.length).toBe(1);
      expect(emittedValues[0][0]).toBeNull();
      expect(emittedValues[0][1]).toEqual(mockComment2);
    });

    it('(c) deleting a second comment commits the first', () => {
      // Delete comment 1 (arm + delete)
      component.deleteComment(mockComment1);
      component.deleteComment(mockComment1);
      expect(component.pendingDeletion?.comment).toBe(mockComment1);
      expect(emittedValues.length).toBe(0);

      // Delete comment 2 (arm + delete) - should commit the first
      component.deleteComment(mockComment2);
      component.deleteComment(mockComment2);
      
      // The first should be committed
      expect(component.comments[0]).toBeNull();
      // Exactly one emission representing the first deletion
      expect(emittedValues.length).toBe(1);
      expect(emittedValues[0][0]).toBeNull();
      expect(emittedValues[0][1]).toEqual(mockComment2);
      
      // And the second comment should now be pending
      expect(component.pendingDeletion?.comment).toBe(mockComment2);
    });
  });
});

