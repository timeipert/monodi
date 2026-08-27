import { ViewChildren, QueryList, Component, OnInit, ElementRef, ViewChild, OnDestroy, ChangeDetectorRef } from '@angular/core';
import * as S from './Section';
import * as Model from '../types/model';
import * as R from '../notes/Request';
import { assertNever, handleFocusChangeFromParent } from '../../utils';
import { Focusable, Focus, FocusChange } from '../types/Focus';
import { FocusShiftRequested } from '../types/CommonEvent';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { EditSyllableTextComponent } from '../edit-syllable-text/edit-syllable-text.component';
import { spacedToString } from '../notes/notes.component';
import { musicLanguage } from '../notes/language';
import { FocusService } from '../focus.service';
import { ToolsService } from '../tools.service';
import { Subscription, Observable } from 'rxjs';
import { take } from 'rxjs/operators';
import { ToastrService } from 'ngx-toastr';
import { v4 as UUID } from "uuid";
import { UndoService } from '../undoService';
import { ContextMenuService } from '../context-menu/context-menu.service';

@Component({
  selector: 'app-zeile-section',
  templateUrl: './section.component.html',
  styleUrls: ['./section.component.scss'],
})
export class ZeileSectionComponent extends S.Section<Model.ZeileContainer> implements OnInit, OnDestroy, Focusable {
  @ViewChild('syllableModalEdit', { static: true }) syllableModalEdit!: ElementRef;
  @ViewChildren('linechild')
  children!: QueryList<Focusable>;
  subscription!: Observable<string>;
  private focusSub?: Subscription;

  constructor(
    private modalService: NgbModal,
    private changeRef: ChangeDetectorRef,
    private toastr: ToastrService,
    private focusService: FocusService,
    private undoService: UndoService,
    private contextMenuService: ContextMenuService,
    private toolsService: ToolsService
  ) {
    super('Notenzeile', {}, undoService);
  }

  updateActionHandlers() {
    this.actionHandlers = {
      '+ Line': () => this.onEvent.emit({ 'kind': 'NewNoteLineRequsted', container: Model.emptyZeileContainer() }),
      'Edit Notes': () => this.editText({ 'kind': 'EditNotesTextReqested' }),
      'Edit Syllables': () => this.editText({ 'kind': 'EditSyllableTextReqested' }),
      '+ Text': () => this.onEvent.emit({ 'kind': 'NewParatextRequested' }),
      [this.data.voiceCount === 2 ? 'Remove Voice 2' : 'Add Voice 2']: () => this.toggleVoice2(),
      'Toggle Layout (V1/V2)': () => {
         (window as any).groupedLayout = !(window as any).groupedLayout;
         this.children.forEach(c => { if ((c as any).refresh) (c as any).refresh(); });
         this.changeRef.detectChanges();
      }
    };
  }

  ngOnInit(): void {
    this.updateActionHandlers();
    this.focusSub = this.focusService.focusedContainerUUID$.subscribe((focusedUuid) => {
      if (focusedUuid !== this.data.uuid) {
        this.toolsService.remove(this);
      }
      this.changeRef.markForCheck();
    });
  }

  toggleVoice2(): void {
    this.undo.beforeChange();
    this.data.voiceCount = (this.data.voiceCount === 2) ? 1 : 2;
    if (this.data.voiceCount === 2) {
      this.data.children.forEach(child => {
        if (child.kind === 'Syllable') {
          if (!child.additionalMelodies) {
            child.additionalMelodies = [];
          }
          if (child.additionalMelodies.length === 0) {
            const emptyNotes = JSON.parse(JSON.stringify(Model.emptySyllable(this.data.voiceCount).notes));
            child.additionalMelodies.push(emptyNotes);
          }
        }
      });
    } else {
      this.data.children.forEach(child => {
        if (child.kind === 'Syllable') {
          child.additionalMelodies = undefined;
        }
      });
    }
    this.updateActionHandlers();
    this.children.forEach(c => { if ((c as any).refresh) (c as any).refresh(); });
    this.changeRef.detectChanges();
  }

  ngOnDestroy(): void {
    this.focusSub?.unsubscribe();
    this.toolsService.remove(this);
  }

  onContextMenu(me: MouseEvent): void {
    me.preventDefault();
    me.stopPropagation();

    const items = [
      {
        label: 'Edit Notes Text',
        action: () => { this.editText({ kind: 'EditNotesTextReqested' }); }
      },
      {
        label: 'Edit Syllables Text',
        action: () => { this.editText({ kind: 'EditSyllableTextReqested' }); }
      },
      {
        label: this.data.voiceCount === 2 ? 'Remove Voice 2' : 'Add Voice 2',
        action: () => { this.toggleVoice2(); }
      },
      {
        label: 'Add Line Break Below',
        action: () => { this.onEvent.emit({ kind: 'NewNoteLineRequsted', container: Model.emptyZeileContainer() }); }
      },
      {
        label: 'Merge with Next Line',
        action: () => { this.onEvent.emit({ kind: 'MergeWithNextLineRequested', uuid: this.data.uuid }); }
      }
    ];

    const docStruct = Model.getStructure(this.documentType);
    const K = this.documentType === 'Level0' ? 0 : (parseInt(this.documentType.replace(/level/i, ''), 10) || 0);
    for (let i = 1; i <= K; i++) {
      const desc = docStruct[i - 1];
      const levelName = (desc && desc.name) || `L${i}`;
      items.push({
        label: `Split ${levelName} Section From Here`,
        action: () => {
          this.onEvent.emit({ kind: 'SplitSectionAtLineRequested', lineUuid: this.data.uuid, splitLevel: i } as any);
        }
      });
    }

    this.contextMenuService.open(me, items, 'transcription', 'adding-a-folio-or-line-change');
  }

  getSyllableText(): string {
    let text = '';
    const syllables = this.data.children.filter(c => c.kind === 'Syllable');
    syllables.forEach(syl => {
      text += (syl as Model.Syllable).text;
      if (!text.endsWith('-')) {
        text += ' ';
      }
    });
    return text.trim();
  }

  getNotesText(): string {
    let text = '';
    const syllables = this.data.children.filter(c => c.kind === 'Syllable');
    syllables.forEach((syl, index) => {
      const notes = (syl as Model.Syllable).notes;
      text += spacedToString(notes);
      if (index < syllables.length - 1) {
        text += ',';
      }
    });
    return text.trim();
  }

  private editText(r: R.Request) {
    const modalRef = this.modalService.open(EditSyllableTextComponent);
    this.subscription = modalRef.componentInstance.updateSyllableText;
    switch (r.kind) {
      case 'EditSyllableTextReqested':
        modalRef.componentInstance.title = 'Silbentext editieren';
        modalRef.componentInstance.text = this.getSyllableText();
        this.subscription.pipe(take(1)).subscribe((text: string) => this.reciveSyllableText(text));
        break;
      case 'EditNotesTextReqested':
        modalRef.componentInstance.title = 'Notentext editieren';
        modalRef.componentInstance.text = this.getNotesText();
        this.subscription.pipe(take(1)).subscribe((text: string) => this.reciveNotesText(text));
        break;
    }
  }

  reciveNotesText(newNotes: string) {
    this.undo.beforeChange();
    const newNotesArray = newNotes.split(/,(?!\])/);
    const childrenCopy = JSON.parse(JSON.stringify(this.data.children));
    this.data.children = [];
    this.changeRef.detectChanges();

    let newNotesIndex = 0;
    for (let i = 0; i < childrenCopy.length; i++) {
      const childCopy = JSON.parse(JSON.stringify(childrenCopy[i] as Model.Syllable));
      if (childCopy.kind === 'Syllable') {
        if (newNotesIndex < newNotesArray.length) {
          (childCopy as Model.Syllable).notes = this.textToNotes(newNotesArray[newNotesIndex], (childCopy as Model.Syllable).notes);
          newNotesIndex++;
        } else {
          (childCopy as Model.Syllable).notes = musicLanguage.Spaced.tryParse('');
        }
      }
      this.data.children.push(childCopy);
    }
    if (newNotesIndex < newNotesArray.length) {
      for (let i = newNotesIndex; i < newNotesArray.length; i++) {
        const newData = Model.emptySyllable(this.data.voiceCount);
        try {
          newData.notes = musicLanguage.Spaced.tryParse(newNotesArray[i]);
        } catch (e) {
          window.alert('Invalid input detected: ' + newNotesArray[i]);
        }
        this.data.children.push(newData);
      }
    }
  }

  textToNotes(data: string, notes: Model.Spaced): Model.Spaced {
    try {
      const newNotes = musicLanguage.Spaced.tryParse(data);
      const uuidInfo = Model.copyUuids(notes, newNotes);
      const commentsToUpdate = this.comments.filter(c => uuidInfo.lostUUIDs.find(u => c.startUUID === u || c.endUUID === u));

      if (commentsToUpdate.length > 0 && uuidInfo.fallbackUUID === undefined) {
        window.alert(
          'You cannot delete this note because a comment would be lost. Please remove the comment first.');
        return notes;
      } else if (uuidInfo.fallbackUUID) {
        for (let c of commentsToUpdate) {
          if (uuidInfo.lostUUIDs.find(u => c.startUUID === u)) {
            c.startUUID = uuidInfo.fallbackUUID;
          }
          if (uuidInfo.lostUUIDs.find(u => c.endUUID === u)) {
            c.endUUID = uuidInfo.fallbackUUID;
          }
        }
      }
      return newNotes;
    } catch (e) {
      console.log(e);
      window.alert('Error parsing new note text');
      return notes;
    }
  }


  private focusChild(model: any, level: Focus | undefined, fromLast: boolean = false) {
    this.children.toArray().find(n => n.getData() === model)!.focus({
      focusLast: fromLast,
      preferredLevel: level
    });
  }

  reciveSyllableText(newData: string) {
    this.undo.beforeChange();
    let syllableArray: Array<string> = [];
    const newSyllables = newData.match(/([^-\s]*((\s|-)?\b))/gi);
    if (newSyllables) {
      syllableArray = newSyllables.filter(s => s !== '');
    }
    const childrenCopy = JSON.parse(JSON.stringify(this.data.children));
    this.data.children = [];
    this.changeRef.detectChanges();

    let syllableCounter = 0;
    for (let i = 0; i < childrenCopy.length; i++) {
      const childCopy = JSON.parse(JSON.stringify(childrenCopy[i] as Model.Syllable));
      if (childCopy.kind === 'Syllable') {
        if (syllableCounter < syllableArray.length) {
          childCopy.text = syllableArray[syllableCounter].trim();
        } else {
          childCopy.text = '';
        }
        syllableCounter++;
      }
      this.data.children.push(childCopy);
    }
    if (syllableCounter < syllableArray.length) {
      for (let k = syllableCounter; k < syllableArray.length; k++) {
        if (syllableArray[k] !== '') {
          const newData = Model.emptySyllable(this.data.voiceCount);
          newData.text = syllableArray[k].trim();
          this.data.children.push(newData);
        }
      }
    }
  }

  /**
   * Splits Syllable and will return a new Syllable of elements at the point of split
   * The split will happen at the first focused note and the given Syllable will be shortend
   * @param syllable Model.Syllable
   */
  splitSyllable(syllable: Model.Syllable): Model.Syllable {
    this.undo.beforeChange();
    let syll: Model.Syllable = JSON.parse(JSON.stringify(syllable));
    let newSyll = Model.emptySyllable(this.data.voiceCount);
    newSyll.notes.spaced = [];
    let splitSyl: number = syll.notes.spaced.findIndex(s => s.nonSpaced.findIndex(n => n.grouped.findIndex(g => g.focus === true) >= 0) >= 0);

    for (let i = splitSyl; i < syllable.notes.spaced.length; i++) {
      let ns: Model.NonSpaced = syll.notes.spaced[i];
      let splitNS: number = ns.nonSpaced.findIndex(n => n.grouped.findIndex(g => g.focus === true) >= 0);
      let nonSpacedCopy: Model.NonSpaced = JSON.parse(JSON.stringify(ns))
      let newNoneSpaced: Model.Grouped[] = [];
      //split NonSpaced
      if (splitNS >= 0) {
        for (let j = splitNS; j < ns.nonSpaced.length; j++) {
          let g: Model.Grouped = ns.nonSpaced[j];
          let groupCopy: Model.Grouped = JSON.parse(JSON.stringify(g))
          let splitGr: number = g.grouped.findIndex(n => n.focus === true);
          //split Grouped
          if (splitGr >= 0) {
            let split: Model.Note[] = groupCopy.grouped.slice(splitGr);
            groupCopy.grouped = split;
            newNoneSpaced.push(groupCopy)
          } else {
            //else copy
            newNoneSpaced.push(groupCopy)
          }
          //shorten original
          if (splitGr >= 0) {
            syllable.notes.spaced[i].nonSpaced[j].grouped.length = splitGr;
          }
        }
        nonSpacedCopy.nonSpaced = newNoneSpaced;
        newSyll.notes.spaced.push(nonSpacedCopy);

      } else {
        //else copy
        newSyll.notes.spaced.push(nonSpacedCopy);
      }
      //shorten orginial NonSpaced
      if (splitNS >= 0) {
        syllable.notes.spaced[i].nonSpaced.length = splitNS + 1;
      }

    }
    //shorten orginial spaced
    if (splitSyl >= 0) {
      syllable.notes.spaced.length = splitSyl + 1
    }

    return newSyll;
  }


  onLinePartRequest(r: R.Request, child: Model.LinePart): void {
    switch (r.kind) {
      case 'NewCommentRequested': this.onEvent.emit(r); break;
      case 'NoFocusRequested': this.onEvent.emit({ kind: 'NoFocusRequested' }); break;
      case 'NewLineRequested': this.onEvent.emit({ kind: 'NewNoteLineRequsted', container: Model.emptyZeileContainer() }); break;
      case 'SplitLineRequested': {
        this.undo.beforeChange();
        const childIndex = this.data.children.indexOf(child);
        const copy: Model.ZeileContainer = { uuid: UUID(), kind: this.data.kind, children: [...this.data.children] };
        this.data.children.length = childIndex + 1;
        copy.children.splice(0, childIndex + 1);
        this.onEvent.emit({ kind: 'NewNoteLineRequsted', container: copy });
        break;
      }
      case 'NewSegmentRequested': {
        this.undo.beforeChange();
        const oldIndex = this.data.children.indexOf(child);
        const newData = Model.trueEmptySyllable(this.data.voiceCount);
        //const newData = Model.emptySyllable(this.data.voiceCount);
        if (r.text) {
          newData.text = r.text;
        }
        newData.syllableType = r.syllableType;
        this.data.children.splice(oldIndex + 1, 0, newData);
        setTimeout(() => this.focusChild(newData, undefined), 0);
        break;
      }
      case 'DeletionRequested': {
        if (Model.linePartContainsComments(child, this.comments)) {
          window.alert('Please remove all comments before deleting this part.');
          break;
        }
        this.undo.beforeChange();
        const childIndex = this.data.children.indexOf(child);
        this.data.children.splice(childIndex, 1);
        if (this.data.children.length > 0) {
          const newIndex = r.focusLast ? childIndex - 1 : childIndex;
          if (newIndex < 0) {
            this.onEvent.emit({ kind: 'FocusShiftRequested', change: { focusLast: true }, direction: -1 });
          } else if (newIndex >= this.data.children.length) {
            this.onEvent.emit({ kind: 'FocusShiftRequested', change: { focusLast: false }, direction: +1 });
          } else {
            this.focusChild(this.data.children[newIndex], undefined, r.focusLast);
          }
        } else {
          this.onEvent.emit({ kind: 'DeletionRequested', focusLast: r.focusLast });
        }
        break;
      }
      case 'LineChangeRequested': {
        this.undo.beforeChange();
        const offset: number = r.after ? 1 : 0;
        const oldIndex = this.data.children.indexOf(child);
        const newData = Model.emptyLineChange();
        this.data.children.splice(oldIndex + offset, 0, newData);
        setTimeout(() => this.focusChild(newData, undefined), 0);
        break;
      }
      case 'LineChangeToFolioChangeRequested': {
        this.undo.beforeChange();
        const oldIndex = this.data.children.indexOf(child);
        const newData = Model.emptyFolioChange();
        this.data.children.splice(oldIndex, 1, newData);
        setTimeout(() => this.focusChild(newData, Focus.Text), 0);
        break;
      }
      case 'CommentDeletionRequested': this.onEvent.emit(r); break;
      case 'FocusShiftRequested': {
        const delta = r.change.focusLast ? -1 : +1;
        const newIndex = this.data.children.indexOf(child);
        this.setFocusToNextChild(r, newIndex, delta);
        break;
      }
      case 'ChangeToBoxRequested':
        this.undo.beforeChange();
        const oldIndex = this.data.children.indexOf(child);
        const boxData = Model.emptyBox();
        this.data.children.splice(oldIndex, 1, boxData);
        setTimeout(() => this.focusChild(boxData, Focus.Text), 0);
        break;

      case 'NewClefRequested': {
        this.undo.beforeChange();
        const oldIndex = this.data.children.indexOf(child);
        const newData = Model.emptyClef();
        this.data.children.splice(oldIndex + 1, 0, newData);
        setTimeout(() => this.focusChild(newData, Focus.Text), 0);
        break;
      }
      case 'EditNotesTextReqested':
      case 'EditSyllableTextReqested': {
        this.undo.beforeChange();
        this.editText(r);
        break;
      }
      case 'ResolveCommentSpansRequested': {
        this.onEvent.emit(r);
        break;
      }
      case 'AddNoteToNextSegment': {
        this.undo.beforeChange();
        const oldIndex = this.data.children.indexOf(child);
        const nextData = this.data.children[oldIndex + 1];
        if (nextData) {
          if (nextData.kind === 'Syllable') {
            if (nextData.notes.spaced[0].nonSpaced.length === 0) {
              const newSyll = Model.emptySyllable(this.data.voiceCount);
              newSyll.notes.spaced[0].nonSpaced[0].grouped[0] = Model.copyNote(r.note);
              newSyll.text = nextData.text;
              this.data.children[oldIndex + 1] = newSyll;
              setTimeout(() => this.focusChild(this.data.children[oldIndex + 1], undefined), 0);
            } else if (nextData.notes.spaced[0].nonSpaced[0].grouped.length === 0) {
              const newSyll = Model.emptySyllable(this.data.voiceCount);
              newSyll.notes.spaced[0].nonSpaced[0].grouped[0] = Model.copyNote(r.note);
              newSyll.text = nextData.text;
              this.data.children[oldIndex + 1] = newSyll;
              setTimeout(() => this.focusChild(this.data.children[oldIndex + 1], undefined), 0);
            }
          }
        } else {
          //const oldIndex = this.data.children.indexOf(child);
          const newData = Model.trueEmptySyllable(this.data.voiceCount);
          newData.notes.spaced[0].nonSpaced[0].grouped[0] = Model.copyNote(r.note);
          this.data.children.push(newData);
          setTimeout(() => this.focusChild(newData, undefined), 0);
          break;
        }
        break;
      }
      case 'StartCommentRequested': {
        this.startComment(r.startUUID);
        break;
      }
      case 'EndCommentRequested': {
        this.endComment(r.endUUID, r.endKind)
        break;
      }
      case 'LineFocusShiftRequest': {
        this.onEvent.emit({ kind: 'LineFocusShiftRequest', uuid: this.data.uuid, direction: r.direction });
        break;
      }
      case 'ViewIiifRequested': {
        this.onEvent.emit(r);
        break;
      }
      case 'HighlightRegionRequested': {
        this.onEvent.emit(r);
        break;
      }
      default: assertNever(r);
    }
  }

  startComment(startUUID: string) {
    if (this.focusService.mode.kind === 'Normal') {
      this.focusService.mode = { kind: 'CommentCreate', startNoteUUID: startUUID };
      this.toastr.info('Now click the note (or other element) where the comment should end.', 'Pick the end of the comment');
    }
  }

  /**
   * Called when the user clicks a note (or other commentable element) while
   * the document is in one of the comment-creation modes.
   *
   * Two-step flow:
   *   • Step 1 — `CommentPickStart` mode: the click designates the *start*
   *     note. We transition to `CommentCreate` mode and wait for the end.
   *   • Step 2 — `CommentCreate` mode: the click designates the *end* note.
   *     We bubble a `NewCommentRequested` event up to the root section,
   *     which (a) has access to the full RootContainer and (b) can correctly
   *     decide whether to swap start/end so they appear in document order.
   *
   * In `Normal` mode this method is a no-op — the click was just a normal
   * focus action.
   */
  endComment(endUUID: string, kind: Model.CommentPartKind) {
    const mode = this.focusService.mode;
    if (mode.kind === 'CommentPickStart') {
      // Step 1 → 2: record the start, keep the user in pick mode.
      this.focusService.mode = { kind: 'CommentCreate', startNoteUUID: endUUID };
      return;
    }
    if (mode.kind === 'CommentCreate') {
      // Don't let the user pick the SAME note as both start and end.
      if (mode.startNoteUUID === endUUID) {
        this.toastr.info('Pick a *different* note as the end of the comment.', 'Same note');
        return;
      }
      this.onEvent.emit({
        kind: 'NewCommentRequested',
        startUUID: mode.startNoteUUID,
        endUUID: endUUID,
        text: '',
        endKind: kind,
      });
      this.focusService.mode = { kind: "Normal" };
    }
  }

  setFocusToNextChild(r: FocusShiftRequested, index: number, direction: number): void {
    const childModel = this.data.children[index + direction];
    if (childModel) {
      this.focusChild(childModel, r.change.preferredLevel, r.change.focusLast);
    } else {
      this.onEvent.emit({ kind: 'FocusShiftRequested', change: { focusLast: (direction < 0) }, direction: direction });
    }
  }

  getData(): any {
    return this.data;
  }

  focus(change: FocusChange): void {
    handleFocusChangeFromParent(change, this.children.toArray());
  }

  isFocused(): boolean {
    return this.focusService.focusedContainerUUID === this.data.uuid;
  }

  selectContainer(event: MouseEvent): void {
    event.stopPropagation();

    // 1. Highlight this line container
    this.focusService.focusedContainerUUID = this.data.uuid;

    // 2. Build and push line-specific tools to top toolbar
    const tools: any[] = [];

    // Edit Notes Text Action
    tools.push({
      callback: () => {
        this.editText({ kind: 'EditNotesTextReqested' });
      },
      icon: 'file-music text-primary',
      title: 'Edit Notes Text'
    });

    // Edit Syllables Text Action
    tools.push({
      callback: () => {
        this.editText({ kind: 'EditSyllableTextReqested' });
      },
      icon: 'chat-left-text text-primary',
      title: 'Edit Syllables Text'
    });

    // Voice 2 toggle
    tools.push({
      callback: () => {
        this.toggleVoice2();
        this.selectContainer(event); // Re-build toolbar with updated state
      },
      icon: 'music-note text-info',
      title: this.data.voiceCount === 2 ? 'Remove Voice 2' : 'Add Voice 2'
    });

    // Add Line Break Below
    tools.push({
      callback: () => {
        this.onEvent.emit({ kind: 'NewNoteLineRequsted', container: Model.emptyZeileContainer() });
      },
      icon: 'plus-square text-success',
      title: 'Add Line Below'
    });

    // Merge with Next Line
    tools.push({
      callback: () => {
        this.onEvent.emit({ kind: 'MergeWithNextLineRequested', uuid: this.data.uuid });
      },
      icon: 'box-arrow-in-down text-warning',
      title: 'Merge with Next'
    });

    // Delete Line Action
    tools.push({
      callback: () => {
        if (confirm('Are you sure you want to delete this line?')) {
          this.onEvent.emit({ kind: 'DeletionRequested', focusLast: true });
        }
      },
      icon: 'trash text-danger',
      title: 'Delete Line'
    });

    // Split Section From Here
    const docStruct = Model.getStructure(this.documentType);
    const K = this.documentType === 'Level0' ? 0 : (parseInt(this.documentType.replace(/level/i, ''), 10) || 0);
    for (let i = 1; i <= K; i++) {
      const desc = docStruct[i - 1];
      const levelName = (desc && desc.name) || `L${i}`;
      tools.push({
        callback: () => {
          this.onEvent.emit({ kind: 'SplitSectionAtLineRequested', lineUuid: this.data.uuid, splitLevel: i } as any);
        },
        icon: 'node-minus text-info',
        title: `Split ${levelName} Section`
      });
    }

    // Clear selection button
    tools.push({
      callback: () => {
        this.focusService.focusedContainerUUID = undefined;
        this.toolsService.remove(this);
      },
      icon: 'x-circle text-secondary',
      title: 'Clear Selection'
    });

    this.toolsService.remove(this);
    this.toolsService.addStack({
      source: this,
      tools: tools
    });
  }
}

