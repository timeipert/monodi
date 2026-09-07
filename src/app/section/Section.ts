import { EventEmitter, Input, Output, OnInit, Directive } from '@angular/core';
import * as Model from '../types/model';
import * as MS from '../types/modelStorage';
import { Event } from './Event';
import { DragRequest } from '../dragger/dragger.component';
import { UndoService } from '../undoService';

@Directive()
export abstract class Section<T extends Model.Container> implements OnInit {
  constructor(
    public name: string,
    public eventHandlers: EventHandlers,
    public undo: UndoService,
  ) {
  }

  public actionHandlers: { [name: string]: (() => void) } = {};
  private defaultActions: { [name: string]: (() => void) } = {
    'Copy': () => MS.store({
      data: this.data,
      oldDepth: this.zipper.length,
      partOf: this.documentType
    }),
    'Paste after': () => {
      this.undo.beforeChange();
      this.onEvent.emit({
        kind: "PasteRequested",
        at: this.zipper.concat([]),
        withoutText: false,
        withoutNotes: false,
      })
    },
    'Paste after (discard notes)': () => {
      this.undo.beforeChange();
      this.onEvent.emit({
        kind: "PasteRequested",
        at: this.zipper.concat([]),
        withoutText: false,
        withoutNotes: true,
      })
    },
    'Paste after (discard text)': () => {
      this.undo.beforeChange();
      this.onEvent.emit({
        kind: "PasteRequested",
        at: this.zipper.concat([]),
        withoutText: true,
        withoutNotes: false,
      })
    },
    'x Delete': () => this.onEvent.emit({ 'kind': 'DeletionRequested', focusLast: true })
  };

  ngOnInit(): void {
  }

  onContextMenu(me: MouseEvent): void {
    // Stub to be overridden by subclasses (e.g. ZeileSectionComponent)
  }

  selectContainer(event: MouseEvent): void {
    // Stub to be overridden by subclasses that support click-to-select
    // (FormteilSectionComponent, ZeileSectionComponent). Declared on the base
    // so the shared section template type-checks for every subclass.
  }

  isFocused(): boolean {
    // Stub overridden by subclasses that support container focus
    // highlighting (FormteilSectionComponent, ZeileSectionComponent).
    return false;
  }

  isDragTarget = false;

  @Input()
  readOnly!: boolean;

  @Input()
  levelNames: any;

  @Input()
  data!: T;

  @Input()
  comments!: Model.Comment[];

  @Input()
  documentType!: Model.DocumentType;

  @Input()
  zipper!: number[];

  @Output()
  onEvent = new EventEmitter<Event>();

  actions(): string[] {
    const actions = Object.keys(this.actionHandlers);
    for (let da of Object.keys(this.defaultActions)) {
      if (da === 'x Delete' && !this.canBeDeleted()) {
        continue;
      }
      if (actions.indexOf(da) === -1) {
        actions.push(da);
      }
    }
    
    // Ensure Delete is always at the absolute end
    if (actions.indexOf('x Delete') !== -1) {
      actions.splice(actions.indexOf('x Delete'), 1);
      actions.push('x Delete');
    }

    return actions;
  }

  getEnglishDataName(name: string): string {
    const names: { [key: string]: string } = {
      'Signatur': 'Signature',
      'Status': 'Status',
      'Verweis': 'Reference',
      'LemmatisiertesTextInitium': 'Lem. Text Init.'
    };
    return names[name] || name;
  }

  getActionIcon(action: string): string {
    const a = action.toLowerCase();
    if (a.includes('delete') || a.startsWith('x ')) {
      return 'bi bi-trash text-danger';
    }
    if (a.includes('line')) {
      return 'bi bi-music-note-list text-success';
    }
    if (a.includes('text')) {
      return 'bi bi-file-earmark-text text-primary';
    }
    if (a.includes('copy')) {
      return 'bi bi-copy text-secondary';
    }
    if (a.includes('paste')) {
      if (a.includes('notes')) return 'bi bi-clipboard-x text-secondary';
      if (a.includes('text')) return 'bi bi-clipboard-minus text-secondary';
      return 'bi bi-clipboard-check text-secondary';
    }
    if (a.includes('+ l')) {
      return 'bi bi-plus-square text-info';
    }
    if (a.includes('dash') || a.includes('silbe')) {
      return 'bi bi-type-strikethrough text-warning';
    }
    return 'bi bi-gear';
  }

  getActionLabel(action: string): string {
    if (action === 'Copy') {
      return 'Copy section';
    }
    if (action === 'x Delete') {
      return 'Delete';
    }
    return action;
  }

  executeAction(a: string): void {
    if (this.actionHandlers[a]) {
      this.actionHandlers[a]();
    } else if (this.defaultActions[a]) {
      this.defaultActions[a]();
    } else {
      throw new Error("unknown action " + a);
    }
  }

  getZipper(n: number): number[] {
    return [...this.zipper, n]
  }

  canBeDeleted(): boolean {
    return true;
  }

  handleEvent(e: Event, childIndex: number) {
    if (this.eventHandlers[e.kind]) {
      this.eventHandlers[e.kind]!(e as any, childIndex);
    } else {
      this.onEvent.emit(e);
    }
  }

  onDropRequested(d: DragRequest): void {
    this.handleEvent({
      kind: 'MoveRequested',
      from: d.from,
      to: d.to
    }, -1);
  }

  getChildren(): Model.Container[] {
    return Model.getContainerChildren(this.data);
  }

  getUUID = (_: any, x: any) => Model.getUUID(x);

  kindIs(x: any, y: any) {
    return x.kind === y;
  }

  /** True when this section's line is set to adiastematic (contour-only) notation. */
  isAdiastematic(): boolean {
    return (this.data as any)?.notation === 'adiastematic';
  }
}

type EventHandlers = {
  [kind in Event["kind"]]?: (e: Extract<Event, { kind: kind }>, index: number) => void
};
