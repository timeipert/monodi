import { Component, OnInit, Input, Output, EventEmitter, OnDestroy } from '@angular/core';
import * as M from '../types/model';
import { commentColor } from './comment-colors';
import { lemmaText } from './lemma-utils';
import { COMMENT_CATEGORIES } from './comment-categories';
import { APIService } from '../api.service';
import { UserService } from '../user.service';
import { apparatusPreviewLine } from './apparatus-preview';
import { INTERVENTIONS } from './intervention-vocabulary';
import { COMMENT_TEMPLATES, treeHasContent, instantiateTemplateTree, SavedCommentTemplate } from './comment-templates';
import { CommentTemplateService } from './comment-template.service';

import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { Event } from '../section/Event';
import * as MS from '../types/modelStorage';
import { ToastrService } from 'ngx-toastr';

interface CommentHistory {
  past: string[];
  future: string[];
}

@Component({
  selector: 'app-comment',
  templateUrl: './comment.component.html',
  styleUrls: ['./comment.component.scss']
})

export class CommentComponent implements OnInit, OnDestroy {
  private histories = new Map<M.Comment, CommentHistory>();
  selectedIndex: number = 0;
  commentColor = commentColor;
  lemmaText = lemmaText;
  showOriginalNotation: boolean = false;
  isArmed: boolean = false;
  armTimeout: any = null;
  pendingDeletion: { index: number; comment: M.Comment } | null = null;
  COMMENT_CATEGORIES = COMMENT_CATEGORIES;
  INTERVENTIONS = INTERVENTIONS;
  COMMENT_TEMPLATES = COMMENT_TEMPLATES;
  savedTemplates: SavedCommentTemplate[] = [];
  /** When a template would overwrite existing content, the first click arms it
   *  (asking to confirm) and the second click within the window applies it. */
  armedTemplateKey: string | null = null;
  private templateArmTimeout: any = null;
  sigla: string[] = [];
  private siglaLoaded = false;

  get apparatusPreview(): string {
    const comment = this.comments[this.selectedIndex];
    if (!comment) return '';
    const orig = this.getOriginal(this.comments.indexOf(comment));
    return apparatusPreviewLine(comment, orig);
  }

  get apparatusPreviewParts() {
    const preview = this.apparatusPreview;
    const match = preview.match(/^\[([^\]]+)\]\s*(.*)$/);
    if (match) {
      return { category: match[1], rest: match[2] };
    }
    return { category: null, rest: preview };
  }

  toggleCategory(c: M.Comment, categoryKey: any): void {
    if (c.category === categoryKey) {
      c.category = undefined;
    } else {
      c.category = categoryKey;
    }
    this.autoSave();
  }

  toggleIntervention(c: M.Comment, key: any): void {
    if (c.intervention === key) {
      c.intervention = undefined;
      if (key === 'correction') {
        c.emendation = false;
      }
    } else {
      c.intervention = key;
      if (key === 'correction') {
        c.emendation = true;
      } else {
        c.emendation = false;
      }
    }
    if (c.intervention !== 'unclear') {
      c.certainty = undefined;
    }
    this.autoSave();
  }

  updateCertainty(c: M.Comment, val: any): void {
    c.certainty = val ? val : undefined;
    this.autoSave();
  }

  loadSigla() {
    if (this.siglaLoaded) return;
    this.siglaLoaded = true;
    this.userService.user.subscribe(user => {
      if (user && user.token) {
        this.api.listSources(user.token).subscribe(res => {
          if (res.kind === 'SourcesRetrieved') {
            this.sigla = res.sources.map(s => s.quellensigle).filter(Boolean);
          }
        });
      }
    });
  }

  selectComment(idx: number): void {
    this.selectedIndex = idx;
    this.showOriginalNotation = false;
    this.isArmed = false;
    this.clearArmTimeout();
    this.armedTemplateKey = null;
    this.clearTemplateArm();
    const c = this.comments[idx];
    if (c && c.commentType === 'lines') {
      this.loadSigla();
    }
  }

  updateWitness(comment: M.Comment, index: number, value: string): void {
    if (!comment.readingWitnesses) {
      comment.readingWitnesses = Array(comment.lines ? comment.lines.length : 0).fill('');
    }
    comment.readingWitnesses[index] = value;
    this.autoSave();
  }

  @Input()
  comments!: (M.Comment | null)[];

  @Input()
  originals!: M.ZeileContainer[];

  @Output()
  saveEvent = new EventEmitter<(M.Comment | null)[]>();

  constructor(
    public activeModal: NgbActiveModal,
    private toaster: ToastrService,
    private api: APIService,
    private userService: UserService,
    private templateService: CommentTemplateService
  ) { }

  ngOnInit() {
    this.comments.forEach(c => {
      if (c) {
        // Every comment is now a single CommentTree. Migrate legacy
        // text-only / lines bodies in place (old fields are left untouched
        // as a back-compat fallback — see M.ensureCommentTree).
        M.ensureCommentTree(c);
        c.commentType = 'tree';
        if (c.emendation === true && !c.intervention) {
          c.intervention = 'correction';
        }
      }
    });
    this.selectFirstActive();
    this.loadSavedTemplates();
  }

  private loadSavedTemplates(): void {
    this.templateService.list().subscribe(list => { this.savedTemplates = list; });
  }

  selectFirstActive() {
    const firstActiveIdx = this.comments.findIndex(c => c !== null);
    this.selectedIndex = firstActiveIdx >= 0 ? firstActiveIdx : 0;
  }


  getHistory(c: M.Comment): CommentHistory {
    if (!this.histories.has(c)) {
      this.histories.set(c, { past: [], future: [] });
    }
    return this.histories.get(c)!;
  }

  onTextChange(c: M.Comment, newText: string) {
    if (c.text !== newText) {
      const history = this.getHistory(c);
      history.past.push(c.text || '');
      history.future = []; // Clear redo stack on new change
      c.text = newText;
      this.autoSave();
    }
  }

  undoText(c: M.Comment) {
    const history = this.getHistory(c);
    if (history.past.length > 0) {
      history.future.push(c.text || '');
      c.text = history.past.pop()!;
      this.autoSave();
    }
  }

  redoText(c: M.Comment) {
    const history = this.getHistory(c);
    if (history.future.length > 0) {
      history.past.push(c.text || '');
      c.text = history.future.pop()!;
      this.autoSave();
    }
  }

  canUndo(c: M.Comment): boolean {
    return this.getHistory(c).past.length > 0;
  }

  canRedo(c: M.Comment): boolean {
    return this.getHistory(c).future.length > 0;
  }


  onEmendationChange(c: M.Comment, value: boolean) {
    c.emendation = value;
    this.autoSave();
  }

  deleteComment(c: M.Comment): void {
    if (!this.isArmed) {
      this.isArmed = true;
      this.clearArmTimeout();
      this.armTimeout = setTimeout(() => {
        this.isArmed = false;
      }, 4000);
      return;
    }

    this.clearArmTimeout();
    this.isArmed = false;

    // Commit any previous pending deletion first
    this.commitPendingDeletion();

    const indexToDelete = this.comments.indexOf(c);
    this.pendingDeletion = { index: indexToDelete, comment: c };

    if (this.selectedIndex === indexToDelete) {
      let nextIdx = this.comments.findIndex((comp, idx) => idx > indexToDelete && comp !== null && (!this.pendingDeletion || idx !== this.pendingDeletion.index));
      if (nextIdx === -1) {
        nextIdx = this.comments.map((comp, idx) => ({comp, idx}))
                               .filter(x => x.idx < indexToDelete && x.comp !== null && (!this.pendingDeletion || x.idx !== this.pendingDeletion.index))
                               .map(x => x.idx)
                               .pop() ?? 0;
      }
      this.selectedIndex = nextIdx;
      this.showOriginalNotation = false;
    }
  }

  clearArmTimeout() {
    if (this.armTimeout) {
      clearTimeout(this.armTimeout);
      this.armTimeout = null;
    }
  }

  commitPendingDeletion() {
    if (this.pendingDeletion) {
      const idx = this.pendingDeletion.index;
      if (this.comments[idx] !== null) {
        this.comments[idx] = null;
        this.autoSave();
      }
      this.pendingDeletion = null;
    }
  }

  undoDeletion() {
    if (this.pendingDeletion) {
      const index = this.pendingDeletion.index;
      this.selectedIndex = index;
      this.pendingDeletion = null;
      this.showOriginalNotation = false;
    }
  }

  closeModal() {
    this.commitPendingDeletion();
    this.activeModal.dismiss();
  }

  ngOnDestroy() {
    this.clearArmTimeout();
    this.clearTemplateArm();
    this.commitPendingDeletion();
  }


  autoSave() {
    this.saveEvent.emit(this.comments);
  }

  onExit() {
    this.activeModal.dismiss();
  }

  setCommentType(c: M.Comment, type: 'text' | 'lines' | 'tree'): void {
    c.commentType = type; this.autoSave();
    if (type === 'lines') {
      this.loadSigla();
      if (!c.lines) {
        this.addLine(c);
      }
    } else if (type === 'tree' && !c.tree) {
      this.addTree(c);
    }
  }

  public static addLineHelper(comment: M.Comment, originals: M.ZeileContainer[], comments: (M.Comment | null)[]): void {
    const idx = comments.indexOf(comment);
    comment.lines = [JSON.parse(JSON.stringify(originals[idx]))];
    if (comment.readingWitnesses) {
      comment.readingWitnesses = [''];
    }
  }

  public static insertAtHelper(comment: M.Comment, atLine: number, item: M.FormteilChildren): void {
    let lines = comment.lines;
    if (lines) {
      lines.splice(atLine + 1, 0, item);
      let witnesses = comment.readingWitnesses;
      if (witnesses) {
        witnesses.splice(atLine + 1, 0, '');
      }
    }
  }

  public static deleteAtHelper(comment: M.Comment, deletionIndex: number): void {
    let lines = comment.lines;
    if (lines) {
      lines.splice(deletionIndex, 1);
      let witnesses = comment.readingWitnesses;
      if (witnesses) {
        witnesses.splice(deletionIndex, 1);
      }
    }
  }

  addLine(c: M.Comment): void {
    CommentComponent.addLineHelper(c, this.originals, this.comments);
    this.autoSave();
  }

  originalCreator(c: M.Comment) {
    return () => JSON.parse(JSON.stringify(this.originals[this.comments.indexOf(c)]))
  }

  addTree(c: M.Comment): void {
    c.tree = M.emptyCommentTree();
  }

  removeLine(c: M.Comment): void {
    delete c.lines;
  }

  activeComments(): M.Comment[] {
    return this.comments.filter((c, idx) => c !== null && (!this.pendingDeletion || idx !== this.pendingDeletion.index)) as M.Comment[];
  }

  getCommentsWithIndices() {
    let sequential = 1;
    return this.comments.map((c, originalIndex) => {
      if (c === null || (this.pendingDeletion && originalIndex === this.pendingDeletion.index)) return null;
      return {
        comment: c,
        originalIndex,
        sequentialIndex: sequential++
      };
    }).filter(item => item !== null) as { comment: M.Comment, originalIndex: number, sequentialIndex: number }[];
  }

  getSequentialIndex(c: M.Comment): number {
    const active = this.activeComments();
    const idx = active.indexOf(c);
    return idx >= 0 ? idx + 1 : 0;
  }

  getActiveCommentIndex(c: M.Comment): number {
    return this.activeComments().indexOf(c);
  }

  getOriginal(index: number): M.ZeileContainer {
    return this.originals[index];
  }

  private insertAt(commentIndex: number, atLine: number, item: M.FormteilChildren): void {
    if (this.comments[commentIndex]) {
      CommentComponent.insertAtHelper(this.comments[commentIndex]!, atLine, item);
    }
  }

  private deleteAt(commentIndex: number, deletionIndex: number): void {
    if (this.comments[commentIndex]) {
      CommentComponent.deleteAtHelper(this.comments[commentIndex]!, deletionIndex);
    }
  }


  private copyAndPaste(commentIndex: number, lineIndex: number, withoutNotes: boolean, withoutText: boolean): void {
    if (this.comments[commentIndex]) {
      let lines = this.comments[commentIndex]!.lines;
      if (lines) {
        let copy = MS.getStore();
        if (copy && (copy.data.kind === "ZeileContainer" || copy.data.kind === "ParatextContainer")) {
          copy.data
          M.unsafeGenerateNewUUIDs(copy.data);
          if (copy.data.kind === "ZeileContainer") {
            if (withoutNotes) {
              M.getSyllables(copy.data).forEach(s => { s.notes = { spaced: [] } });
            }
            if (withoutText) {
              M.getSyllables(copy.data).forEach(s => { s.text = "" });
            }
            this.insertAt(commentIndex, lineIndex, copy.data);
          } else if (copy.data.kind === "ParatextContainer") {
            this.insertAt(commentIndex, lineIndex, copy.data);
          }
        }
        else {
          this.toaster.warning("Only note lines and paratexts can be inserted as a comment.");
        }
      }
    }
  }

  handleEvent(e: Event, commentIndex: number, lineIndex: number) {
    switch (e.kind) {
      case "NewNoteLineRequsted":
        this.insertAt(commentIndex, lineIndex, M.emptyZeileContainer());
        this.autoSave();
        break;
      case "NewParatextRequested": {
        this.insertAt(commentIndex, lineIndex, M.emptyParatextContainer());
        this.autoSave();
        break;
      }
      case "DeletionRequested": {
        this.deleteAt(commentIndex, lineIndex);
        this.autoSave();
        break;
      }
      case "PasteRequested": {
        this.copyAndPaste(commentIndex, lineIndex, e.withoutNotes, e.withoutText);
        this.autoSave();
        break;
      }
      case "NewFormteilRequested": {
        this.toaster.info("This operation is not supported for comments.");
        break;
      }
      default:
        this.toaster.error("Unerwarteter aufruf " + e.kind);
        break;
    }
  }

  handleCommentTreeEvent(e: M.CommentTreeEvent, comment: M.Comment) {
    comment.tree = M.applyCommentTreeEvent(comment.tree!, e);
    this.autoSave();
  }

  /** True when applying a template would replace existing tree content. */
  templateNeedsConfirm(comment: M.Comment): boolean {
    return treeHasContent(comment.tree);
  }

  /**
   * Replace the comment's content with a prebuilt (built-in) template. If the
   * tree already has content the first click arms the template (button asks to
   * confirm) and a second click within the window performs the replacement.
   */
  applyTemplate(comment: M.Comment, key: string): void {
    const tpl = this.COMMENT_TEMPLATES.find(t => t.key === key);
    if (!tpl) return;
    this.applyTreeBuilder(comment, key, () => tpl.build(this.originalCreator(comment)));
  }

  /** Apply a user-saved template, cloning it with fresh ids/uuids. */
  applySavedTemplate(comment: M.Comment, saved: SavedCommentTemplate): void {
    this.applyTreeBuilder(comment, saved.id, () => instantiateTemplateTree(saved.tree));
  }

  /** Shared replace-with-confirm flow used by both built-in and saved templates. */
  private applyTreeBuilder(comment: M.Comment, armKey: string, build: () => M.CommentTree): void {
    if (treeHasContent(comment.tree) && this.armedTemplateKey !== armKey) {
      this.armedTemplateKey = armKey;
      this.clearTemplateArm();
      this.templateArmTimeout = setTimeout(() => { this.armedTemplateKey = null; }, 4000);
      return;
    }
    this.clearTemplateArm();
    this.armedTemplateKey = null;
    comment.tree = build();
    this.autoSave();
  }

  /** Save the current comment's structure as a reusable template. */
  saveAsTemplate(comment: M.Comment): void {
    if (!treeHasContent(comment.tree)) {
      this.toaster.info('Add some content before saving a template.');
      return;
    }
    const name = (window.prompt('Template name:') || '').trim();
    if (!name) return;
    this.templateService.save(name, comment.tree!).subscribe(list => {
      this.savedTemplates = list;
      this.toaster.success('Template saved');
    });
  }

  /** Delete a saved template. */
  deleteSavedTemplate(saved: SavedCommentTemplate, ev?: MouseEvent): void {
    ev?.stopPropagation();
    this.templateService.remove(saved.id).subscribe(list => {
      this.savedTemplates = list;
      if (this.armedTemplateKey === saved.id) this.armedTemplateKey = null;
    });
  }

  private clearTemplateArm(): void {
    if (this.templateArmTimeout) {
      clearTimeout(this.templateArmTimeout);
      this.templateArmTimeout = null;
    }
  }

}
