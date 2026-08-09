import { ChangeDetectorRef, OnChanges, ViewChildren, QueryList, Component } from '@angular/core';
import * as S from './Section';
import * as Model from '../types/model';
import { Event, NewNoteLineRequsted } from './Event';
import { handleFocusShiftFromChild, handleFocusChangeFromParent, focusNewChild } from '../../utils';
import { Focusable, FocusChange } from "../types/Focus";
import { FocusShiftRequested, DeletionRequested } from "../types/CommonEvent";
import { UndoService } from '../undoService';

@Component({
  selector: 'app-misc-section',
  templateUrl: './section.component.html',
  styleUrls: ['./section.component.scss']
})
export class MiscSectionComponent extends S.Section<Model.MiscContainer> implements OnChanges, Focusable {
  @ViewChildren("sub")
  children!: QueryList<Focusable>;

  constructor(private cdr: ChangeDetectorRef, private undoService: UndoService) {
    super("Misc", {
      'NewNoteLineRequsted': (e: Event, oldIndex: number) => {
        let r = e as NewNoteLineRequsted;
        console.log(r.container);
        this.newAt(r.container, oldIndex + 1);
      },
      'NewParatextRequested': (e: Event, oldIndex: number) => { this.undo.beforeChange(); this.newAt(Model.emptyParatextContainer(), oldIndex + 1); },
      'DeletionRequested': (e: Event, oldIndex: number) => { this.undo.beforeChange(); this.deletionRequest(e as DeletionRequested, oldIndex) },
      'FocusShiftRequested': (e: Event, oldIndex: number) => { handleFocusShiftFromChild(e as FocusShiftRequested, this.children.toArray(), oldIndex, (e) => this.onEvent.emit(e)); }
    }, undoService);
  }

  deletionRequest(e: DeletionRequested, oldIndex: number): void {
    this.data.children.splice(oldIndex, 1); this.onEvent.emit({ kind: 'StaleCommentRemovealRequested' });
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

  ngOnChanges(): void {
    this.actionHandlers = {
      '+ Line': () => { this.undo.beforeChange(); this.newAt(Model.emptyZeileContainer(), 0) },
      '+ Text': () => { this.undo.beforeChange(); this.newAt(Model.emptyParatextContainer(), 0) }
    };

    const docStruct = Model.getStructure(this.documentType);
    const structure = docStruct[this.zipper.length - 1];
  }

  getName(): string {
    return "";
  }

  newAt(model: Model.MiscChildren, newIndex: number) {
    this.data.children.splice(newIndex, 0, model);
    focusNewChild(this.children, this.cdr, model, false);

  }
  focus(change: FocusChange): void {
    handleFocusChangeFromParent(change, this.children.toArray());
  }

  getData(): any {
    return this.data;
  }
}
