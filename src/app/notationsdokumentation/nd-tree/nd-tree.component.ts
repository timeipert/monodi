import { Component, EventEmitter, Input, OnChanges, Output } from '@angular/core';
import { buildNeumeTree, edgePath, layoutNeumeTree, NeumeTree, TreeLayout, TreeNode } from '../../neume-tree';
import { renderSvg } from '../svg-pattern/svg-pattern.component';

interface PlacedNode { node: TreeNode; x: number; y: number; w: number; h: number; /** The table's code of this node (a node can be written two ways, `[*]` and `*`). */ code: string }

/**
 * The neume tree of the documentation's patterns: left to right by number of notes, each pattern growing out of
 * the shorter one it contains (`*` → `*u` → `*ud`). A pattern opens its panel.
 */
@Component({
  selector: 'app-nd-tree',
  standalone: false,
  template: `
    @if (!placed.length) {
      <div class="text-muted">No pattern to arrange: the documentation shows none.</div>
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
            <button type="button" class="nd-node" [style.left.px]="p.x" [style.top.px]="p.y + 20" [style.width.px]="p.w"
              [title]="p.node.codes.join(', ')" (click)="open.emit(p.code)">
              <app-svg-pattern [pattern]="p.node.code"></app-svg-pattern>
              <code>{{ p.node.code }}</code>
            </button>
          }
        </div>
      </div>
      <div class="text-muted small mt-2">Each pattern grows out of the shorter one it contains; <code>[ ]</code> marks notes written as one group.</div>
    }
  `,
  styles: [`
    .nd-tree { position: relative; overflow: auto; border: 1px solid var(--bs-border-color); border-radius: .5rem; background: #fff; padding: .5rem; }
    .nd-tree-inner { position: relative; }
    .nd-node { position: absolute; text-align: center; border: none; background: transparent; padding: 0; border-radius: 4px; }
    .nd-node:hover { background: #e7f1ff; }
    .nd-node app-svg-pattern { display: block; }
    .nd-node code { display: block; white-space: nowrap; font-size: 11px; line-height: 14px; color: #222; }
    .nd-head { position: absolute; font-size: 11px; color: #888; text-align: center; }
  `],
})
export class NdTreeComponent implements OnChanges {
  /** The patterns of the table. */
  @Input() patterns: string[] = [];
  @Output() open = new EventEmitter<string>();

  tree: NeumeTree = buildNeumeTree([]);
  layout: TreeLayout = { width: 0, height: 0, boxes: new Map(), columns: [], edges: [] };
  placed: PlacedNode[] = [];
  edges: { d: string }[] = [];
  rootX = 0;
  rootY = 0;

  ngOnChanges(): void {
    const inTable = new Set(this.patterns);
    this.tree = buildNeumeTree(this.patterns);
    this.layout = layoutNeumeTree(this.tree, node => {
      if (node === this.tree.root) return { w: 6, h: 6, anchorY: 3 };
      const picture = renderSvg(node.code);
      // the lines meet the middle of the notes: the picture has 24 of room above the first note and 8 below the lowest
      return { w: Math.max(picture.width, node.code.length * 6.6 + 8), h: picture.height + 14, anchorY: 24 + (picture.height - 32) / 2 };
    });
    this.placed = this.tree.nodes.map(node => {
      const b = this.layout.boxes.get(node)!;
      return { node, x: b.x, y: b.y, w: b.w, h: b.h, code: node.codes.find(c => inTable.has(c)) ?? node.code };
    });
    this.edges = this.layout.edges.map(e => ({ d: edgePath(e) }));
    const root = this.layout.boxes.get(this.tree.root);
    this.rootX = root ? root.x + root.w / 2 : 0;
    this.rootY = root ? root.y + root.anchorY : 0;
  }
}
