import { ApplicationRef, ChangeDetectorRef, Component, ElementRef, EnvironmentInjector, Injectable, OnDestroy, ViewChild, createComponent } from '@angular/core';
import * as VM from './types/model';
import { ProjectSettings } from './api.service';
import { FocusService } from './focus.service';
import { PdfDocJob, PdfExportService, PdfRenderHost } from './pdf-export.service';
import { getCategoryDetails } from './comment/comment-categories';
import { commentLemma, commentType } from './comment-lemma';
import { minNoteYOf, requiredPadTop } from './notes/Drawables';

/**
 * The hidden DOM the PDF export measures and draws from. It renders ONE document at a time,
 * read-only (the sections as the printed page shows them) together with the comment blocks
 * of the apparatus, independent of whatever the user has open.
 */
@Component({
  selector: 'app-pdf-render-host',
  standalone: false,
  template: `<div id="pdf-render-host" #hostEl style="position: absolute; left: -9999px; top: 0; width: 1000px; background: white;">
  @if (job) {
    <app-root-section [data]="job.cont" [zipper]="[]" [levelNames]="[]" [readOnly]="true" [comments]="job.cont.comments || []"
      [documentType]="job.cont.documentType || 'Antiphon'" [sourceId]="job.document.quelle_id"></app-root-section>
    <div id="pdf-comments-render-area"
    [style.--tree-padding]="(settings?.pdfCommentTreePadding ?? 4) + 'px'"
    [style.--tree-gap]="(settings?.pdfCommentTreeGap ?? 4) + 'px'"
    style="width: 1000px; background: white;">
    <!-- Global Comment first -->
    @if (job.cont.globalComment) {
      <div class="pdf-comment-block pdf-global-comment" style="display: flex; flex-direction: column; align-items: flex-start; margin-bottom: 20px; width: 100%;">
        <h4 class="app-index" style="margin-bottom: 5px;">Global comment</h4>
        <app-comment-tree [tree]="job.cont.globalComment" [readOnly]="true"></app-comment-tree>
      </div>
    }
    <!-- Numbered comments -->
    @for (comment of job.cont.comments; track comment; let i = $index) {
      <div class="pdf-comment-block" [attr.data-idx]="i" style="display: flex; flex-direction: column; align-items: flex-start; margin-bottom: 20px; width: 100%;">
        <div style="display: flex; align-items: center; margin-bottom: 5px;">
          @if (comment.category && getCategoryDetails(comment.category); as cat) {
            <span class="app-category" style="font-family: times; font-style: italic; font-size: 10pt; margin-right: 5px;">{{cat.label}}</span>
          }
          <span class="app-index" style="font-family: times; font-weight: bold; font-size: 10pt;">{{ lemmaOf(comment) || (i + 1) }}]@if (comment.emendation) {
            <span> ⟨em.⟩</span>
          }</span>
        </div>
        @if (typeOf(comment) === 'text') {
          <span class="text" style="font-family: helvetica; font-size: 10pt; margin-bottom: 10px;">{{comment.text}}</span>
        }
        @if (typeOf(comment) === 'tree' && comment.tree) {
          <app-comment-tree [tree]="comment.tree" [readOnly]="true"></app-comment-tree>
        }
        @if (typeOf(comment) === 'lines' && comment.lines) {
          <div class="lines-container" style="width: 100%;">
            @for (line of comment.lines; track line; let j = $index) {
              <div style="margin-bottom: 10px; width: 100%;">
                @if (comment.readingWitnesses?.[j]) {
                  <span class="app-witness-siglum" style="font-family: times; font-weight: bold; font-size: 9pt; display: block; margin-bottom: 2px;">{{comment.readingWitnesses[j]}}</span>
                }
                @if (line.kind === 'ZeileContainer') {
                  <app-zeile-section [data]="line" [readOnly]="true" [comments]="[]" [zipper]="[0]" [documentType]="job.cont.documentType"></app-zeile-section>
                }
                @if (line.kind === 'ParatextContainer') {
                  <app-paratext-section [data]="line" [readOnly]="true" [comments]="[]" [zipper]="[0]" [documentType]="job.cont.documentType"></app-paratext-section>
                }
              </div>
            }
          </div>
        }
      </div>
    }
  </div>
  }
</div>
`,
})
export class PdfRenderHostComponent implements PdfRenderHost, OnDestroy {
  @ViewChild('hostEl', { static: true }) hostEl!: ElementRef<HTMLElement>;
  job: PdfDocJob | null = null;
  settings: ProjectSettings | null = null;
  getCategoryDetails = getCategoryDetails;
  /** Time spent per render phase (ms), summed over all renders — read by the export service. */
  phaseMs: { [phase: string]: number } = {};
  private phase<T>(name: string, fn: () => T): T {
    const a = performance.now();
    try { return fn(); } finally { this.phaseMs[name] = (this.phaseMs[name] || 0) + (performance.now() - a); }
  }

  constructor(private cdr: ChangeDetectorRef, private focus: FocusService, private pdf: PdfExportService) {
    this.pdf.registerHost(this);
  }

  ngOnDestroy(): void { this.pdf.registerHost(null); }

  get element(): HTMLElement { return this.hostEl.nativeElement; }

  lemmaOf(c: VM.Comment): string { return this.job ? commentLemma(VM.getAllLineParts(this.job.cont), c) : ''; }
  typeOf(c: VM.Comment): string { return commentType(c); }

  /** Renders `job`; resolves when the sections have laid themselves out (their size is stable). */
  async render(job: PdfDocJob, settings?: ProjectSettings | null): Promise<void> {
    this.settings = settings ?? null;
    this.phase('hostDestroy', () => { this.job = null; this.cdr.detectChanges(); });

    // What the note components read from the focus service for "their" document.
    const sylls = VM.getSyllables(job.cont);
    this.focus.firstSyllableUuid = sylls.length ? sylls[0].uuid : null;
    let minY = Infinity;
    for (const sy of sylls) {
      minY = Math.min(minY, minNoteYOf(sy.notes));
      for (const extra of (sy as any).additionalMelodies || []) minY = Math.min(minY, minNoteYOf(extra));
    }
    this.focus.docPadTop = Number.isFinite(minY) ? requiredPadTop(minY) : 0;

    this.phase('hostBuild', () => { this.job = job; this.cdr.detectChanges(); });
    const a = performance.now();
    await this.settle();
    this.phaseMs['hostSettle'] = (this.phaseMs['hostSettle'] || 0) + (performance.now() - a);
  }

  clear(): void {
    this.job = null;
    this.cdr.detectChanges();
  }

  /**
   * Waits until the rendered syllables have settled: their number and total width are the
   * same on two consecutive ticks. After a synchronous change detection that is normally the
   * case within a couple of macrotasks (the note components only fill their editor-only
   * pitch fields in a timeout, which the PDF does not read), so this costs ~30 ms instead of
   * the several hundred a fixed polling interval needed.
   */
  private async settle(): Promise<void> {
    const sample = () => {
      const notes = this.element.querySelectorAll('app-notes');
      let w = 0;
      notes.forEach((n) => { w += (n as HTMLElement).offsetWidth; });
      return `${notes.length}:${w}`;
    };
    // A MessageChannel message is a macrotask boundary without the >=4 ms clamp of setTimeout.
    const channel = new MessageChannel();
    const tick = (ms: number) => ms > 0
      ? new Promise<void>((r) => setTimeout(r, ms))
      : new Promise<void>((r) => { channel.port1.onmessage = () => r(); channel.port2.postMessage(0); });
    // One macrotask lets the queued timeouts of the note components run; if nothing changed
    // meanwhile we are done. Otherwise keep polling (safety net for slow machines).
    const ph = (n: string, a: number) => { this.phaseMs[n] = (this.phaseMs[n] || 0) + (performance.now() - a); };
    let a = performance.now();
    let last = sample();
    ph('settleSample0', a);
    try {
    for (let i = 0; i < 80; i++) {
      a = performance.now(); await tick(i === 0 ? 0 : 16); ph('settleTick', a);
      if (i === 0) { a = performance.now(); this.cdr.detectChanges(); ph('settleCd', a); }
      a = performance.now(); const now = sample(); ph('settleSample', a);
      if (now === last) return;
      last = now;
    }
    } finally {
      channel.port1.close();
      channel.port2.close();
    }
  }
}

/** Creates the host once, outside the router outlet, so any page can use the exporter. */
@Injectable({ providedIn: 'root' })
export class PdfHostLauncher {
  private ref: ReturnType<typeof createComponent<PdfRenderHostComponent>> | null = null;

  constructor(private appRef: ApplicationRef, private env: EnvironmentInjector, private pdf: PdfExportService) {}

  ensure(): void {
    if (this.pdf.hasHost) return;
    this.ref = createComponent(PdfRenderHostComponent, { environmentInjector: this.env });
    this.appRef.attachView(this.ref.hostView);
    document.body.appendChild(this.ref.location.nativeElement);
    this.ref.changeDetectorRef.detectChanges();
  }
}
