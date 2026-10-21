import { ApplicationRef, Component, EnvironmentInjector, EventEmitter, Injectable, Input, OnDestroy, OnInit, Output, createComponent } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { firstValueFrom } from 'rxjs';
import * as JSZip from 'jszip';
import * as VM from './types/model';
import { APIService, Document, ProjectSettings, Source } from './api.service';
import { UserService } from './user.service';
import { PdfBoxLabel, PdfDocJob, PdfExportService } from './pdf-export.service';
import { genreOf } from './document-metadata';
import { compareNatural } from '../utils';
import { safeStorage } from './safe-storage';
import { downloadBlob } from './download';
import { FieldDef, FieldJob, fieldValue, placeholderCatalog, splitFields, splitKey, splitLabel as splitSpecLabel, splitSpec } from './print/fields';
import { groupItems, volumeFileNames } from './print/groups';
import { checkPrintSet } from './relations/relations';
import { RULES_SPLIT, RULE_OPS, VolumeRule, groupByRules, parseRuleValues, usableRules } from './print/volume-rules';
import { HOLD_REASON_LABEL, holdReasons, isPrintable } from './release/printable';
import { MAX_BLOCKS, TITLE_PRESETS, TitleBlock, TitleTemplate, newBlock, sanitizeTitleTemplate } from './print/title-page';

interface Entry { id: string; doc: Document | null; job: PdfDocJob | null; }
interface GroupRow { key: string; label: string; count: number; on: boolean; }
/** A volume rule as it is edited: the values as one text, and the values the selection has in the field as a hint. */
interface RuleRow { name: string; field: string; op: VolumeRule['op']; valuesText: string; each: boolean; hint: string; }

interface DialogOptions {
  titlePage: boolean;
  contents: boolean;
  metadata: boolean;
  apparatus: boolean;
  sourceDescription: boolean;
  notationDocumentation: boolean;
  neumeTree: boolean;
  newPage: boolean;
  /** Units stand together, a related document behind its trope. */
  arrangeRelated: boolean;
  /** Related documents directly behind their trope instead of in a section behind the others. */
  relatedBehind: boolean;
  pageFormat: 'settings' | 'cm' | 'a4';
  boxLabel: PdfBoxLabel;
  /** A cover page from the cover template. */
  cover: boolean;
  /** The cover and the title page count as pages (the edition begins at page 3). */
  countFront: boolean;
}

const OPTIONS_KEY = (multi: boolean) => `monodi_pdf_dialog_${multi ? 'multi' : 'single'}`;
/** The cover template is kept apart from the other options: it is shared by prints of one and of several documents. */
const COVER_KEY = 'monodi_pdf_cover_template';

/**
 * Print one or several documents as a PDF typeset like the printed edition.
 * One document: optional title page with a metadata table. Several documents: they run on in
 * one flow (each begins with a heading line), a contents table (ID, incipit, genre, page) on
 * the title page, one collected apparatus divided by document. Opened from the document view,
 * the search results, a manuscript, the synopsis and the workspace export.
 */
@Component({
  selector: 'app-pdf-export-dialog',
  standalone: false,
  template: `
  <div class="modal fade show d-block" tabindex="-1" style="background: rgba(0,0,0,0.5); z-index: 2000;" (keydown.escape)="!busy && close()">
    <div class="modal-dialog modal-xl modal-dialog-centered modal-dialog-scrollable">
      <div class="modal-content shadow">
        <div class="modal-header bg-light border-bottom pb-0 flex-column align-items-stretch">
          <h5 class="modal-title fw-bold mb-2">
            <i class="bi bi-file-pdf me-2 text-danger"></i>Print as PDF
            <span class="badge bg-secondary-subtle text-secondary fw-normal ms-2">{{entries.length}} document{{entries.length === 1 ? '' : 's'}}</span>
          </h5>
          <ul class="nav nav-tabs border-0">
            <li class="nav-item"><button type="button" class="nav-link" [class.active]="tab === 'print'" (click)="tab = 'print'">Print</button></li>
            <li class="nav-item"><button type="button" class="nav-link" [class.active]="tab === 'cover'" (click)="openCover()">
              Cover page @if (o.cover) { <i class="bi bi-check-circle-fill text-success ms-1"></i> }</button></li>
            <li class="nav-item"><button type="button" class="nav-link" [class.active]="tab === 'volumes'" (click)="tab = 'volumes'">
              Volumes @if (splitBy) { <span class="badge bg-primary ms-1">{{selectedGroupCount}}</span> }</button></li>
          </ul>
        </div>

        <div class="modal-body p-0">
          <!-- ── Print ──────────────────────────────────────────────────── -->
          @if (tab === 'print') {
          <div class="row g-0">
            <!-- Documents -->
            <div class="col-md-6 border-end p-3">
              <div class="d-flex align-items-center justify-content-between mb-2">
                <div class="small fw-semibold text-uppercase text-muted" style="letter-spacing: .06em;">Documents</div>
                @if (entries.length > 1) {
                  <div class="btn-group btn-group-sm" role="group" aria-label="Sort">
                    <button type="button" class="btn btn-outline-secondary" (click)="sortBy('id')" [disabled]="busy" title="Sort by document ID">ID</button>
                    <button type="button" class="btn btn-outline-secondary" (click)="sortBy('incipit')" [disabled]="busy" title="Sort by incipit">Incipit</button>
                    <button type="button" class="btn btn-outline-secondary" (click)="sortBy('genre')" [disabled]="busy" title="Sort by genre">Genre</button>
                  </div>
                }
              </div>
              @if (heldTotal > 0) {
                <div class="alert py-2 px-3 small" [class.alert-warning]="holdBack" [class.alert-danger]="!holdBack" data-testid="pdf-hold">
                  <div class="form-check form-switch mb-0">
                    <input class="form-check-input" type="checkbox" id="oHold" [(ngModel)]="holdBack" [disabled]="busy" (ngModelChange)="holdChanged()" data-testid="pdf-hold-switch">
                    <label class="form-check-label fw-medium" for="oHold">Hold back documents that must not be printed ({{heldTotal}})</label>
                  </div>
                  @if (holdBack) {
                    <details class="mt-1">
                      <summary>Which and why</summary>
                      <ul class="mb-0 ps-3" style="max-height: 120px; overflow: auto;">
                        @for (h of held; track h.id) { <li>{{h.doc?.dokumenten_id}} <span class="text-muted">– {{reasonText(h)}}</span></li> }
                      </ul>
                    </details>
                  } @else if (flaggedIn > 0) {
                    <div class="mt-1"><strong>{{flaggedIn}}</strong> document{{flaggedIn === 1 ? '' : 's'}} marked "don't publish" will be printed.</div>
                  }
                </div>
              }
              @if (printWarnings.length) {
                <div class="alert alert-warning py-2 px-3 small" data-testid="pdf-unit-warnings">
                  <div class="fw-medium"><i class="bi bi-exclamation-triangle me-1"></i>Documents that belong together are not all printed</div>
                  <ul class="mb-0 ps-3" style="max-height: 120px; overflow: auto;">
                    @for (w of printWarnings; track w) { <li>{{w}}</li> }
                  </ul>
                </div>
              }
              @if (!entries.length && held.length) {
                <div class="text-muted small mb-2" data-testid="pdf-all-held">All {{held.length}} documents are held back.</div>
              }
              <ol class="list-unstyled mb-0 pdf-doc-list" style="max-height: 340px; overflow: auto;">
                @for (e of entries; track e.id; let i = $index) {
                  <li class="d-flex align-items-start gap-2 py-1 border-bottom">
                    <span class="text-muted small text-end" style="width: 1.6rem;">{{i + 1}}</span>
                    <div class="flex-grow-1 small" style="min-width: 0;">
                      @if (e.doc) {
                        <div class="text-truncate"><span class="fw-semibold">{{e.doc.dokumenten_id}}</span><span class="fst-italic ms-2">{{e.doc.textinitium}}</span></div>
                        @if (genre(e.doc)) { <div class="text-secondary text-truncate" style="font-size: .78rem;">{{genre(e.doc)}}</div> }
                      } @else {
                        <span class="text-muted">Loading…</span>
                      }
                    </div>
                    <div class="btn-group btn-group-sm flex-shrink-0">
                      <button type="button" class="btn btn-link text-secondary px-1" (click)="move(i, -1)" [disabled]="busy || i === 0" title="Move up"><i class="bi bi-chevron-up"></i></button>
                      <button type="button" class="btn btn-link text-secondary px-1" (click)="move(i, 1)" [disabled]="busy || i === entries.length - 1" title="Move down"><i class="bi bi-chevron-down"></i></button>
                      <button type="button" class="btn btn-link text-danger px-1" (click)="remove(i)" [disabled]="busy" title="Leave out"><i class="bi bi-x-lg"></i></button>
                    </div>
                  </li>
                }
              </ol>
              @if (entries.length > 150) {
                <div class="alert alert-warning small mt-2 mb-0 py-2">Printing {{entries.length}} documents can take a few minutes.</div>
              }
            </div>

            <!-- Options -->
            <div class="col-md-6 p-3">
              <div class="small fw-semibold text-uppercase text-muted mb-2" style="letter-spacing: .06em;">Options</div>
              @if (multi || o.cover) {
                <label class="form-label small text-muted mb-1" for="pdfTitle">Title <span class="text-muted">(placeholder <code>$titel$</code> on the cover)</span></label>
                <input id="pdfTitle" class="form-control form-control-sm mb-3" [(ngModel)]="title" [disabled]="busy" (ngModelChange)="previewSoon()" placeholder="Optional">
              }
              <label class="form-label small text-muted mb-1" for="pdfFormat">Page format</label>
              <select id="pdfFormat" class="form-select form-select-sm mb-3" [(ngModel)]="o.pageFormat" [disabled]="busy" (ngModelChange)="save(); previewSoon()">
                <option value="settings">As in the settings</option>
                <option value="cm">Print edition (21 × 27 cm)</option>
                <option value="a4">A4</option>
              </select>

              <div class="form-check form-switch mb-1">
                <input class="form-check-input" type="checkbox" id="oCover" [(ngModel)]="o.cover" [disabled]="busy" (ngModelChange)="save()">
                <label class="form-check-label fw-medium" for="oCover">Cover page</label>
                <div class="form-text mt-0">Set from a template with placeholders — <a href="javascript:void(0)" (click)="openCover()">edit the template</a>.</div>
              </div>
              <div class="form-check form-switch mb-1 mt-2">
                <input class="form-check-input" type="checkbox" id="oTitle" [(ngModel)]="o.titlePage" [disabled]="busy" (ngModelChange)="save()">
                <label class="form-check-label fw-medium" for="oTitle">{{ o.cover ? 'Title page' + (multi ? ' with contents' : ' with metadata') : 'Title page' }}</label>
              </div>
              @if (multi) {
                <div class="form-check form-switch mb-1 ms-4">
                  <input class="form-check-input" type="checkbox" id="oContents" [(ngModel)]="o.contents" [disabled]="busy || !o.titlePage" (ngModelChange)="save()">
                  <label class="form-check-label" for="oContents">Contents (ID, incipit, genre, page)</label>
                </div>
              }
              <div class="form-check form-switch mb-1 mt-2">
                <input class="form-check-input" type="checkbox" id="oMeta" [(ngModel)]="o.metadata" [disabled]="busy" (ngModelChange)="save()">
                <label class="form-check-label fw-medium" for="oMeta">Metadata</label>
                <div class="form-text mt-0">{{ multi ? 'A line under each document\\'s heading.' : (o.titlePage ? 'A table on the title page.' : 'A line under the title.') }}</div>
              </div>
              @if (o.cover || o.titlePage) {
                <div class="form-check form-switch mb-1 mt-2">
                  <input class="form-check-input" type="checkbox" id="oCount" [(ngModel)]="o.countFront" [disabled]="busy" (ngModelChange)="save()">
                  <label class="form-check-label fw-medium" for="oCount">Number the pages from the cover</label>
                  <div class="form-text mt-0">As in a printed volume: cover and contents are pages 1 and 2, the edition begins at page 3. Off: the edition is page 1.</div>
                </div>
              }
              @if (multi) {
                <div class="form-check form-switch mb-1 mt-2">
                  <input class="form-check-input" type="checkbox" id="oBox" [ngModel]="o.boxLabel !== 'none'" (ngModelChange)="o.boxLabel = $event ? 'number' : 'none'; save()" [disabled]="busy">
                  <label class="form-check-label fw-medium" for="oBox">Framed number</label>
                  <div class="form-text mt-0">Running number of each document within its manuscript (every manuscript is a chapter).</div>
                </div>
              }
              <div class="form-check form-switch mb-1 mt-2">
                <input class="form-check-input" type="checkbox" id="oApp" [(ngModel)]="o.apparatus" [disabled]="busy" (ngModelChange)="save()">
                <label class="form-check-label fw-medium" for="oApp">Critical apparatus</label>
                <div class="form-text mt-0">{{ multi ? 'Collected after the editions, divided by document.' : 'The comments, after the edition.' }}</div>
              </div>
              <div class="form-check form-switch mb-1 mt-2">
                <input class="form-check-input" type="checkbox" id="oDesc" [(ngModel)]="o.sourceDescription" [disabled]="busy" (ngModelChange)="save()">
                <label class="form-check-label fw-medium" for="oDesc">Source description</label>
                <div class="form-text mt-0">{{ multi ? 'The Markdown description of each manuscript, after the apparatus.' : 'The Markdown description of the manuscript, after the apparatus.' }} Written on the manuscript's Description tab.</div>
              </div>
              <div class="form-check form-switch mb-1 mt-2">
                <input class="form-check-input" type="checkbox" id="oNot" [(ngModel)]="o.notationDocumentation" [disabled]="busy" (ngModelChange)="save()">
                <label class="form-check-label fw-medium" for="oNot">Notation documentation</label>
                <div class="form-text mt-0">The neume table of each manuscript with where its signs are seen, and strips of those lines from the manuscript images (needs the manifest; online), after the source descriptions. Which patterns it shows is set in Settings → Notation and per manuscript.</div>
              </div>
              @if (o.notationDocumentation) {
                <div class="form-check form-switch mb-1 mt-2 ms-3">
                  <input class="form-check-input" type="checkbox" id="oTree" [(ngModel)]="o.neumeTree" [disabled]="busy" (ngModelChange)="save()">
                  <label class="form-check-label fw-medium" for="oTree">Neume tree</label>
                  <div class="form-text mt-0">The patterns as a tree: by number of notes from left to right, each grown out of the shorter one it contains.</div>
                </div>
              }
              @if (multi) {
                <div class="form-check form-switch mb-1 mt-2">
                  <input class="form-check-input" type="checkbox" id="oNew" [(ngModel)]="o.newPage" [disabled]="busy" (ngModelChange)="save()">
                  <label class="form-check-label fw-medium" for="oNew">Every document on a new page</label>
                  <div class="form-text mt-0">Off: documents run on, each begins with a heading line (compact, like the printed edition).</div>
                </div>
                <div class="form-check form-switch mb-1 mt-2">
                  <input class="form-check-input" type="checkbox" id="oArrange" [(ngModel)]="o.arrangeRelated" [disabled]="busy" (ngModelChange)="save()" data-testid="pdf-arrange">
                  <label class="form-check-label fw-medium" for="oArrange">Keep units and related documents together</label>
                  <div class="form-text mt-0">A unit (a play) is a chapter of its own, in the order of its positions. What a trope names as its related document (its primary chant) is numbered like it: 1, 1P, and stands in a section behind the others, as in the printed volume.</div>
                </div>
                @if (o.arrangeRelated) {
                  <div class="form-check form-switch mb-1 mt-2 ms-4">
                    <input class="form-check-input" type="checkbox" id="oBehind" [(ngModel)]="o.relatedBehind" [disabled]="busy" (ngModelChange)="save()" data-testid="pdf-behind">
                    <label class="form-check-label fw-medium" for="oBehind">Directly behind their trope</label>
                  </div>
                }
              }
              <label class="form-label small text-muted mb-1 mt-3" for="pdfFile">File name</label>
              <div class="input-group input-group-sm">
                <input id="pdfFile" class="form-control" [(ngModel)]="fileBase" [disabled]="busy" placeholder="Document">
                <span class="input-group-text">{{ splitBy && selectedGroupCount > 1 ? '_….pdf in a .zip' : '.pdf' }}</span>
              </div>
            </div>
          </div>
          }

          <!-- ── Volumes ────────────────────────────────────────────────── -->
          @if (tab === 'volumes') {
          <div class="p-3">
            <p class="small text-muted mb-3">
              Make one PDF per group of documents — all documents of one manuscript, of one region of origin, of one genre …
              Every volume gets its own cover (with the placeholders filled in for its documents), title page, contents and apparatus.
              Several volumes come as one ZIP file.
            </p>
            <div class="row g-3">
              <div class="col-md-5">
                <label class="form-label small text-muted mb-1" for="splitBy">Split by</label>
                <select id="splitBy" class="form-select form-select-sm" [(ngModel)]="splitBy" [disabled]="busy || entries.length < 2" (ngModelChange)="splitChanged()">
                  <option value="">Nothing — one PDF</option>
                  @for (f of splitOptions; track f.key) { <option [value]="f.key">{{f.label}}{{ f.scope === 'source' && f.key !== 'quelle-id' ? ' (manuscript)' : '' }}</option> }
                  <option [value]="rulesSplit">Volume rules (several values in one volume) …</option>
                </select>
                @if (splitBy && splitBy !== rulesSplit) {
                  <label class="form-label small text-muted mt-2 mb-1" for="splitThen">and (optional)</label>
                  <select id="splitThen" class="form-select form-select-sm" [(ngModel)]="splitThen" [disabled]="busy" (ngModelChange)="splitChanged()">
                    <option value="">Nothing</option>
                    @for (f of splitOptions; track f.key) { @if (f.key !== splitBy) { <option [value]="f.key">{{f.label}}{{ f.scope === 'source' && f.key !== 'quelle-id' ? ' (manuscript)' : '' }}</option> } }
                  </select>
                  <div class="form-text">With a second field every combination is a volume: genre &amp; place of origin gives "Tropes from Germany", "Tropes from France", "Sequences from Germany" ….</div>
                }
                @if (entries.length < 2) { <div class="form-text">Needs at least two documents.</div> }
                @if (splitBy) {
                  <div class="form-text">The placeholder <code>$gruppe$</code> stands for the {{ splitBy === rulesSplit ? 'name' : 'value' }} of the volume, <code>$gruppenfeld$</code> for the name of {{ splitBy === rulesSplit ? 'the split' : (splitThen ? 'the fields' : 'this field') }}.
                    @if (splitThen) { <code>$gruppe1$</code> and <code>$gruppe2$</code> are the two values apart ("$gruppe1$ from $gruppe2$"). }</div>
                }
              </div>
              @if (splitBy === rulesSplit) {
                <div class="col-12" data-testid="vr-editor">
                  <div class="small text-muted mb-2">
                    The first rule that fits a document decides its volume, so put the rule for a play (<em>Unit ID has a value</em>) before the rules for genres.
                    Documents that no rule fits come last. The volumes are printed in the order of the rules.
                  </div>
                  @for (r of ruleRows; track r; let i = $index) {
                    <div class="d-flex flex-wrap align-items-start gap-2 mb-2 border rounded p-2" [attr.data-testid]="'vr-rule-' + i">
                      <span class="badge text-bg-secondary mt-1">{{i + 1}}</span>
                      <input type="text" class="form-control form-control-sm" style="width: 12rem" [(ngModel)]="r.name" (ngModelChange)="rulesChanged()" placeholder="Name of the volume" aria-label="Name of the volume" data-testid="vr-name">
                      <select class="form-select form-select-sm" style="width: 11rem" [(ngModel)]="r.field" (ngModelChange)="rulesChanged()" aria-label="Field" data-testid="vr-field">
                        @for (f of splitOptions; track f.key) { <option [value]="f.key">{{f.label}}</option> }
                      </select>
                      <select class="form-select form-select-sm" style="width: 9rem" [(ngModel)]="r.op" (ngModelChange)="rulesChanged()" aria-label="Condition" data-testid="vr-op">
                        @for (o of ruleOps; track o.op) { <option [value]="o.op">{{o.label}}</option> }
                      </select>
                      @if (r.op === 'in') {
                        <div style="flex: 1; min-width: 14rem">
                          <input type="text" class="form-control form-control-sm" [(ngModel)]="r.valuesText" (ngModelChange)="rulesChanged()" placeholder="Kyrie, Gloria, Sanctus, Agnus" aria-label="Values" data-testid="vr-values">
                          @if (r.hint) { <div class="form-text mt-0">In this selection: {{r.hint}}</div> }
                        </div>
                      }
                      @if (r.op !== 'empty') {
                        <div class="form-check mt-1">
                          <input class="form-check-input" type="checkbox" [id]="'vr-each-' + i" [(ngModel)]="r.each" (ngModelChange)="rulesChanged()" data-testid="vr-each">
                          <label class="form-check-label" [for]="'vr-each-' + i">one volume per value</label>
                        </div>
                      }
                      <div class="btn-group btn-group-sm ms-auto">
                        <button type="button" class="btn btn-outline-secondary" title="Earlier" aria-label="Move up" [disabled]="i === 0" (click)="moveRule(i, -1)"><i class="bi bi-arrow-up"></i></button>
                        <button type="button" class="btn btn-outline-secondary" title="Later" aria-label="Move down" [disabled]="i === ruleRows.length - 1" (click)="moveRule(i, 1)"><i class="bi bi-arrow-down"></i></button>
                        <button type="button" class="btn btn-outline-secondary" title="Remove" aria-label="Remove rule" (click)="removeRule(i)"><i class="bi bi-x-lg"></i></button>
                      </div>
                    </div>
                  }
                  <div class="d-flex flex-wrap align-items-center gap-2">
                    <button type="button" class="btn btn-sm btn-outline-primary" (click)="addRule()" data-testid="vr-add"><i class="bi bi-plus-lg me-1"></i>Add a rule</button>
                    <button type="button" class="btn btn-sm btn-outline-secondary" [disabled]="!rulesDirty || rulesSaving" (click)="saveRules()" data-testid="vr-save">Keep the rules for this project</button>
                    @if (!rulesDirty && ruleRows.length) { <span class="small text-success"><i class="bi bi-check-lg"></i> kept</span> }
                    @if (rulesError) { <span class="small text-danger">{{rulesError}}</span> }
                  </div>
                </div>
              }
              @if (splitBy) {
                <div class="col-md-7">
                  <div class="d-flex align-items-center justify-content-between mb-1">
                    <div class="small text-muted">{{groups.length}} volume{{groups.length === 1 ? '' : 's'}} · {{selectedGroupCount}} selected</div>
                    <div class="btn-group btn-group-sm">
                      <button type="button" class="btn btn-outline-secondary" (click)="selectGroups(true)" [disabled]="busy">All</button>
                      <button type="button" class="btn btn-outline-secondary" (click)="selectGroups(false)" [disabled]="busy">None</button>
                    </div>
                  </div>
                  <ul class="list-group" style="max-height: 360px; overflow: auto;">
                    @for (g of groups; track g.key) {
                      <li class="list-group-item py-1 d-flex align-items-center gap-2">
                        <input class="form-check-input mt-0" type="checkbox" [id]="'grp-' + g.key" [(ngModel)]="g.on" [disabled]="busy" (ngModelChange)="previewSoon()">
                        <label class="flex-grow-1 mb-0 small" [for]="'grp-' + g.key">{{g.label}}</label>
                        <span class="badge bg-secondary-subtle text-secondary">{{g.count}}</span>
                      </li>
                    }
                  </ul>
                  @if (groups.length > 40) { <div class="alert alert-warning small mt-2 mb-0 py-2">{{groups.length}} volumes can take a long time. Select the ones you need.</div> }
                </div>
              }
            </div>
          </div>
          }

          <!-- ── Cover page ─────────────────────────────────────────────── -->
          @if (tab === 'cover') {
          <div class="row g-0">
            <div class="col-lg-7 p-3 border-end" style="min-width: 0;">
              <div class="d-flex flex-wrap align-items-center gap-2 mb-2">
                <div class="form-check form-switch mb-0 me-2">
                  <input class="form-check-input" type="checkbox" id="oCover2" [(ngModel)]="o.cover" (ngModelChange)="save()">
                  <label class="form-check-label fw-medium" for="oCover2">Print a cover page</label>
                </div>
                <select class="form-select form-select-sm w-auto pe-4" style="min-width: 12rem;" [(ngModel)]="presetId" aria-label="Preset">
                  @for (p of presets; track p.id) { <option [value]="p.id">{{p.label}}</option> }
                </select>
                <button type="button" class="btn btn-sm btn-outline-secondary" (click)="loadPreset()" title="Replace the blocks by the preset (own variables stay)">Load preset</button>
                <button type="button" class="btn btn-sm btn-outline-secondary ms-auto" (click)="toggleJson()"><i class="bi bi-braces me-1"></i>JSON</button>
              </div>
              <div class="form-text mt-0 mb-2">
                Write <code>$name$</code> where something from the data belongs — for example <code>$gattung1$en aus $quelle$</code> becomes “Antiphonen aus Aachen, Domarchiv, Hs. G 13”.
                A block with an empty placeholder can be left out. Your template is kept in this browser; use JSON to move it to another project.
              </div>

              @if (jsonOpen) {
                <div class="mb-3">
                  <textarea class="form-control form-control-sm font-monospace" rows="8" [(ngModel)]="jsonText" aria-label="Template as JSON"></textarea>
                  <div class="d-flex gap-2 mt-1 align-items-center">
                    <button type="button" class="btn btn-sm btn-primary" (click)="applyJson()">Apply</button>
                    <button type="button" class="btn btn-sm btn-outline-secondary" (click)="toggleJson(true)">Reset text</button>
                    @if (jsonError) { <span class="text-danger small">{{jsonError}}</span> }
                  </div>
                </div>
              }

              <div class="small fw-semibold text-uppercase text-muted mb-1" style="letter-spacing: .06em;">Placeholders <span class="fw-normal text-lowercase">(click to insert)</span></div>
              <div class="d-flex flex-wrap gap-1 mb-3" style="max-height: 96px; overflow: auto;">
                @for (f of catalog; track f.key) {
                  <button type="button" class="btn btn-sm btn-outline-secondary py-0 px-2" style="font-size: .75rem;" [title]="f.label"
                          (mousedown)="$event.preventDefault()" (click)="insertPlaceholder(f.key)">$ {{f.key}} $</button>
                }
              </div>

              <div class="row g-2 mb-3">
                <div class="col-3"><label class="form-label small text-muted mb-0" for="cvTop">Top (% of page)</label>
                  <input id="cvTop" type="number" class="form-control form-control-sm" [(ngModel)]="template.top" (ngModelChange)="changed()" min="0" max="70" step="0.5"></div>
                <div class="col-3"><label class="form-label small text-muted mb-0" for="cvSide">Side margin (pt)</label>
                  <input id="cvSide" type="number" class="form-control form-control-sm" [(ngModel)]="template.side" (ngModelChange)="changed()" min="0" max="200"></div>
                <div class="col-3"><label class="form-label small text-muted mb-0" for="cvBottom">Bottom (pt)</label>
                  <input id="cvBottom" type="number" class="form-control form-control-sm" [(ngModel)]="template.bottom" (ngModelChange)="changed()" min="0" max="200"></div>
                <div class="col-3"><label class="form-label small text-muted mb-0" for="cvLh">Line height</label>
                  <input id="cvLh" type="number" class="form-control form-control-sm" [(ngModel)]="template.lineHeight" (ngModelChange)="changed()" min="1" max="2.5" step="0.05"></div>
              </div>

              <div class="small fw-semibold text-uppercase text-muted mb-1" style="letter-spacing: .06em;">Own variables</div>
              <div class="form-text mt-0 mb-1">For texts that are not in the data, e.g. <code>herausgeber</code> for <code>$herausgeber$</code>. A field of the manuscripts or documents with the same name is used first.</div>
              @for (v of template.variables; track $index) {
                <div class="input-group input-group-sm mb-1">
                  <span class="input-group-text">$</span>
                  <input class="form-control" style="max-width: 11rem;" [(ngModel)]="v.key" (ngModelChange)="changed()" placeholder="name" aria-label="Variable name">
                  <span class="input-group-text">$</span>
                  <input class="form-control" [(ngModel)]="v.value" (ngModelChange)="changed()" placeholder="value" aria-label="Variable value">
                  <button type="button" class="btn btn-outline-danger" (click)="removeVariable($index)" title="Remove"><i class="bi bi-x-lg"></i></button>
                </div>
              }
              <button type="button" class="btn btn-sm btn-link px-0 mb-3" (click)="addVariable()"><i class="bi bi-plus-lg me-1"></i>Add variable</button>

              <div class="small fw-semibold text-uppercase text-muted mb-1" style="letter-spacing: .06em;">Blocks</div>
              @for (b of template.blocks; track b.id; let i = $index) {
                <div class="border rounded p-2 mb-2 bg-body-tertiary">
                  <div class="d-flex align-items-start gap-2">
                    @if (b.kind === 'text') {
                      <textarea class="form-control form-control-sm" rows="2" [(ngModel)]="b.text" (ngModelChange)="changed()" (focus)="focusBlock(b, $event)" [attr.aria-label]="'Text of block ' + (i + 1)" placeholder="Text with $placeholders$"></textarea>
                    } @else {
                      <div class="flex-grow-1 small text-muted align-self-center">Rule</div>
                    }
                    <div class="btn-group-vertical btn-group-sm flex-shrink-0">
                      <button type="button" class="btn btn-outline-secondary py-0" (click)="moveBlock(i, -1)" [disabled]="i === 0" title="Move up"><i class="bi bi-chevron-up"></i></button>
                      <button type="button" class="btn btn-outline-secondary py-0" (click)="moveBlock(i, 1)" [disabled]="i === template.blocks.length - 1" title="Move down"><i class="bi bi-chevron-down"></i></button>
                    </div>
                    <div class="btn-group-vertical btn-group-sm flex-shrink-0">
                      <button type="button" class="btn btn-outline-secondary py-0" (click)="duplicateBlock(i)" title="Duplicate"><i class="bi bi-copy"></i></button>
                      <button type="button" class="btn btn-outline-danger py-0" (click)="removeBlock(i)" title="Delete"><i class="bi bi-trash"></i></button>
                    </div>
                  </div>
                  <div class="d-flex flex-wrap gap-2 mt-2 align-items-end text-muted" style="font-size: .72rem;">
                    <label class="d-flex flex-column">{{ b.kind === 'rule' ? 'Thickness' : 'Size' }}
                      <input type="number" class="form-control form-control-sm" style="width: 4.5rem;" [(ngModel)]="b.size" (ngModelChange)="changed()" [min]="b.kind === 'rule' ? 0.1 : 4" [max]="b.kind === 'rule' ? 6 : 72" [step]="b.kind === 'rule' ? 0.1 : 0.5"></label>
                    <label class="d-flex flex-column">Colour
                      <input type="color" class="form-control form-control-sm form-control-color p-1" style="width: 2.6rem; height: 31px;" [(ngModel)]="b.color" (ngModelChange)="changed()"></label>
                    @if (b.kind === 'text') {
                      <label class="d-flex flex-column">Style
                        <select class="form-select form-select-sm w-auto" [(ngModel)]="b.style" (ngModelChange)="changed()">
                          <option value="normal">Regular</option><option value="bold">Bold</option><option value="italic">Italic</option>
                        </select></label>
                    }
                    <label class="d-flex flex-column">Align
                      <select class="form-select form-select-sm w-auto" [(ngModel)]="b.align" (ngModelChange)="changed()">
                        <option value="left">Left</option><option value="center">Centre</option><option value="right">Right</option>
                      </select></label>
                    <label class="d-flex flex-column">Space above
                      <input type="number" class="form-control form-control-sm" style="width: 4.5rem;" [(ngModel)]="b.before" (ngModelChange)="changed()" min="0" max="400"></label>
                    <label class="d-flex flex-column">Width %
                      <input type="number" class="form-control form-control-sm" style="width: 4.5rem;" [(ngModel)]="b.width" (ngModelChange)="changed()" min="10" max="100"></label>
                    <label class="d-flex flex-column">Position
                      <select class="form-select form-select-sm w-auto" [(ngModel)]="b.anchor" (ngModelChange)="changed()">
                        <option value="flow">Below previous</option><option value="bottom">Page bottom</option>
                      </select></label>
                    @if (b.kind === 'text') {
                      <div class="form-check mb-1">
                        <input class="form-check-input" type="checkbox" [id]="'hide-' + b.id" [(ngModel)]="b.hideIfEmpty" (ngModelChange)="changed()">
                        <label class="form-check-label" [for]="'hide-' + b.id" title="Leave the block out when a placeholder in it has no value" style="font-size: .8rem;">Hide if a placeholder is empty</label>
                      </div>
                    }
                  </div>
                </div>
              }
              <div class="d-flex gap-2">
                <button type="button" class="btn btn-sm btn-outline-primary" (click)="addBlock('text')" [disabled]="template.blocks.length >= maxBlocks"><i class="bi bi-plus-lg me-1"></i>Text block</button>
                <button type="button" class="btn btn-sm btn-outline-primary" (click)="addBlock('rule')" [disabled]="template.blocks.length >= maxBlocks"><i class="bi bi-dash-lg me-1"></i>Rule</button>
              </div>
            </div>

            <div class="col-lg-5 p-3 bg-body-tertiary" style="min-width: 0;">
              <div class="d-flex align-items-center justify-content-between mb-2">
                <div class="small fw-semibold text-uppercase text-muted" style="letter-spacing: .06em;">Preview</div>
                <div class="small text-muted text-truncate ms-2">{{ previewLabel }}</div>
              </div>
              @if (previewUrl) {
                <iframe class="w-100 border bg-white" style="height: 560px;" [src]="previewUrl" title="Cover preview"></iframe>
              } @else {
                <div class="border bg-white d-flex align-items-center justify-content-center text-muted small" style="height: 560px;">{{ previewError || 'Preparing the preview …' }}</div>
              }
              @if (previewOverflow) { <div class="alert alert-warning small mt-2 mb-0 py-1">The blocks do not fit on the page — reduce sizes or spaces.</div> }
              @if (previewUnknown.length) { <div class="alert alert-warning small mt-2 mb-0 py-1">Unknown placeholder: {{previewUnknown.join(', ')}} — it prints nothing.</div> }
              @if (previewError && previewUrl) { <div class="alert alert-danger small mt-2 mb-0 py-1">{{previewError}}</div> }
            </div>
          </div>
          }

          @if (busy || error || warnings.length) {
            <div class="px-3 pb-3 pt-2">
              @if (busy) {
                <div class="progress" style="height: 6px;"><div class="progress-bar" [style.width.%]="progress"></div></div>
                <div class="small text-muted mt-1">{{status}}</div>
              }
              @if (error) { <div class="alert alert-danger small mb-0 mt-2">{{error}}</div> }
              @if (warnings.length) {
                <div class="alert alert-warning small mb-0 mt-2" id="pdfWarnings">
                  <strong>The PDF was created, but:</strong>
                  <ul class="mb-0 ps-3">@for (w of warnings; track w) { <li>{{w}}</li> }</ul>
                </div>
              }
            </div>
          }
        </div>

        <div class="modal-footer border-0 bg-light">
          <button type="button" class="btn btn-outline-secondary px-3" (click)="close()" [disabled]="busy">Cancel</button>
          <button type="button" class="btn btn-danger px-4" (click)="run()" [disabled]="busy || !entries.length || loadingMeta || (splitBy && !selectedGroupCount)">
            @if (busy) { <span class="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true"></span> }
            @else { <i class="bi bi-printer me-1"></i> }
            {{ splitBy && selectedGroupCount > 1 ? 'Create ' + selectedGroupCount + ' PDFs (ZIP)' : 'Create PDF' }}
          </button>
        </div>
      </div>
    </div>
  </div>`,
})
export class PdfExportDialogComponent implements OnInit, OnDestroy {
  /** Exactly one of these is used: ready jobs (document view), documents, or ids to load. */
  @Input() jobs: PdfDocJob[] = [];
  @Input() docs: Document[] = [];
  @Input() ids: string[] = [];
  @Input() title = '';
  @Input() fileName = '';
  @Output() closed = new EventEmitter<void>();

  entries: Entry[] = [];
  /** Documents left out of the print because they must not be printed (see `holdReasons`). Not remembered between prints: it starts on. */
  held: Entry[] = [];
  /** Every document of the workspace, to see which units and related documents the print breaks apart. */
  private allDocs: Document[] = [];
  /** What the print does to units and relations: gaps from held-back or missing documents. */
  printWarnings: string[] = [];
  holdBack = true;
  /** Held back plus, while the switch is off, those in the list that would be held back: kept as fields, not recounted on every change detection. */
  heldTotal = 0;
  /** In the print list although marked "don't publish" (only possible with the switch off). */
  flaggedIn = 0;
  o: DialogOptions = { titlePage: true, contents: true, metadata: true, apparatus: true, sourceDescription: false, notationDocumentation: false, neumeTree: false, newPage: false, arrangeRelated: true, relatedBehind: false, pageFormat: 'settings', boxLabel: 'number', cover: false, countFront: false };
  fileBase = '';
  busy = false;
  loadingMeta = false;
  progress = 0;
  status = '';
  error = '';
  /** What the finished PDF lacks (strips without image …): the dialog stays open to say so. */
  warnings: string[] = [];

  tab: 'print' | 'cover' | 'volumes' = 'print';
  settings: ProjectSettings | null = null;
  /** Manuscripts of the documents (sigle, library …): what the placeholders and the split need. */
  private sources = new Map<string, { source: Source | null; sigle: string }>();

  // ── cover template ──
  template: TitleTemplate = sanitizeTitleTemplate(null);
  readonly presets = TITLE_PRESETS;
  readonly maxBlocks = MAX_BLOCKS;
  presetId = TITLE_PRESETS[0].id;
  catalog: FieldDef[] = [];
  jsonOpen = false;
  jsonText = '';
  jsonError = '';
  private focused: { block: TitleBlock; el: HTMLTextAreaElement } | null = null;
  previewUrl: SafeResourceUrl | null = null;
  previewLabel = '';
  private previewParts: string[] = [];
  previewOverflow = false;
  previewUnknown: string[] = [];
  previewError = '';
  private previewRaw: string | null = null;
  private previewTimer: any = null;
  private previewSeq = 0;

  // ── volumes ──
  splitBy = '';
  splitThen = '';
  readonly rulesSplit = RULES_SPLIT;
  readonly ruleOps = RULE_OPS;
  ruleRows: RuleRow[] = [];
  rulesDirty = false;
  rulesSaving = false;
  rulesError = '';
  splitOptions: FieldDef[] = [];
  groups: GroupRow[] = [];

  constructor(private api: APIService, private users: UserService, private pdf: PdfExportService, private sanitizer: DomSanitizer) {}

  get multi(): boolean { return this.entries.length + this.held.length > 1; }
  get selectedGroupCount(): number { return this.groups.filter((g) => g.on).length; }

  genre(d: Document): string { return genreOf(d); }

  async ngOnInit(): Promise<void> {
    if (this.jobs.length) this.entries = this.jobs.map((j) => ({ id: j.document.id, doc: j.document, job: j }));
    else if (this.docs.length) this.entries = this.docs.map((d) => ({ id: d.id, doc: d, job: null }));
    else this.entries = this.ids.map((id) => ({ id, doc: null, job: null }));
    this.loadOptions();
    this.loadTemplate();
    this.fileBase = this.fileName || (this.entries.length === 1 && this.entries[0].doc ? `Document_${this.entries[0].doc.dokumenten_id || 'Export'}` : 'Documents');

    // metadata of entries given as ids
    const missing = this.entries.filter((e) => !e.doc);
    if (missing.length) {
      this.loadingMeta = true;
      try {
        const token = (await firstValueFrom(this.users.user))?.token || '';
        for (const e of missing) {
          const r: any = await firstValueFrom(this.api.getDocument(token, e.id));
          e.doc = r.kind === 'DocumentRetrieved' ? r.document : null;
        }
        this.entries = this.entries.filter((e) => e.doc);
      } finally {
        this.loadingMeta = false;
      }
      if (!this.fileName) this.fileBase = this.entries.length === 1 && this.entries[0].doc ? `Document_${this.entries[0].doc.dokumenten_id || 'Export'}` : 'Documents';
    }
    this.applyHold();
    await this.loadSources();
  }

  // ── documents that must not be printed ──
  reasonText(e: Entry): string { return holdReasons(e.doc).map((r) => HOLD_REASON_LABEL[r]).join(', '); }
  holdChanged(): void {
    this.applyHold();
    this.recomputeGroups();
    this.previewSoon();
  }
  /** With the switch on, the documents that must not be printed move from the list to `held`; with it off they come back (at the end). */
  private applyHold(): void {
    if (this.holdBack) {
      const keep: Entry[] = [], out: Entry[] = [];
      for (const e of this.entries) (e.doc && !isPrintable(e.doc) ? out : keep).push(e);
      this.entries = keep;
      this.held = [...this.held, ...out];
    } else if (this.held.length) {
      this.entries = [...this.entries, ...this.held];
      this.held = [];
    }
    this.refreshHold();
  }
  private refreshHold(): void {
    const loose = this.entries.filter((e) => e.doc && !isPrintable(e.doc));
    this.heldTotal = this.held.length + loose.length;
    this.flaggedIn = loose.filter((e) => holdReasons(e.doc).includes('dontpublish')).length;
    this.printWarnings = checkPrintSet(this.allDocs, new Set(this.entries.map((e) => e.id)), new Set(this.held.map((e) => e.id)));
  }

  ngOnDestroy(): void {
    clearTimeout(this.previewTimer);
    this.dropPreview();
  }

  /** The manuscripts of all documents, once: the cover placeholders and the split by a manuscript field read them. */
  private async loadSources(): Promise<void> {
    try {
      const token = (await firstValueFrom(this.users.user))?.token || '';
      const sr: any = await firstValueFrom(this.api.getSettings(token));
      this.settings = sr.kind === 'SettingsRetrieved' ? sr.settings : null;
      const all: any = await firstValueFrom(this.api.listDocuments(token));
      this.allDocs = all.kind === 'DocumentsRetrieved' ? all.documents : [];
      this.refreshHold();
      for (const e of this.entries) {
        if (e.job) this.sources.set(e.doc!.quelle_id, { source: e.job.source, sigle: e.job.sigle });
      }
      for (const e of this.entries) {
        const qid = e.doc?.quelle_id;
        if (!qid || this.sources.has(qid)) continue;
        const s: any = await firstValueFrom(this.api.getSource(token, qid));
        const g: any = await firstValueFrom(this.api.getSigle(token, qid));
        this.sources.set(qid, { source: s.kind === 'SourceRetrieved' ? s.source : null, sigle: g.kind === 'SigleRetrieved' ? g.sigle : '' });
      }
    } catch (e) {
      console.warn('Sources for the print dialog could not be read', e);
    }
    this.splitOptions = splitFields(this.settings);
    this.ruleRows = (this.settings?.volumeRules ?? []).map((r) => ({ name: r.name, field: r.field, op: r.op, valuesText: (r.values ?? []).join(', '), each: !!r.each, hint: '' }));
    this.refreshCatalog();
    this.recomputeGroups();
    this.previewSoon();
  }

  private fieldJob(e: Entry): FieldJob {
    const s = this.sources.get(e.doc!.quelle_id);
    return { document: e.doc!, source: s?.source ?? e.job?.source ?? null, sigle: s?.sigle ?? e.job?.sigle ?? '' };
  }

  // ── list handling ──
  move(i: number, d: number): void {
    const j = i + d;
    if (j < 0 || j >= this.entries.length) return;
    const copy = [...this.entries];
    [copy[i], copy[j]] = [copy[j], copy[i]];
    this.entries = copy;
  }
  remove(i: number): void { this.entries = this.entries.filter((_, k) => k !== i); this.refreshHold(); this.recomputeGroups(); this.previewSoon(); }
  sortBy(kind: 'id' | 'incipit' | 'genre'): void {
    const key = (e: Entry) => kind === 'id' ? (e.doc?.dokumenten_id || '') : kind === 'incipit' ? (e.doc?.textinitium || '') : genreOf(e.doc);
    this.entries = [...this.entries].sort((a, b) => compareNatural(key(a), key(b)));
  }

  // ── volumes ──
  splitChanged(): void {
    if (!this.splitBy || this.splitBy === RULES_SPLIT) this.splitThen = '';
    if (this.splitThen === this.splitBy) this.splitThen = '';
    if (this.splitBy === RULES_SPLIT && !this.ruleRows.length) this.ruleRows = [{ name: '', field: 'genre', op: 'in', valuesText: '', each: false, hint: '' }];
    this.groups = [];
    this.recomputeGroups();
    this.previewSoon();
  }
  selectGroups(on: boolean): void { for (const g of this.groups) g.on = on; this.previewSoon(); }
  /** The groups of the documents now in the list; groups that were switched off stay off. */
  private recomputeGroups(): void {
    if (!this.splitBy) { this.groups = []; return; }
    if (this.splitBy === RULES_SPLIT) this.refreshRuleHints();
    const was = new Map(this.groups.map((g) => [g.key, g.on]));
    this.groups = this.groupsOf(this.entries.filter((e) => e.doc))
      .map((g) => ({ key: g.key, label: g.label || '(not set)', count: g.items.length, on: was.get(g.key) ?? true }));
  }
  /** The fields of the split as one: "genre+herkunftsregion" when a second field is chosen. */
  private get splitSpec(): string { return splitSpec(this.splitBy, this.splitThen); }
  private splitLabel(): string { return !this.splitBy ? '' : this.splitBy === RULES_SPLIT ? 'Volume rules' : splitSpecLabel(this.splitSpec, this.splitOptions); }
  /** The value of each field for a volume made of `entries`, for the cover's `$gruppe1$`, `$gruppe2$`; with rules the volume's name stands for both. */
  private partsOf(entries: Entry[]): string[] { return entries.length && this.splitBy !== RULES_SPLIT ? splitKey(this.fieldJob(entries[0]), this.splitSpec).parts : []; }
  /** The volumes of `entries`: by the rules, or by the value of the chosen field. */
  private groupsOf(entries: Entry[]) {
    return this.splitBy === RULES_SPLIT
      ? groupByRules(entries, (e) => this.fieldJob(e), this.currentRules())
      : groupItems(entries, (e) => splitKey(this.fieldJob(e), this.splitSpec));
  }

  // ── volume rules ──
  private currentRules(): VolumeRule[] {
    return usableRules(this.ruleRows.map((r) => ({ name: r.name, field: r.field, op: r.op, values: parseRuleValues(r.valuesText), each: r.each })));
  }
  addRule(): void {
    const last = this.ruleRows[this.ruleRows.length - 1];
    this.ruleRows = [...this.ruleRows, { name: '', field: last?.field || 'genre', op: 'in', valuesText: '', each: false, hint: '' }];
    this.rulesChanged();
  }
  removeRule(i: number): void { this.ruleRows = this.ruleRows.filter((_, k) => k !== i); this.rulesChanged(); }
  moveRule(i: number, d: number): void {
    const j = i + d;
    if (j < 0 || j >= this.ruleRows.length) return;
    const copy = [...this.ruleRows];
    [copy[i], copy[j]] = [copy[j], copy[i]];
    this.ruleRows = copy;
    this.rulesChanged();
  }
  rulesChanged(): void { this.rulesDirty = true; this.rulesError = ''; this.recomputeGroups(); this.previewSoon(); }
  /** The values the documents of the list have in the field of a rule, with how many: what to type into "is one of". */
  private refreshRuleHints(): void {
    const docs = this.entries.filter((e) => e.doc);
    const cache = new Map<string, string>();
    for (const r of this.ruleRows) {
      if (r.op !== 'in') { r.hint = ''; continue; }
      if (!cache.has(r.field)) {
        const counts = new Map<string, number>();
        for (const e of docs) {
          const j = this.fieldJob(e);
          const vals = r.field === 'genre' ? [fieldValue(j, 'gattung1'), fieldValue(j, 'gattung2')] : [fieldValue(j, r.field === 'quelle-id' ? 'quellensigle' : r.field)];
          for (const v of vals) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
        }
        const all = [...counts].sort((a, b) => compareNatural(a[0], b[0])).map(([v, n]) => `${v} (${n})`);
        cache.set(r.field, all.length > 14 ? all.slice(0, 14).join(', ') + ', …' : all.join(', '));
      }
      r.hint = cache.get(r.field)!;
    }
  }
  async saveRules(): Promise<void> {
    if (this.rulesSaving) return;
    this.rulesSaving = true;
    this.rulesError = '';
    try {
      const token = (await firstValueFrom(this.users.user))?.token || '';
      const res: any = await firstValueFrom(this.api.getSettings(token));
      if (res.kind !== 'SettingsRetrieved') throw new Error('The settings could not be read.');
      const volumeRules = this.currentRules();
      await firstValueFrom(this.api.updateSettings(token, { ...res.settings, volumeRules }));
      this.settings = { ...res.settings, volumeRules };
      this.rulesDirty = false;
    } catch (e: any) {
      console.error('Saving the volume rules failed', e);
      this.rulesError = 'Not saved: ' + (e?.message || e);
    } finally {
      this.rulesSaving = false;
    }
  }

  // ── cover template ──
  openCover(): void {
    this.tab = 'cover';
    this.previewSoon();
  }
  /** The template as the export reads it: every value valid, whatever is half typed. */
  private cleanTemplate(): TitleTemplate { return sanitizeTitleTemplate(this.template); }
  private loadTemplate(): void {
    const stored = safeStorage.getJson<unknown>(COVER_KEY, null);
    if (stored) this.template = sanitizeTitleTemplate(stored);
    this.presetId = TITLE_PRESETS[0].id;
  }
  private refreshCatalog(): void { this.catalog = placeholderCatalog(this.settings, this.template.variables); }
  /** Something in the template changed: keep it and redraw the preview. */
  changed(): void {
    safeStorage.setJson(COVER_KEY, this.cleanTemplate());
    this.refreshCatalog();
    this.previewSoon();
  }
  loadPreset(): void {
    const p = TITLE_PRESETS.find((x) => x.id === this.presetId);
    if (!p) return;
    const keep = this.template.variables.filter((v) => !p.template.variables.some((q) => q.key.toLowerCase() === v.key.toLowerCase()));
    this.template = sanitizeTitleTemplate({ ...JSON.parse(JSON.stringify(p.template)), variables: [...p.template.variables, ...keep] });
    this.focused = null;
    this.changed();
  }
  private nextBlockId(): string {
    let n = this.template.blocks.length + 1;
    while (this.template.blocks.some((b) => b.id === 'b' + n)) n++;
    return 'b' + n;
  }
  addBlock(kind: 'text' | 'rule'): void {
    if (this.template.blocks.length >= MAX_BLOCKS) return;
    this.template.blocks = [...this.template.blocks, newBlock(kind, this.nextBlockId())];
    this.changed();
  }
  duplicateBlock(i: number): void {
    if (this.template.blocks.length >= MAX_BLOCKS) return;
    const copy = { ...this.template.blocks[i], id: this.nextBlockId() };
    this.template.blocks = [...this.template.blocks.slice(0, i + 1), copy, ...this.template.blocks.slice(i + 1)];
    this.changed();
  }
  removeBlock(i: number): void {
    this.template.blocks = this.template.blocks.filter((_, k) => k !== i);
    this.changed();
  }
  moveBlock(i: number, d: number): void {
    const j = i + d;
    if (j < 0 || j >= this.template.blocks.length) return;
    const copy = [...this.template.blocks];
    [copy[i], copy[j]] = [copy[j], copy[i]];
    this.template.blocks = copy;
    this.changed();
  }
  addVariable(): void { this.template.variables = [...this.template.variables, { key: '', value: '' }]; }
  removeVariable(i: number): void { this.template.variables = this.template.variables.filter((_, k) => k !== i); this.changed(); }
  focusBlock(block: TitleBlock, ev: Event): void { this.focused = { block, el: ev.target as HTMLTextAreaElement }; }
  /** Puts `$name$` into the text block that was edited last, at the cursor. */
  insertPlaceholder(key: string): void {
    const f = this.focused && this.template.blocks.includes(this.focused.block) ? this.focused : null;
    const block = f?.block ?? [...this.template.blocks].reverse().find((b) => b.kind === 'text');
    if (!block) return;
    const tag = `$${key}$`;
    if (f) {
      const { selectionStart: a, selectionEnd: z } = f.el;
      block.text = block.text.slice(0, a) + tag + block.text.slice(z);
      const pos = a + tag.length;
      setTimeout(() => { try { f.el.focus(); f.el.setSelectionRange(pos, pos); } catch { /* element is gone */ } });
    } else {
      block.text = (block.text ? block.text + ' ' : '') + tag;
    }
    this.changed();
  }
  toggleJson(reset = false): void {
    this.jsonOpen = reset ? true : !this.jsonOpen;
    if (this.jsonOpen) this.jsonText = JSON.stringify(this.cleanTemplate(), null, 2);
    this.jsonError = '';
  }
  applyJson(): void {
    try {
      const parsed = JSON.parse(this.jsonText);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('A template is an object with "blocks".');
      this.template = sanitizeTitleTemplate(parsed);
      this.jsonError = '';
      this.changed();
    } catch (e: any) {
      this.jsonError = 'Not a valid template: ' + (e?.message || e);
    }
  }

  // ── preview: the real cover, drawn by the export itself ──
  private previewJobs(): FieldJob[] {
    const all = this.entries.filter((e) => e.doc);
    if (!this.splitBy) return all.map((e) => this.fieldJob(e));
    const on = new Set(this.groups.filter((g) => g.on).map((g) => g.key));
    const volumes = this.groupsOf(all);
    const first = volumes.find((g) => on.has(g.key)) ?? volumes[0];
    this.previewLabel = first ? `Volume: ${first.label || '(not set)'}` : '';
    this.previewParts = this.partsOf(first?.items ?? []);
    return (first?.items ?? []).map((e) => this.fieldJob(e));
  }
  private previewGroup(): string {
    if (!this.splitBy) return '';
    return this.previewLabel.replace(/^Volume: /, '');
  }
  /** Redraws the preview shortly after the last change (only while the cover tab is open). */
  previewSoon(): void {
    clearTimeout(this.previewTimer);
    if (this.tab !== 'cover') return;
    this.previewTimer = setTimeout(() => this.renderPreview(), 350);
  }
  private dropPreview(): void {
    if (this.previewRaw) URL.revokeObjectURL(this.previewRaw);
    this.previewRaw = null;
  }
  private async renderPreview(): Promise<void> {
    const seq = ++this.previewSeq;
    this.previewLabel = this.splitBy ? this.previewLabel : `${this.entries.length} document${this.entries.length === 1 ? '' : 's'}`;
    try {
      const jobs = this.previewJobs();
      if (!jobs.length) { this.previewError = 'Select a volume to see its cover.'; this.previewUrl = null; return; }
      const r = await this.pdf.renderCover(jobs, {
        settings: this.settings,
        pageFormat: this.o.pageFormat === 'settings' ? undefined : this.o.pageFormat,
        title: this.title.trim(),
        cover: { template: this.cleanTemplate(), group: this.previewGroup(), groupField: this.splitLabel(), groupParts: this.splitBy ? this.previewParts : undefined },
      });
      if (seq !== this.previewSeq) return;                 // a newer preview is on its way
      this.dropPreview();
      this.previewRaw = URL.createObjectURL(r.blob);
      this.previewUrl = this.sanitizer.bypassSecurityTrustResourceUrl(this.previewRaw + '#toolbar=0&navpanes=0&view=Fit');
      this.previewOverflow = r.overflow;
      this.previewUnknown = r.unknown;
      this.previewError = '';
    } catch (e: any) {
      if (seq !== this.previewSeq) return;
      console.error('Cover preview failed', e);
      this.previewError = 'The preview could not be drawn: ' + (e?.message || e);
    }
  }

  // ── remembered choices (kept apart for one and for several documents) ──
  private loadOptions(): void {
    const multi = this.entries.length > 1;
    this.o = multi
      ? { titlePage: true, contents: true, metadata: true, apparatus: true, sourceDescription: false, notationDocumentation: false, neumeTree: false, newPage: false, arrangeRelated: true, relatedBehind: false, pageFormat: 'settings', boxLabel: 'number', cover: false, countFront: false }
      : { titlePage: false, contents: false, metadata: true, apparatus: true, sourceDescription: false, notationDocumentation: false, neumeTree: false, newPage: false, arrangeRelated: true, relatedBehind: false, pageFormat: 'settings', boxLabel: 'number', cover: false, countFront: false };
    const stored = safeStorage.getJson<Partial<DialogOptions> | null>(OPTIONS_KEY(multi), null);
    if (stored && typeof stored === 'object') this.o = { ...this.o, ...stored };
    if (this.o.boxLabel !== 'none') this.o.boxLabel = 'number';   // older versions stored other labels
  }
  save(): void {
    safeStorage.setJson(OPTIONS_KEY(this.multi), this.o);
  }

  close(): void { this.closed.emit(); }

  async run(): Promise<void> {
    this.busy = true;
    this.error = '';
    this.warnings = [];
    this.save();
    try {
      const token = (await firstValueFrom(this.users.user))?.token || '';
      const settingsRes: any = await firstValueFrom(this.api.getSettings(token));
      const settings: ProjectSettings | null = settingsRes.kind === 'SettingsRetrieved' ? settingsRes.settings : null;

      // what to print: everything as one PDF, or one PDF per selected volume
      const live = this.entries.filter((e) => e.doc);
      let plan: { label: string; entries: Entry[] }[] = [{ label: '', entries: live }];
      if (this.splitBy) {
        const on = new Set(this.groups.filter((g) => g.on).map((g) => g.key));
        plan = this.groupsOf(live).filter((g) => on.has(g.key)).map((g) => ({ label: g.label, entries: g.items }));
        if (!plan.length) throw new Error('No volume is selected.');
      }
      const todo = plan.flatMap((p) => p.entries);

      const jobOf = new Map<Entry, PdfDocJob>();
      for (let i = 0; i < todo.length; i++) {
        const e = todo[i];
        if (e.job) { jobOf.set(e, e.job); continue; }
        const d = e.doc!;
        this.status = `Loading ${d.dokumenten_id || d.textinitium || ''} (${i + 1}/${todo.length})`;
        this.progress = (i / todo.length) * 40;
        if (!this.sources.has(d.quelle_id)) {
          const sr: any = await firstValueFrom(this.api.getSource(token, d.quelle_id));
          const gr: any = await firstValueFrom(this.api.getSigle(token, d.quelle_id));
          this.sources.set(d.quelle_id, { source: sr.kind === 'SourceRetrieved' ? sr.source : null, sigle: gr.kind === 'SigleRetrieved' ? gr.sigle : '' });
        }
        const notes: any = await firstValueFrom(this.api.getDocumentNotes(token, d.id));
        const cont = notes.kind === 'NotesRetrieved' ? VM.normalizeDocumentComments(notes.data) : VM.emptyRootContainer();
        const s = this.sources.get(d.quelle_id)!;
        const job: PdfDocJob = { document: d, cont, source: s.source, sigle: s.sigle };
        e.job = job;
        jobOf.set(e, job);
      }

      const base = (this.fileBase.trim() || 'Documents').replace(/[\\/:*?"<>|]+/g, '_');
      const names = volumeFileNames(base, plan.map((p) => p.label || 'ohne Angabe'));
      const template = this.o.cover ? this.cleanTemplate() : null;
      const volumes: { name: string; blob: Blob }[] = [];
      for (let gi = 0; gi < plan.length; gi++) {
        const p = plan[gi];
        const stats = await this.pdf.exportDocuments(p.entries.map((e) => jobOf.get(e)!), {
          settings,
          titlePage: this.o.titlePage,
          contents: this.o.contents && this.o.titlePage,
          includeMetadata: this.o.metadata,
          apparatus: this.o.apparatus,
          sourceDescriptions: this.o.sourceDescription,
          notationDocumentation: this.o.notationDocumentation,
          neumeTree: this.o.neumeTree,
          newPagePerDocument: this.o.newPage,
          arrangeRelated: this.o.arrangeRelated,
          relatedAt: this.o.relatedBehind ? 'behind' : 'block',
          boxLabel: this.o.boxLabel,
          pageFormat: this.o.pageFormat === 'settings' ? undefined : this.o.pageFormat,
          title: this.title.trim(),
          countFrontPages: this.o.countFront,
          cover: template ? { template, group: p.label, groupField: this.splitLabel(), groupParts: this.splitBy ? this.partsOf(p.entries) : undefined } : undefined,
          output: this.splitBy ? 'blob' : 'save',
          fileName: base + '.pdf',
          onProgress: (msg, done, total) => {
            this.status = (plan.length > 1 ? `${p.label || 'ohne Angabe'}: ` : '') + msg;
            this.progress = 40 + ((gi + done / Math.max(1, total)) / plan.length) * 60;
          },
        });
        if (stats.blob) volumes.push({ name: names[gi], blob: stats.blob });
        this.warnings.push(...(stats.notationProblems ?? []));
      }
      if (this.splitBy) {
        if (volumes.length === 1) downloadBlob(volumes[0].blob, volumes[0].name);
        else {
          this.status = 'Packing the ZIP file';
          const zip = new JSZip();
          for (const v of volumes) zip.file(v.name, v.blob);
          downloadBlob(await zip.generateAsync({ type: 'blob' }), base + '.zip');
        }
      }
      if (!this.warnings.length) this.close();
    } catch (e: any) {
      console.error('PDF export failed', e);
      this.error = 'The PDF could not be created: ' + (e?.message || e);
    } finally {
      this.busy = false;
    }
  }
}

export interface PdfDialogRequest {
  /** Ready jobs (the open document, with its unsaved state). */
  jobs?: PdfDocJob[];
  /** Documents whose transcription is loaded when printing. */
  docs?: Document[];
  /** Only ids: their metadata is loaded when the dialog opens. */
  ids?: string[];
  title?: string;
  fileName?: string;
}

/** Opens the print dialog from anywhere (document view, search, manuscript, synopsis, …). */
@Injectable({ providedIn: 'root' })
export class PdfDialogLauncher {
  constructor(private appRef: ApplicationRef, private env: EnvironmentInjector, private api: APIService, private users: UserService) {}

  open(request: PdfDialogRequest): void {
    const ref = createComponent(PdfExportDialogComponent, { environmentInjector: this.env });
    ref.setInput('jobs', request.jobs ?? []);
    ref.setInput('docs', request.docs ?? []);
    ref.setInput('ids', request.ids ?? []);
    ref.setInput('title', request.title ?? '');
    ref.setInput('fileName', request.fileName ?? '');
    this.appRef.attachView(ref.hostView);
    document.body.appendChild(ref.location.nativeElement);
    ref.instance.closed.subscribe(() => {
      this.appRef.detachView(ref.hostView);
      ref.destroy();
    });
    ref.changeDetectorRef.detectChanges();
  }

  /** All documents of one manuscript. */
  async openForSource(sourceId: string, title = ''): Promise<void> {
    const token = (await firstValueFrom(this.users.user))?.token || '';
    const res: any = await firstValueFrom(this.api.queryDocuments(token, {
      dokumenten_id: undefined, gattung1: undefined, gattung2: undefined, festtag: undefined, feier: undefined, textinitium: undefined,
      bibliographischerverweis: undefined, druckausgabe: undefined, zeilenstart: undefined, foliostart: undefined, kommentar: undefined,
    }));
    const docs: Document[] = (res.documents || []).filter((d: Document) => d.quelle_id === sourceId)
      .sort((a: Document, b: Document) => compareNatural(a.dokumenten_id, b.dokumenten_id));
    this.open({ docs, title });
  }
}
