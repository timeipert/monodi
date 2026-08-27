import { ChangeDetectorRef, OnChanges, ViewChildren, QueryList, Component, OnDestroy, OnInit } from '@angular/core';
import * as S from './Section';
import * as Model from '../types/model';
import { Event, NewNoteLineRequsted } from './Event';
import { FocusShiftRequested, DeletionRequested, LineFocusShiftRequest } from '../types/CommonEvent';
import { handleFocusShiftFromChild, handleFocusChangeFromParent } from '../../utils';
import { Focusable, FocusChange } from "../types/Focus";
import { UndoService } from '../undoService';
import { ContextMenuService } from '../context-menu/context-menu.service';
import { ToastrService } from 'ngx-toastr';
import { FocusService } from '../focus.service';
import { ToolsService } from '../tools.service';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-formteil-section',
  templateUrl: './section.component.html',
  styleUrls: ['./section.component.scss']
})
export class FormteilSectionComponent extends S.Section<Model.FormteilContainer> implements OnChanges, Focusable, OnInit, OnDestroy {
  @ViewChildren("sub")
  children!: QueryList<Focusable>;

  deleteData(i: number): void {
    this.undo.beforeChange();
    this.data.data.splice(i, 1)
  }

  addData(newName: string): void {
    this.undo.beforeChange();
    let newData = { name: newName, data: "" };
    this.data.data.push(newData as Model.FormteilData);
  }

  setFormControl(e: string, index: number): void {
    this.undo.beforeChange();
    this.data.data[index].data = e;
  }

  getFormControlData(index: number): string {
    return this.data.data[index].data
  }

  private focusSub?: Subscription;

  constructor(
    undo: UndoService,
    private cdr: ChangeDetectorRef, 
    private contextMenuService: ContextMenuService, 
    private toastr: ToastrService,
    private focusService: FocusService,
    private toolService: ToolsService
  ) {
    super("Formteil", {
      'NewNoteLineRequsted': (e: Event, oldIndex: number) => {
        undo.beforeChange();
        let r = e as NewNoteLineRequsted;
        this.newAt(r.container, oldIndex + 1);
      },
      'NewParatextRequested': (e: Event, oldIndex: number) => { undo.beforeChange(); this.newAt(Model.emptyParatextContainer(), oldIndex + 1); },
      'DeletionRequested': (e: Event, oldIndex: number) => { undo.beforeChange(); this.deletionRequest(e as DeletionRequested, oldIndex) },
      'FocusShiftRequested': (e: Event, oldIndex: number) => this.focusShiftRequest(e as FocusShiftRequested, oldIndex),
      'LineFocusShiftRequest': (e: Event, oldIndex: number) => this.lineFocusShiftRequest(e as LineFocusShiftRequest, oldIndex),
      // A child container is requesting a new PEER sibling (same depth as itself).
      // This FormteilContainer is the parent — it creates the new child at `oldIndex + 1`.
      // Using this.zipper.concat([oldIndex+1]) keeps the depth correct.
      // Without this handler the event bubbles to the root which always creates depth-1 containers.
      'NewFormteilRequested': (e: Event, oldIndex: number) => {
        undo.beforeChange();
        this.newAt(
          Model.createNestedFormteilContainer(this.documentType, this.zipper.length + 1),
          oldIndex + 1
        );
      },
    }, undo);
  }

  lineFocusShiftRequest(e: LineFocusShiftRequest, oldIndex: number): void {
    const nextIndex = oldIndex + e.direction;
    const targetChild = this.children.toArray()[nextIndex];
    if (targetChild) {
      targetChild.focus({ focusLast: e.direction < 0 });
    } else {
      this.onEvent.emit({ kind: 'LineFocusShiftRequest', uuid: this.data.uuid, direction: e.direction });
    }
  }

  focusShiftRequest(e: FocusShiftRequested, oldIndex: number): void {
    if (this.children.get(oldIndex + e.direction)) {
      handleFocusShiftFromChild(e as FocusShiftRequested, this.children.toArray(), oldIndex, (e) => this.onEvent.emit(e));
    } else {
      this.onEvent.emit({ kind: 'LineFocusShiftRequest', uuid: this.data.uuid, direction: e.direction });
    }
  }

  deletionRequest(e: DeletionRequested, oldIndex: number): void {
    const child = this.data.children[oldIndex];
    if (child && child.kind === Model.ContainerKind.FormteilContainer) {
      const formteilCount = this.data.children.filter(c => c.kind === Model.ContainerKind.FormteilContainer).length;
      if (formteilCount <= 1) {
        this.toastr.warning("This section cannot be deleted because it is the only one at this level.");
        return;
      }
    }

    this.data.children.splice(oldIndex, 1); this.onEvent.emit({ kind: 'StaleCommentRemovealRequested' });
    if (this.data.children.length > 0) {
      if (oldIndex >= this.data.children.length) {
        if (e.focusLast) {
          this.children.toArray()[this.data.children.length - 1].focus({ focusLast: true });
        }
      } else if (oldIndex === 0) {
        if (!e.focusLast) {
          this.children.toArray()[1].focus({ focusLast: false });
        }
      } else {
        this.children.toArray()[oldIndex].focus({ focusLast: e.focusLast });
      }
    }
  }

  ngOnChanges(): void {

    this.actionHandlers = {};

    const docStruct = Model.getStructure(this.documentType);
    const structure = docStruct[this.zipper.length - 1];
    const currentLevelNum = this.zipper.length;
    
    // 1. Add line (Most specific)
    if (structure && structure.canHaveLines) {
      this.actionHandlers['+ Line'] = () => this.newAt(Model.emptyZeileContainer(), 0);
    }

    // 2. Add section (Peer level)
    this.actionHandlers['+ L' + currentLevelNum] = () => this.onEvent.emit({ 'kind': 'NewFormteilRequested' });

    // 3. Add sub section (Child level)
    const nextLevel = docStruct[this.zipper.length];
    if (nextLevel) {
      this.actionHandlers['+ L' + (currentLevelNum + 1)] = () => this.newAt(Model.createNestedFormteilContainer(this.documentType, currentLevelNum + 1), 0);
    }
    
    // 4. Add paratext (Additional metadata/text)
    this.actionHandlers['+ Text'] = () => { this.newAt(Model.emptyParatextContainer(), 0) };

  }

  getName(): string {
    const docStruct = Model.getStructure(this.documentType);
    const structure = docStruct[this.zipper.length - 1];
    return (structure && structure.name) || "";
  }

  getLevelName(): string {
    if (!this.levelNames) return "";
    const depth = this.zipper.length;
    if (depth === 1) return this.levelNames.level1 || "";
    if (depth === 2) return this.levelNames.level2 || "";
    if (depth === 3) return this.levelNames.level3 || "";
    return "";
  }

  newAt(model: Model.FormteilChildren, newIndex: number) {
    this.undo.beforeChange();
    this.data.children.splice(newIndex, 0, model);
    setTimeout(() => this.children.toArray().find(sft => sft.getData() === model)!.focus({ focusLast: false }), 0);
  }

  focus(change: FocusChange): void {
    handleFocusChangeFromParent(change, this.children.toArray());
  }

  getData(): any {
    return this.data;
  }

  setReference(value: boolean): void {
    (this.data as any).data.reference = value ? '' : undefined;
  }

  newDataName: Model.FormteilDataName[] = (() => {
    const nameObject: { [N in Model.FormteilDataName]: number } = {
      Signatur: 1,
      Status: 2,
      Verweis: 3,
      LemmatisiertesTextInitium: 4,
    }

    const ret = Object.keys(nameObject) as Model.FormteilDataName[];
    ret.sort((a, b) => nameObject[a] - nameObject[b]);
    return ret;
  })()

  override onContextMenu(me: MouseEvent): void {
    me.preventDefault();
    me.stopPropagation();

    const items: any[] = [];
    
    // Rename option
    items.push({
      label: 'Rename Section',
      action: () => {
        const sig = this.data.data.find(d => d.name === 'Signatur');
        const oldName = sig ? sig.data : '';
        const newName = prompt('New section name/signature:', oldName);
        if (newName !== null) {
          this.undo.beforeChange();
          if (sig) {
            sig.data = newName;
          } else {
            this.data.data.push({ name: Model.FormteilDataName.Signatur, data: newName });
          }
          this.cdr.detectChanges();
        }
      }
    });

    // Merge option
    items.push({
      label: 'Merge with Next Section',
      action: () => {
        this.onEvent.emit({ kind: 'MergeSectionRequested', uuid: this.data.uuid } as any);
      }
    });

    // Delete options:
    items.push({
      label: 'Delete Section & Content',
      action: () => {
        if (confirm('Are you sure you want to delete this section and all its contents?')) {
          this.onEvent.emit({ kind: 'DeletionRequested', focusLast: true });
        }
      }
    });

    this.contextMenuService.open(me, items, 'transcription', 'basic-layout');
  }

  ngOnInit(): void {
    this.focusSub = this.focusService.focusedContainerUUID$.subscribe((focusedUuid) => {
      if (focusedUuid !== this.data.uuid) {
        this.toolService.remove(this);
      }
      this.cdr.markForCheck();
    });
  }

  ngOnDestroy(): void {
    this.focusSub?.unsubscribe();
    this.toolService.remove(this);
  }

  isFocused(): boolean {
    return this.focusService.focusedContainerUUID === this.data.uuid;
  }

  selectContainer(event: MouseEvent): void {
    event.stopPropagation();

    // 1. Highlight this container
    this.focusService.focusedContainerUUID = this.data.uuid;

    // 2. Build and push container-specific tools to top toolbar
    const tools: any[] = [];

    // Rename Action
    tools.push({
      callback: () => {
        const sig = this.data.data.find(d => d.name === 'Signatur');
        const oldName = sig ? sig.data : '';
        const newName = prompt('New section name/signature:', oldName);
        if (newName !== null) {
          this.undo.beforeChange();
          if (sig) {
            sig.data = newName;
          } else {
            this.data.data.push({ name: Model.FormteilDataName.Signatur, data: newName });
          }
          this.cdr.detectChanges();
          this.onEvent.emit({ kind: 'DocumentUpdated' });
        }
      },
      icon: 'pencil-square text-primary',
      title: 'Rename Section'
    });

    // Merge Action
    tools.push({
      callback: () => {
        this.onEvent.emit({ kind: 'MergeSectionRequested', uuid: this.data.uuid } as any);
      },
      icon: 'box-arrow-in-down text-info',
      title: 'Merge with Next'
    });

    // Delete Section & Content Action
    tools.push({
      callback: () => {
        if (confirm('Are you sure you want to delete this section and all its contents?')) {
          this.onEvent.emit({ kind: 'DeletionRequested', focusLast: true });
        }
      },
      icon: 'trash text-danger',
      title: 'Delete Section & Content'
    });

    // Add sibling/child options if applicable
    const docStruct = Model.getStructure(this.documentType);
    const currentLevelNum = this.zipper.length;
    tools.push({
      callback: () => {
        this.onEvent.emit({ kind: 'NewFormteilRequested' });
      },
      icon: 'plus-square text-success',
      title: `Add L${currentLevelNum} Section`
    });

    const nextLevel = docStruct[this.zipper.length];
    if (nextLevel) {
      tools.push({
        callback: () => {
          this.newAt(Model.createNestedFormteilContainer(this.documentType, currentLevelNum + 1), 0);
          this.onEvent.emit({ kind: 'DocumentUpdated' });
        },
        icon: 'plus-square-fill text-success',
        title: `Add L${currentLevelNum + 1} Sub-Section`
      });
    }

    // Clear selection button
    tools.push({
      callback: () => {
        this.focusService.focusedContainerUUID = undefined;
        this.toolService.remove(this);
      },
      icon: 'x-circle text-secondary',
      title: 'Clear Selection'
    });

    this.toolService.remove(this);
    this.toolService.addStack({
      source: this,
      tools: tools
    });
  }
}
