import { Component, EventEmitter, Input, OnChanges, Output } from '@angular/core';
import { Source } from '../../api.service';
import { buildNotationDoc, NotationDoc } from '../../notation-doc';
import { baseCode, searchPatterns } from '../../notation-order';
import { candidatesFor, Candidate, defaultSetup, NotationSetup, setIncluded, readSourceSet, writeSourceSet } from '../../notation-set';
import { buildNeumeTree, edgePath, layoutNeumeTree, parseTreeCode, TreeLayout, TreeNode, NeumeTree } from '../../neume-tree';
import { renderSvg } from '../svg-pattern/svg-pattern.component';

interface PlacedNode { node: TreeNode; x: number; y: number; w: number; h: number; pictureH: number }

/**
 * A manuscript's notation documentation as the print shows it, in the browser: the table of its neume patterns with
 * where their signs are seen, and the neume tree. Which patterns it shows is the workspace's standard set (Settings →
 * Notation) as this manuscript restricts or extends it; the checklist below changes that, and is kept with the manuscript.
 */
@Component({
  selector: 'app-notation-docs-view',
  standalone: false,
  styles: [`
    .nd-tree { position: relative; overflow: auto; border: 1px solid var(--bs-border-color); border-radius: .5rem; background: #fff; padding: .5rem; }
    .nd-tree-inner { position: relative; }
    .nd-node { position: absolute; text-align: center; }
    .nd-node code { display: block; white-space: nowrap; font-size: 11px; line-height: 14px; color: #222; }
    .nd-head { position: absolute; font-size: 11px; color: #888; text-align: center; }
    .nd-origin { font-size: .7rem; }
  `],
  template: `
    <div class="d-flex flex-wrap align-items-center gap-2 mb-3">
      <div class="btn-group btn-group-sm" role="group" aria-label="View">
        <button type="button" class="btn" [class.btn-primary]="view === 'table'" [class.btn-outline-primary]="view !== 'table'" id="nd-view-table" (click)="view = 'table'">
          <i class="bi bi-table me-1"></i>Table
        </button>
        <button type="button" class="btn" [class.btn-primary]="view === 'tree'" [class.btn-outline-primary]="view !== 'tree'" id="nd-view-tree" (click)="view = 'tree'">
          <i class="bi bi-diagram-3 me-1"></i>Neume tree
        </button>
      </div>
      <button type="button" class="btn btn-sm btn-outline-secondary" id="nd-toggle-set" (click)="showSet = !showSet">
        <i class="bi bi-sliders me-1"></i>Patterns shown: {{ shown }} of {{ candidates.length }}
      </button>
      <span class="text-muted small">The standard set is in Settings → Notation.</span>
    </div>

    @if (showSet) {
      <div class="card border-light shadow-sm mb-3" id="nd-set">
        <div class="card-body">
          <p class="small text-muted mb-2">
            Tick what this manuscript's documentation shows. The standard set is shown unless you take a pattern out;
            what has snippets is shown too. Patterns that only have a row in the neume table are offered here.
          </p>
          <div class="table-responsive" style="max-height: 22rem; overflow: auto;">
            <table class="table table-sm align-middle mb-2">
              <thead class="table-light small text-muted"><tr><th style="width: 2.5rem;"></th><th style="width: 7rem;">Shape</th><th>Pattern</th><th>ID</th><th>From</th><th class="text-end">Snippets</th></tr></thead>
              <tbody>
                @for (c of candidates; track c.pattern) {
                  <tr [class.text-muted]="!c.included">
                    <td><input type="checkbox" class="form-check-input" [checked]="c.included" (change)="toggle(c, $any($event.target).checked)" [attr.aria-label]="'Show ' + c.pattern"></td>
                    <td><app-svg-pattern [pattern]="c.pattern"></app-svg-pattern></td>
                    <td><code>{{ c.pattern }}</code></td>
                    <td>{{ c.refId || '–' }}</td>
                    <td>
                      @for (o of c.origins; track o) {
                        <span class="badge bg-light text-dark border nd-origin me-1">{{ originLabel(o) }}</span>
                      }
                    </td>
                    <td class="text-end">{{ c.snippets || '' }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
          <div class="position-relative" style="max-width: 28rem;">
            <input class="form-control form-control-sm" [(ngModel)]="query" (ngModelChange)="search()" (keydown.enter)="addTyped()" placeholder="Add a pattern: type a code such as *ud (Enter adds it as typed)" aria-label="Add a pattern" id="nd-add">
            @if (hits.length) {
              <div class="list-group position-absolute w-100 shadow-sm" style="z-index: 20; max-height: 14rem; overflow: auto;">
                @for (h of hits; track h) {
                  <button type="button" class="list-group-item list-group-item-action d-flex align-items-center gap-3 py-1" (click)="add(h)">
                    <span style="min-width: 6rem;"><app-svg-pattern [pattern]="h"></app-svg-pattern></span><code>{{ h }}</code>
                  </button>
                }
              </div>
            }
          </div>
        </div>
      </div>
    }

    @if (view === 'table') {
      <div class="table-responsive">
        <table class="table table-sm align-middle" id="nd-table">
          <thead class="table-light small text-muted"><tr><th style="width: 6rem;">ID</th><th style="width: 8rem;">Shape</th><th style="width: 3rem;"></th><th>Where</th></tr></thead>
          <tbody>
            @for (r of doc.rows; track r.pattern; let i = $index) {
              @for (v of (r.variants.length ? r.variants : [emptyVariant]); track v.variant; let j = $index) {
                <tr>
                  <td>
                    @if (j === 0) { @for (p of r.idParts; track p) { <div>{{ p }}</div> } }
                  </td>
                  <td>@if (j === 0) { <app-svg-pattern [pattern]="r.pattern"></app-svg-pattern> }</td>
                  <td>{{ v.variant }}</td>
                  <td>
                    @for (p of v.places; track p.text; let last = $last) { {{ p.text }}{{ last ? '' : ', ' }} }
                    @if (!v.places.length) { <span class="text-muted">–</span> }
                  </td>
                </tr>
              }
            }
            @if (!doc.rows.length) {
              <tr><td colspan="4" class="text-muted">Nothing to show yet: the standard set is empty and this manuscript has no snippets.</td></tr>
            }
          </tbody>
        </table>
      </div>
      @if (doc.notes.length) {
        <div class="small">
          @for (n of doc.notes; track n.key) { <div><span class="me-3">{{ n.key }}</span><i>{{ n.text }}</i></div> }
        </div>
      }
    }

    @if (view === 'tree') {
      @if (!placed.length) {
        <div class="text-muted">No pattern to arrange: see "Patterns shown".</div>
      } @else {
        <div class="nd-tree" id="nd-tree">
          <div class="nd-tree-inner" [style.width.px]="layout.width + 20" [style.height.px]="layout.height + 28">
            @for (c of layout.columns; track c.count) {
              @if (c.count > 0) {
                <span class="nd-head" [style.left.px]="c.x" [style.width.px]="c.w" style="top: 0;">{{ c.count }} {{ c.count === 1 ? 'note' : 'notes' }}</span>
              }
            }
            <svg class="position-absolute" style="left: 0; top: 0; pointer-events: none;" [attr.width]="layout.width + 20" [attr.height]="layout.height + 28" aria-hidden="true">
              <g transform="translate(0 20)">
                @for (e of edges; track e.d) { <path [attr.d]="e.d" fill="none" stroke="#555" stroke-width="1"></path> }
                <circle [attr.cx]="rootX" [attr.cy]="rootY" r="3" fill="#222"></circle>
              </g>
            </svg>
            @for (p of placed; track p.node.id) {
              <div class="nd-node" [style.left.px]="p.x" [style.top.px]="p.y + 20" [style.width.px]="p.w" [title]="p.node.code + ' · ' + p.node.text">
                <app-svg-pattern [pattern]="p.node.code"></app-svg-pattern>
                <code>{{ p.node.code }}</code>
              </div>
            }
          </div>
        </div>
        <div class="text-muted small mt-2">Each pattern grows out of the shorter one it contains; <code>[ ]</code> marks notes written as one group.</div>
      }
    }
  `,
})
export class NotationDocsViewComponent implements OnChanges {
  @Input() source: Source | null = null;
  @Input() setup: NotationSetup = defaultSetup();
  /** Emitted when the source was changed (the page saves it). */
  @Output() sourceChanged = new EventEmitter<void>();

  view: 'table' | 'tree' = 'table';
  showSet = false;
  query = '';
  hits: string[] = [];

  doc: NotationDoc = { rows: [], strips: [], notes: [], withoutId: 0, excluded: 0 };
  candidates: Candidate[] = [];
  shown = 0;
  readonly emptyVariant = { variant: '', places: [] as { text: string }[] };

  // the tree, placed: rebuilt when the documentation changes, not on every change detection
  tree: NeumeTree = buildNeumeTree([]);
  layout: TreeLayout = { width: 0, height: 0, boxes: new Map(), columns: [], edges: [] };
  placed: PlacedNode[] = [];
  edges: { d: string }[] = [];
  rootX = 0;
  rootY = 0;

  ngOnChanges(): void { this.refresh(); }

  originLabel(o: string): string {
    return o === 'standard' ? 'standard set' : o === 'snippets' ? 'snippets' : o === 'table' ? 'neume table' : 'added';
  }

  private refresh(): void {
    const src: any = this.source ?? {};
    this.doc = buildNotationDoc(src, this.setup);
    this.candidates = candidatesFor(src, this.setup);
    this.shown = this.candidates.filter(c => c.included).length;
    this.tree = buildNeumeTree(this.doc.rows.map(r => r.pattern));
    const sized = new Map<TreeNode, { w: number; h: number; pictureH: number }>();
    this.layout = layoutNeumeTree(this.tree, node => {
      if (node === this.tree.root) return { w: 6, h: 6, anchorY: 3 };
      const picture = renderSvg(node.code);
      const s = { w: Math.max(picture.width, node.code.length * 6.6 + 8), h: picture.height + 14, pictureH: picture.height };
      sized.set(node, s);
      // the lines meet the middle of the notes: the picture has 24 of room above the first note and 8 below the lowest
      return { w: s.w, h: s.h, anchorY: 24 + (picture.height - 32) / 2 };
    });
    this.placed = this.tree.nodes.map(node => {
      const b = this.layout.boxes.get(node)!;
      return { node, x: b.x, y: b.y, w: b.w, h: b.h, pictureH: sized.get(node)?.pictureH ?? 0 };
    });
    this.edges = this.layout.edges.map(e => ({ d: edgePath(e) }));
    const root = this.layout.boxes.get(this.tree.root);
    this.rootX = root ? root.x + root.w / 2 : 0;
    this.rootY = root ? root.y + root.anchorY : 0;
  }

  private changed(): void {
    this.refresh();
    this.sourceChanged.emit();
  }

  toggle(c: Candidate, included: boolean): void {
    if (!this.source) return;
    setIncluded(this.source as any, this.setup, c.pattern, included);
    this.changed();
  }

  search(): void {
    const have = new Set(this.candidates.map(c => c.pattern));
    this.hits = searchPatterns(this.query, have, 12);
  }

  /** Adds a pattern the manuscript's documentation shows although the standard set does not have it. */
  add(pattern: string): void {
    const p = baseCode(pattern);
    if (!this.source || !p) return;
    const set = readSourceSet(this.source);
    if (!set.add.includes(p)) set.add.push(p);
    set.remove = set.remove.filter(x => x !== p);
    writeSourceSet(this.source as any, set);
    this.query = '';
    this.hits = [];
    this.changed();
  }

  addTyped(): void {
    const code = baseCode(this.query);
    if (parseTreeCode(code)) this.add(code);
  }
}
