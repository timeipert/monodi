import { ChangeDetectorRef, Component, EventEmitter, OnInit, Output } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ToastrService } from 'ngx-toastr';
import { APIService, Document, ProjectSettings } from '../api.service';
import { UserService } from '../user.service';
import { FINDING_TITLE, Finding, FindingKind, RelationReport, RelationType, checkRelations, relationTypes, withRelationFields } from './relations';

interface FindingGroup { kind: FindingKind; title: string; severity: Finding['severity']; items: Finding[] }

/** How many findings of one kind are listed; the rest is counted. */
const SHOWN = 12;

/**
 * Documents can refer to each other (a trope to its primary chant) and belong together in a unit (a play and its chants).
 * Both live in custom document fields. This dialog adds the fields, keeps the list of relation types (with the suffix their
 * related document gets in the print) and shows what is wrong in the data: a reference that leads nowhere, a circle, a
 * unit whose positions clash. Reading is free; the only writes are the fields and the type list, on a button each.
 */
@Component({
  selector: 'app-relations-dialog',
  standalone: false,
  template: `
  <div class="modal fade show d-block" tabindex="-1" style="background: rgba(0,0,0,0.55); z-index: 2000;" data-testid="relations-dialog" (click)="!busy && close()">
    <div class="modal-dialog modal-lg modal-dialog-centered modal-dialog-scrollable" (click)="$event.stopPropagation()">
      <div class="modal-content shadow-lg border-0">
        <div class="modal-header">
          <h5 class="modal-title"><i class="bi bi-diagram-3 me-2"></i>Relations and units</h5>
        </div>
        <div class="modal-body small">
          @if (error) { <div class="alert alert-danger py-2" data-testid="relations-error">{{ error }}</div> }
          @if (loading) {
            <div class="text-muted"><span class="spinner-border spinner-border-sm me-2"></span>Reading the documents …</div>
          } @else {
            <p class="text-muted">
              A <strong>relation</strong> says that a document refers to another one of its manuscript: the trope to the antiphon that is its primary chant.
              Enter the other document's ID in <em>Related document</em>. A <strong>unit</strong> groups documents that belong together on a higher level than
              their genre, such as a play: give them the same <em>Unit ID</em>, a <em>Unit type</em> and, if the document IDs do not already put them in order, a <em>Position in unit</em>.
            </p>

            <h6 class="mt-3">Fields</h6>
            @if (missingFields) {
              <p class="mb-2">The five fields (related document, relation type, unit ID, unit type, position) are not among the document fields yet.</p>
              <button type="button" class="btn btn-sm btn-primary" [disabled]="busy" (click)="addFields()" data-testid="relations-add-fields">Add the fields</button>
            } @else {
              <p class="mb-0 text-success"><i class="bi bi-check-lg me-1"></i>The fields are there; they show in the table, in the document form and as placeholders.</p>
            }

            <h6 class="mt-4">Relation types</h6>
            <p class="text-muted mb-2">The name goes into <em>Relation type</em>. The suffix is set behind the number of the related document in the print: the antiphon of trope 1 is 1P.</p>
            @for (t of types; track $index) {
              <div class="d-flex gap-2 mb-1 align-items-center">
                <input type="text" class="form-control form-control-sm" style="max-width: 16rem" [(ngModel)]="t.name" (ngModelChange)="typesDirty = true" placeholder="Name, e.g. Primary chant" aria-label="Relation type name" data-testid="relations-type-name" />
                <input type="text" class="form-control form-control-sm" style="max-width: 5rem" [(ngModel)]="t.suffix" (ngModelChange)="typesDirty = true" placeholder="P" aria-label="Suffix" data-testid="relations-type-suffix" />
                <button type="button" class="btn btn-sm btn-outline-secondary" aria-label="Remove type" [disabled]="types.length < 2" (click)="removeType($index)"><i class="bi bi-x-lg"></i></button>
              </div>
            }
            <div class="d-flex gap-2 mt-2">
              <button type="button" class="btn btn-sm btn-outline-primary" (click)="addType()"><i class="bi bi-plus-lg me-1"></i>Add a type</button>
              <button type="button" class="btn btn-sm btn-primary" [disabled]="busy || !typesDirty" (click)="saveTypes()" data-testid="relations-save-types">Save the types</button>
            </div>

            <h6 class="mt-4">Check</h6>
            @if (report; as r) {
              <p class="mb-2" data-testid="relations-summary">
                <strong>{{ r.relations }}</strong> {{ r.relations === 1 ? 'document has' : 'documents have' }} a related document, <strong>{{ r.units }}</strong> {{ r.units === 1 ? 'unit' : 'units' }}.
                @if (!r.findings.length) { <span class="text-success"><i class="bi bi-check-lg ms-1 me-1"></i>Nothing to correct.</span> }
              </p>
              @for (g of groups; track g.kind) {
                <div class="mb-2" [attr.data-testid]="'relations-group-' + g.kind">
                  <div [class.text-danger]="g.severity === 'error'" [class.text-warning-emphasis]="g.severity === 'warning'" class="fw-semibold">
                    {{ g.title }} <span class="badge text-bg-light">{{ g.items.length }}</span>
                  </div>
                  <ul class="list-unstyled mb-0 ms-2">
                    @for (f of g.items.slice(0, shown); track f.id + f.kind) {
                      <li>
                        <a href="javascript:void(0)" class="fw-semibold" (click)="show.emit(f.dokumentenId)" title="Find this document in the table">{{ f.dokumentenId }}</a>
                        <span class="text-muted ms-2">{{ f.message }}</span>
                      </li>
                    }
                    @if (g.items.length > shown) { <li class="text-muted">… and {{ g.items.length - shown }} more</li> }
                  </ul>
                </div>
              }
            }
          }
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-outline-secondary" [disabled]="busy" (click)="close()">Close</button>
        </div>
      </div>
    </div>
  </div>`,
})
export class RelationsDialogComponent implements OnInit {
  /** After the workspace was changed, so the page reloads its tables. */
  @Output() applied = new EventEmitter<void>();
  /** The user asked to find a document in the table. */
  @Output() show = new EventEmitter<string>();
  @Output() closed = new EventEmitter<void>();

  readonly shown = SHOWN;
  loading = true;
  busy = false;
  error = '';
  missingFields = false;
  types: RelationType[] = [];
  typesDirty = false;
  report: RelationReport | null = null;
  groups: FindingGroup[] = [];

  private documents: Document[] = [];

  constructor(private api: APIService, private users: UserService, private toastr: ToastrService, private cdr: ChangeDetectorRef) {}

  close(): void { this.closed.emit(); }

  async ngOnInit(): Promise<void> {
    try {
      await this.read();
    } catch (e: any) {
      console.warn('Relations could not be read', e);
      this.error = e?.message || 'The workspace could not be read.';
    } finally {
      this.loading = false;
      this.cdr.markForCheck();
    }
  }

  private async token(): Promise<string> { return (await firstValueFrom(this.users.user))?.token || ''; }

  private async settingsNow(token: string): Promise<ProjectSettings> {
    const res = await firstValueFrom(this.api.getSettings(token));
    if (res.kind !== 'SettingsRetrieved') throw new Error('The settings could not be read.');
    return res.settings;
  }

  /** Reads documents and settings and redraws everything from them. */
  private async read(): Promise<void> {
    const token = await this.token();
    const [docs, settings] = await Promise.all([firstValueFrom(this.api.listDocuments(token)), this.settingsNow(token)]);
    if (docs.kind !== 'DocumentsRetrieved') throw new Error('The workspace could not be read.');
    this.documents = docs.documents;
    this.missingFields = withRelationFields(settings) !== null;
    if (!this.typesDirty) this.types = relationTypes(settings).map((t) => ({ ...t }));
    this.report = checkRelations(this.documents, settings);
    const order: Finding['severity'][] = ['error', 'warning'];
    const by = new Map<FindingKind, FindingGroup>();
    for (const f of this.report.findings) {
      (by.get(f.kind) ?? by.set(f.kind, { kind: f.kind, title: FINDING_TITLE[f.kind], severity: f.severity, items: [] }).get(f.kind)!).items.push(f);
    }
    this.groups = [...by.values()].sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity));
  }

  addType(): void { this.types = [...this.types, { name: '', suffix: '' }]; this.typesDirty = true; }
  removeType(i: number): void { this.types = this.types.filter((_, k) => k !== i); this.typesDirty = true; }

  async addFields(): Promise<void> {
    await this.write(async (token) => {
      const next = withRelationFields(await this.settingsNow(token));
      if (next) await firstValueFrom(this.api.updateSettings(token, next));
      this.toastr.success('The relation and unit fields were added.');
      this.applied.emit();
    });
  }

  async saveTypes(): Promise<void> {
    const clean = this.types.map((t) => ({ name: t.name.trim(), suffix: t.suffix.trim() })).filter((t) => t.name);
    if (!clean.length) { this.error = 'There must be at least one relation type.'; return; }
    const names = clean.map((t) => t.name.toLowerCase());
    if (new Set(names).size !== names.length) { this.error = 'Two relation types have the same name.'; return; }
    await this.write(async (token) => {
      const settings = await this.settingsNow(token);
      await firstValueFrom(this.api.updateSettings(token, { ...settings, relationTypes: clean }));
      this.typesDirty = false;
      this.types = clean;
      this.toastr.success('The relation types were saved.');
    });
  }

  /** One write at a time; the busy flag clears on failure too. */
  private async write(job: (token: string) => Promise<void>): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.error = '';
    try {
      await job(await this.token());
      await this.read();
    } catch (e: any) {
      console.error('Saving the relations failed', e);
      this.error = 'Saving failed: ' + (e?.message || e);
    } finally {
      this.busy = false;
      this.cdr.markForCheck();
    }
  }
}
