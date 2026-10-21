import { ChangeDetectorRef, Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ToastrService } from 'ngx-toastr';
import { APIService } from '../api.service';
import { UserService } from '../user.service';
import { FieldChoice, SiglePlan, sigleText } from '../source-sigle';

/**
 * Renames the siglum of a source, or merges the source into the one that already has that siglum. The person types the
 * new siglum; if another source has it the dialog is about a merge, otherwise about a rename. Nothing is written before
 * the button: until then the dialog shows what would change, and the conflicts of a merge to decide.
 */
@Component({
  selector: 'app-sigle-dialog',
  standalone: false,
  template: `
  <div class="modal fade show d-block" tabindex="-1" style="background: rgba(0,0,0,0.55); z-index: 2000;" data-testid="sigle-dialog" (click)="!busy && close()">
    <div class="modal-dialog modal-lg modal-dialog-centered modal-dialog-scrollable" (click)="$event.stopPropagation()">
      <div class="modal-content shadow-lg border-0">
        <div class="modal-header">
          <h5 class="modal-title"><i class="bi bi-tag me-2"></i>Siglum</h5>
        </div>
        <div class="modal-body small">
          <datalist id="sigle-dialog-known">@for (s of known; track s) { <option [value]="s"></option> }</datalist>
          <div class="input-group input-group-sm mb-3">
            <span class="input-group-text">{{ sigle }}</span>
            <span class="input-group-text"><i class="bi bi-arrow-right"></i></span>
            <input class="form-control" list="sigle-dialog-known" [(ngModel)]="newSigle" (ngModelChange)="refresh()" aria-label="New siglum" data-testid="sigle-input" autofocus />
          </div>

          @if (error) { <div class="alert alert-danger py-2" data-testid="sigle-error">{{ error }}</div> }

          @if (plan; as p) {
            @for (problem of p.problems; track problem) {
              <div class="alert alert-danger py-2" data-testid="sigle-problem">{{ problem }}</div>
            }

            @if (p.kind === 'rename') {
              <div data-testid="sigle-preview" data-kind="rename">
                <p class="mb-2">The siglum becomes <strong>{{ p.newSigle }}</strong>. The {{ p.documents.kept }} {{ p.documents.kept === 1 ? 'document stays' : 'documents stay' }} where {{ p.documents.kept === 1 ? 'it is' : 'they are' }}.</p>
                @if (p.idsWithOldSigle > 0) {
                  <p class="mb-2 text-muted" data-testid="sigle-ids">{{ p.idsWithOldSigle }} document {{ p.idsWithOldSigle === 1 ? 'ID starts' : 'IDs start' }} with the old siglum and {{ p.idsWithOldSigle === 1 ? 'is' : 'are' }} left as {{ p.idsWithOldSigle === 1 ? 'it is' : 'they are' }}.</p>
                }
              </div>
            }

            @if (p.kind === 'merge') {
              <div data-testid="sigle-preview" data-kind="merge">
                <p class="mb-2">
                  <strong>{{ p.oldSigle }}</strong> is merged into <strong>{{ p.newSigle }}</strong>, which has this siglum already.
                  <strong data-testid="sigle-moved">{{ p.documents.moved }}</strong> {{ p.documents.moved === 1 ? 'document moves' : 'documents move' }} over
                  ({{ p.newSigle }} has {{ p.documents.kept }}). {{ p.oldSigle }} is removed.
                </p>
                @if (p.documents.duplicates > 0) {
                  <p class="mb-2 text-muted" data-testid="sigle-duplicates">{{ p.documents.duplicates }} {{ p.documents.duplicates === 1 ? 'document is' : 'documents are' }} in both, identical, and kept once.</p>
                }
                @if (p.documents.clashingIdsTotal > 0) {
                  <div class="alert alert-warning py-2" data-testid="sigle-clashes">
                    {{ p.documents.clashingIdsTotal }} document {{ p.documents.clashingIdsTotal === 1 ? 'ID is' : 'IDs are' }} used in both: {{ p.documents.clashingIds.join(', ') }}{{ p.documents.clashingIdsTotal > p.documents.clashingIds.length ? ' …' : '' }}.
                    They stay as they are; related documents that point to one of them will find two.
                  </div>
                }
                @if (p.annotationsTaken > 0) {
                  <p class="mb-2 text-muted">{{ p.annotationsTaken }} annotations of {{ p.oldSigle }} are added to {{ p.newSigle }}.</p>
                }
                @if (p.conflicts.length > 0) {
                  <table class="table table-sm align-middle mb-2" data-testid="sigle-conflicts">
                    <thead><tr><th></th><th>{{ p.newSigle }}</th><th>{{ p.oldSigle }}</th><th>Keep</th></tr></thead>
                    <tbody>
                      @for (c of p.conflicts; track c.key) {
                        <tr>
                          <td class="text-muted">{{ c.label }}</td>
                          <td class="text-break" style="max-width: 14rem">{{ clip(c.kept) }}</td>
                          <td class="text-break" style="max-width: 14rem">{{ clip(c.other) }}</td>
                          <td>
                            <select class="form-select form-select-sm" [ngModel]="c.choice" (ngModelChange)="choose(c.key, $event)" [attr.data-testid]="'sigle-choice-' + c.key" aria-label="Keep">
                              <option value="kept">{{ p.newSigle }}</option>
                              <option value="other">{{ p.oldSigle }}</option>
                              @if (c.canJoin) { <option value="both">both</option> }
                            </select>
                          </td>
                        </tr>
                      }
                    </tbody>
                  </table>
                }
              </div>
            }

            @if (p.kind !== 'none') {
              @if (settingsChanged(p)) {
                <p class="mb-2" data-testid="sigle-settings">
                  Settings follow:
                  @if (p.settings.siglumList) { the list of sigla; }
                  @if (p.settings.meiRulesMoved) { {{ p.settings.meiRulesMoved }} MEI {{ p.settings.meiRulesMoved === 1 ? 'rule' : 'rules' }}; }
                  @if (p.settings.meiRulesDropped) { {{ p.settings.meiRulesDropped }} MEI {{ p.settings.meiRulesDropped === 1 ? 'rule' : 'rules' }} dropped (the other siglum has one for the same neume); }
                  @if (p.settings.volumeRules) { {{ p.settings.volumeRules }} volume {{ p.settings.volumeRules === 1 ? 'rule' : 'rules' }}; }
                  they reach GitHub with a push of everything, not of a selection.
                </p>
              }
              <p class="mb-0 text-muted" data-testid="sigle-upload">
                @if (p.kind === 'rename') { Push uploads this manuscript. }
                @else { Push uploads {{ p.newSigle }} first, then deletes {{ p.oldSigle }} from GitHub. }
              </p>
            }
          }
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-sm btn-outline-secondary" [disabled]="busy" (click)="close()" data-testid="sigle-cancel">Cancel</button>
          <button type="button" class="btn btn-sm btn-primary" [disabled]="!canApply" (click)="apply()" data-testid="sigle-apply">{{ plan?.kind === 'merge' ? 'Merge' : 'Rename' }}</button>
        </div>
      </div>
    </div>
  </div>
  `,
})
export class SigleDialogComponent implements OnInit {
  @Input() sourceId = '';
  @Input() sigle = '';
  @Output() closed = new EventEmitter<void>();
  /** The change was written; the id is that of the source that stays. */
  @Output() changed = new EventEmitter<string>();

  newSigle = '';
  plan: SiglePlan | null = null;
  known: string[] = [];
  busy = false;
  error = '';
  private choices: { [key: string]: FieldChoice } = {};
  private seq = 0;

  constructor(private api: APIService, private users: UserService, private toastr: ToastrService, private cdr: ChangeDetectorRef) {}

  get canApply(): boolean {
    return !this.busy && !!this.plan && this.plan.kind !== 'none' && this.plan.problems.length === 0;
  }

  close(): void { this.closed.emit(); }

  clip(text: string): string { return text.length > 200 ? text.slice(0, 200) + ' …' : text; }

  settingsChanged(p: SiglePlan): boolean {
    return p.settings.siglumList || p.settings.meiRulesMoved > 0 || p.settings.meiRulesDropped > 0 || p.settings.volumeRules > 0;
  }

  private async token(): Promise<string> { return (await firstValueFrom(this.users.user))?.token || ''; }

  async ngOnInit(): Promise<void> {
    this.newSigle = this.sigle;
    try {
      const res = await firstValueFrom(this.api.listSources(await this.token()));
      if (res.kind === 'SourcesRetrieved') {
        this.known = res.sources.filter((s) => s.id !== this.sourceId).map((s) => sigleText(s)).filter(Boolean).sort();
        this.cdr.markForCheck();
      }
    } catch (e) {
      console.warn('The list of sigla could not be read', e);
    }
  }

  choose(key: string, value: FieldChoice): void {
    this.choices = { ...this.choices, [key]: value };
    void this.refresh();
  }

  /** Plans again for what is typed. An answer that comes after a newer question is dropped. */
  async refresh(): Promise<void> {
    const mine = ++this.seq;
    this.error = '';
    try {
      const res = await firstValueFrom(this.api.previewSigleChange(await this.token(), { sourceId: this.sourceId, newSigle: this.newSigle, choices: this.choices }));
      if (mine !== this.seq) return;
      if (res.kind === 'SigleChangePlanned') {
        // choices belong to the other source: another target, other conflicts
        if (this.plan && res.plan.kind === 'merge' && this.plan.keepId !== res.plan.keepId) this.choices = {};
        this.plan = res.plan;
      }
    } catch (e: any) {
      if (mine === this.seq) this.error = e?.message || 'The change could not be planned.';
    } finally {
      this.cdr.markForCheck();
    }
  }

  async apply(): Promise<void> {
    if (!this.canApply) return;
    this.busy = true;
    this.error = '';
    try {
      const res = await firstValueFrom(this.api.changeSigle(await this.token(), { sourceId: this.sourceId, newSigle: this.newSigle, choices: this.choices }));
      if (res.kind === 'SigleChanged') {
        this.toastr.success(res.plan.kind === 'merge' ? `Merged into ${res.plan.newSigle}.` : `Renamed to ${res.plan.newSigle}.`);
        this.changed.emit(res.plan.keepId);
      } else if (res.kind === 'SigleChangeRefused') {
        this.plan = res.plan;
      }
    } catch (e: any) {
      console.error('Changing the siglum failed', e);
      this.error = e?.message || 'The change could not be saved.';
    } finally {
      this.busy = false;
      this.cdr.markForCheck();
    }
  }
}
