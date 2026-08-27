import { ChangeDetectorRef, ViewChildren, QueryList, Component, OnInit, OnDestroy, Input } from '@angular/core';
import { Subscription } from 'rxjs';
import * as S from './Section';
import * as Model from '../types/model';
import * as MS from '../types/modelStorage';
import { Event, PasteRequested, MoveRequested, NewCommentRequested } from './Event';
import { ToastrService } from 'ngx-toastr';
import { Focusable } from "../types/Focus";
import { ResolveCommentSpansRequested, CommentDeletionRequested, LineFocusShiftRequest } from "../types/CommonEvent";
import { UndoService } from '../undoService';
import { DragStateService } from '../dragger/drag-state.service';
import { NavigationService } from '../notationsdokumentation/navigation.service';

@Component({
  selector: 'app-root-section',
  templateUrl: './section.component.html',
  styleUrls: ['./section.component.scss']
})
export class RootSectionComponent extends S.Section<Model.RootContainer> implements OnInit, OnDestroy {
  @ViewChildren("sub")
  children!: QueryList<Focusable>;

  @Input() sourceId?: string;

  private mapDropSub = new Subscription();

  constructor(private toaster: ToastrService, private cdr: ChangeDetectorRef, private undoService: UndoService, private dragState: DragStateService, private navService: NavigationService) {
    super("Edition unit", {
      StaleCommentRemovealRequested: (e: any, oldIndex: number) => { Model.removeStaleComments(this.data); },
      NewCommentRequested: (e: NewCommentRequested, oldIndex: number) => {
        this.undo.beforeChange();
        // Decide ordering using the *full* document, not a single line. This
        // is the only place that has access to the whole RootContainer, so
        // it is also the only place that can resolve UUIDs across lines.
        let startUUID = e.startUUID;
        let endUUID = e.endUUID;
        if (e.endKind !== undefined && e.endKind !== Model.CommentPartKind.Syllable) {
          const all = Model.getAllCommentableUUIDs(this.data);
          const iStart = all.indexOf(startUUID);
          const iEnd = all.indexOf(endUUID);
          if (iStart >= 0 && iEnd >= 0 && iEnd < iStart) {
            // user clicked an earlier note as their second pick — swap so
            // that startUUID always precedes endUUID in document order
            [startUUID, endUUID] = [endUUID, startUUID];
          }
        }
        const newComment: Model.Comment = { startUUID, endUUID, text: e.text, commentType: 'text', emendation: false };
        this.data.comments = this.data.comments.concat([newComment]);
        this.onEvent.emit({ kind: 'OpenCommentModalRequested', comment: newComment });
      },
      CommentDeletionRequested: (e: CommentDeletionRequested, oldIndex: number) => { this.undo.beforeChange(); this.data.comments = this.data.comments.filter(c => c !== e.comment); },
      NoFocusRequested: (e: Event, oldIndex: number) => { Model.removeFocus(this.data); setTimeout(() => cdr.detectChanges(), 0); },
      NewParatextRequested: (e: Event, oldIndex: number) => { this.undo.beforeChange(); this.newAt(Model.emptyParatextContainer(), oldIndex + 1); },
      NewFormteilRequested: (e: Event, oldIndex: number) => { this.newFormteilAt(oldIndex + 1); },
      DeletionRequested: (e: Event, oldIndex: number) => {
        const child = this.data.children[oldIndex];
        if (child && child.kind === Model.ContainerKind.FormteilContainer) {
          const formteilCount = this.data.children.filter(c => c.kind === Model.ContainerKind.FormteilContainer).length;
          if (formteilCount <= 1) {
            this.toaster.warning("This section cannot be deleted because it is the only one at this level.");
            return;
          }
        }
        this.undo.beforeChange();
        this.data.children.splice(oldIndex, 1);
        Model.removeStaleComments(this.data);
      },
      NewNoteLineRequsted: (e: any, oldIndex: number) => {
        this.undo.beforeChange();
        this.newAt(e.container, oldIndex + 1);
      },
      MergeWithNextLineRequested: (e: any, oldIndex: number) => {
        this.undo.beforeChange();
        const lines = Model.getAllLineContainers(this.data);
        const idx = lines.findIndex(l => l.uuid === e.uuid);
        if (idx >= 0 && lines[idx + 1]) {
          const current = lines[idx];
          const next = lines[idx + 1];
          current.children.push(...next.children);
          Model.remove(this.data, next);
          Model.removeStaleComments(this.data);
          this.cdr.detectChanges();
        } else {
          this.toaster.warning("There is no following line to merge with.");
        }
      },
      MergeSectionRequested: (e: any, oldIndex: number) => {
        this.undo.beforeChange();
        const res = Model.findParentContainer(this.data, e.uuid);
        if (res) {
          const { parent, index } = res;
          const parentContainer = parent as any;
          const current = parentContainer.children[index];
          const next = parentContainer.children[index + 1];
          if (current && next && current.kind === Model.ContainerKind.FormteilContainer && next.kind === Model.ContainerKind.FormteilContainer) {
            current.children.push(...next.children);
            parentContainer.children.splice(index + 1, 1);
            Model.removeStaleComments(this.data);
            this.cdr.detectChanges();
          } else {
            this.toaster.warning("There is no following section to merge with.");
          }
        }
      },
      DeleteSectionKeepContentRequested: (e: any, oldIndex: number) => {
        this.undo.beforeChange();
        const res = Model.findParentContainer(this.data, e.uuid);
        if (res) {
          const { parent, index } = res;
          const parentContainer = parent as any;
          const formteilCount = parentContainer.children.filter((c: any) => c.kind === Model.ContainerKind.FormteilContainer).length;
          if (formteilCount <= 1) {
            this.toaster.warning("This section cannot be deleted because it is the only one at this level.");
            return;
          }
          const node = parentContainer.children[index];
          if (node) {
            if (node.children && node.children.length > 0) {
              parentContainer.children.splice(index, 1, ...node.children);
            } else {
              parentContainer.children.splice(index, 1);
            }
            Model.removeStaleComments(this.data);
            this.cdr.detectChanges();
          }
        }
      },
      SplitSectionAtLineRequested: (e: any, oldIndex: number) => {
        this.undo.beforeChange();
        Model.splitTreeAtLine(this.data, e.lineUuid, e.splitLevel);
        Model.removeStaleComments(this.data);
        this.cdr.detectChanges();
      },
      MoveRequested: (e: MoveRequested, oldIndex: number) => {
        this.undo.beforeChange();
        const errorMessage = Model.move(this.data, e.from, e.to);
        if (errorMessage !== undefined) {
          this.toaster.error(errorMessage);
        }
        this.cdr.detectChanges();
      },
      PasteRequested: (e: PasteRequested) => this.insert(e.at, e.withoutNotes, e.withoutText),
      ResolveCommentSpansRequested: (e: ResolveCommentSpansRequested) => e.onResolve.next(e.spans.map(s => Model.extractComment(this.data, s))),
      LineFocusShiftRequest: (e: LineFocusShiftRequest) => { this.shiftFocusToNextLine(e) },
      ViewIiifRequested: (e: any) => { 
        if (this.sourceId) this.navService.openIiifViewerForFolio(this.sourceId, e.folio); 
      },
      HighlightRegionRequested: (e: any) => {
        this.onEvent.emit(e);
      },
      FixSyllableDashesRequested: (e: any) => this.onEvent.emit(e),
      DocumentUpdated: (e: any) => this.onEvent.emit(e)
    }, undoService);
  }

  ngOnInit(): void {
    this.mapDropSub = this.dragState.dropFromMap$.subscribe(({ from, to }) => {
      this.undo.beforeChange();
      const errorMessage = Model.move(this.data, from, to);
      if (errorMessage !== undefined) {
        this.toaster.error(errorMessage);
      }
      this.cdr.detectChanges();
    });

    this.actionHandlers = {
      '+ L1': () => this.newFormteilAt(0),
      '+ Text': () => { this.undo.beforeChange(); this.newAt(Model.emptyParatextContainer(), 0); },
      'Paste after': () => { this.undo.beforeChange(); this.insert([], false, false) },
      'Paste after (discard notes)': () => { this.undo.beforeChange(); this.insert([], true, false) },
      'Paste after (discard text)': () => { this.undo.beforeChange(); this.insert([], false, true) },
      'Fix Syllable Dashes': () => {
        this.onEvent.emit({ kind: 'FixSyllableDashesRequested' as any } as any);
      }
    };
  }

  ngOnDestroy(): void {
    this.mapDropSub.unsubscribe();
  }

  shiftFocusToNextLine(e: LineFocusShiftRequest): void {
    const containsUUID = (node: any, targetUUID: string): boolean => {
      if (!node || !targetUUID) return false;
      if (node.uuid === targetUUID) return true;
      if (Array.isArray(node.children)) {
        return node.children.some((child: any) => containsUUID(child, targetUUID));
      }
      return false;
    };

    let index = this.data.children.findIndex(c => c.uuid === e.uuid);
    if (index < 0) {
      index = this.data.children.findIndex(c => containsUUID(c, e.uuid));
    }

    const nextIndex = index >= 0 ? index + e.direction : -1;
    const childrenArray = this.children.toArray();

    if (nextIndex >= 0 && nextIndex < childrenArray.length && childrenArray[nextIndex]) {
      childrenArray[nextIndex].focus({ focusLast: (e.direction < 0) });
    } else if (index >= 0 && index < childrenArray.length && childrenArray[index]) {
      childrenArray[index].focus({ focusLast: (e.direction > 0) });
    }
  }

  insert(at: number[], withoutNotes: boolean, withoutText: boolean): void {
    this.undo.beforeChange();
    const error = MS.insert(this.data, at, withoutNotes, withoutText);
    if (error === null) {
      this.toaster.success("Inserted successfully");
    } else {
      this.toaster.error(error);
    }
    this.cdr.markForCheck();
  }

  newFormteilAt(oldIndex: number): void {
    this.undo.beforeChange();
    const newData = Model.createNestedFormteilContainer(this.data.documentType, 1);
    this.data.children.splice(oldIndex, 0, newData);
    setTimeout(() => this.children.toArray().find(p => p.getData() === newData)!.focus({ focusLast: false }), 0);
  }

  newAt(child: any, newIndex: number) {
    this.undo.beforeChange();
    this.data.children.splice(newIndex, 0, child);
    setTimeout(() => {
      const focusTarget = this.children.toArray().find(sft => sft.getData() === child);
      if (focusTarget) focusTarget.focus({ focusLast: false });
    }, 0);
  }

  canBeDeleted(): boolean {
    return false;
  }

  documentTypes = [
    { value: 'Level0', label: '0' },
    { value: 'Level1', label: '1' },
    { value: 'Level2', label: '2' },
    { value: 'Level3', label: '3' }
  ];

  canChangeDocumentType(): boolean {
    return false;
  }

  /** Called by the button-group in the template. Sets the documentType AND always triggers
   *  structure initialisation — even when the user clicks the already-selected level. */
  setDocumentType(value: string): void {
    this.data.documentType = value as Model.DocumentType;
    this.onDocumentTypeChange();
  }

  onDocumentTypeChange(): void {
    if (this.data.children.length === 0) {
      this.undo.beforeChange();
      const level = this.data.documentType === 'Level0' ? 0 : (parseInt(this.data.documentType.replace(/level/i, ''), 10) || 1);

      let currentContainer: any = this.data;
      let zipperPath: number[] = [];

      for (let i = 0; i < level; i++) {
        const newFormteil = Model.emptyFormteilContainer(this.data.documentType, [...zipperPath, 0]);
        currentContainer.children.push(newFormteil);
        currentContainer = newFormteil;
        zipperPath.push(0);
      }

      const newLine = Model.emptyZeileContainer();
      currentContainer.children.push(newLine);

      this.cdr.detectChanges();
    } else {
      this.undo.beforeChange();
      Model.changeDocumentStructure(this.data, this.data.documentType);
      this.cdr.detectChanges();
    }
  }
}

