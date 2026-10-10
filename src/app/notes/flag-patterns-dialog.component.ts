import { Component, Input, OnInit } from '@angular/core';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { UndoService } from '../undoService';
import * as VM from '../types/model';
import { FlagMatch, FlagQuery, applyFlag, findFlagMatches, queryProblem } from './flag-patterns';
import { NoteFlagDef, getNoteFlagDefs } from './note-flags';

/** Rows drawn at most; the counts and the Apply button always cover every match. */
const MAX_ROWS = 300;

@Component({
  selector: 'app-flag-patterns-dialog',
  templateUrl: './flag-patterns-dialog.component.html',
  standalone: false
})
export class FlagPatternsDialogComponent implements OnInit {
  /** The document being edited; changed in place when the user applies. */
  @Input() root!: VM.RootContainer;
  /** Pre-filled query, e.g. from "Flag neumes like this" in the note menu. */
  @Input() initialPattern = '';

  query: FlagQuery = { text: '', mode: 'whole', ignoreShapes: true, target: 'first', nth: 1 };
  flagKey = '';
  action: 'add' | 'remove' = 'add';

  matches: FlagMatch[] = [];
  /** Ids of matches the user switched off. */
  excluded = new Set<string>();
  problem: string | null = null;

  readonly flags: NoteFlagDef[] = getNoteFlagDefs();
  readonly examples = [
    { code: '*u', text: 'two notes, not ligated, second one higher' },
    { code: '[*ud]', text: 'a ligature: up, then down' },
    { code: '*??', text: 'three notes, not ligated, any steps' },
    { code: 'ud', text: 'up then down, anywhere in a neume (mode: Inside a neume)' }
  ];
  readonly chips = ['*', 'u', 'd', 'e', '?', '[', ']'];

  constructor(public modal: NgbActiveModal, private undo: UndoService) {}

  ngOnInit(): void {
    this.query.text = this.initialPattern;
    this.flagKey = this.flags[0]?.key ?? '';
    this.refresh();
  }

  refresh(): void {
    this.problem = queryProblem(this.query.text);
    this.matches = this.problem ? [] : findFlagMatches(this.root, this.query);
    const ids = new Set(this.matches.map(m => m.id));
    this.excluded.forEach(id => { if (!ids.has(id)) this.excluded.delete(id); });
  }

  addChip(c: string): void {
    this.query.text += c;
    this.refresh();
  }

  setExample(code: string): void {
    this.query.text = code;
    this.query.mode = code.includes('*') || code.includes('[') ? 'whole' : 'contains';
    this.refresh();
  }

  /** Would applying change this match at all (the flag is missing / present on a target)? */
  changes(m: FlagMatch): boolean {
    return m.targets.some(n => (n.flags ?? []).includes(this.flagKey) !== (this.action === 'add'));
  }

  get shown(): FlagMatch[] { return this.matches.slice(0, MAX_ROWS); }
  get hidden(): number { return Math.max(0, this.matches.length - MAX_ROWS); }
  get chosen(): FlagMatch[] { return this.matches.filter(m => !this.excluded.has(m.id) && this.changes(m)); }
  get unchanged(): number { return this.matches.filter(m => !this.changes(m)).length; }
  get noteCount(): number { return new Set(this.chosen.flatMap(m => m.targets.map(n => n.uuid))).size; }
  get flag(): NoteFlagDef | undefined { return this.flags.find(f => f.key === this.flagKey); }

  toggle(m: FlagMatch): void {
    if (this.excluded.has(m.id)) this.excluded.delete(m.id); else this.excluded.add(m.id);
  }

  selectAll(on: boolean): void {
    this.excluded = on ? new Set() : new Set(this.matches.map(m => m.id));
  }

  isTarget(m: FlagMatch, n: VM.Note): boolean { return m.targets.includes(n); }

  noteLabel(n: VM.Note): string {
    const typed = n.noteType !== VM.NoteType.Normal ? VM.noteTypeToString(n.noteType) : '';
    return n.base.toLowerCase() + typed + (n.liquescent ? 'l' : '') + (n.flags?.join('') ?? '');
  }

  apply(): void {
    if (!this.flagKey || this.chosen.length === 0) return;
    this.undo.beforeChange('Flag patterns');
    this.modal.close({ ...applyFlag(this.chosen, this.flagKey, this.action), key: this.flagKey, action: this.action });
  }
}
