import { ChangeDetectorRef } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { intervalNotation, pitchNotation } from '@monodi/core/analysis';
import type { PatternUnit, ResultView, TableView } from '@monodi/core/analysis';
import { layoutColumns, niceTicks, rampColor, ResultViewComponent, tickLabel } from './result-view.component';
import { NotationSnippetComponent } from './notation-snippet.component';

describe('ResultViewComponent', () => {
  let fixture: ComponentFixture<ResultViewComponent>;
  let comp: ResultViewComponent;

  /** The component keeps plain fields (no signals), so it is rendered through its own change detector. */
  const render = () => fixture.debugElement.injector.get(ChangeDetectorRef).detectChanges();

  function show(view: ResultView): HTMLElement {
    comp.view = view;
    comp.ngOnChanges();
    render();
    return fixture.nativeElement as HTMLElement;
  }

  const table = (rows: TableView['rows'], extra: Partial<TableView> = {}): TableView => ({
    kind: 'table', title: 'Words', columns: [{ key: 'w', label: 'Word' }, { key: 'n', label: 'Count', numeric: true }, { key: 'm', label: 'More', numeric: true }],
    rows: rows.map((r) => (r.length === 2 ? [...r, 0] : r)), totalRows: rows.length, truncated: false, ...extra,
  });
  const firstColumn = (el: HTMLElement) => Array.from(el.querySelectorAll('tbody tr td:first-child')).map((x) => x.textContent!.trim());

  beforeEach(() => {
    TestBed.configureTestingModule({ declarations: [ResultViewComponent, NotationSnippetComponent], imports: [FormsModule] });
    fixture = TestBed.createComponent(ResultViewComponent);
    comp = fixture.componentInstance;
  });

  describe('tables', () => {
    it('shows a table with its title and row count', () => {
      const el = show(table([['dominus', 5], ['deus', 3]]));
      expect(el.textContent).toContain('Words');
      expect(el.textContent).toContain('2 rows');
      expect(el.querySelectorAll('tbody tr').length).toBe(2);
    });

    it('sorts a numeric column from high to low first, then back', () => {
      const el = show(table([['a', 1], ['b', 9], ['c', 5]]));
      comp.sortBy(1);
      render();
      expect(firstColumn(el)).toEqual(['b', 'c', 'a']);
      comp.sortBy(1);
      render();
      expect(firstColumn(el)).toEqual(['a', 'c', 'b']);
    });

    it('pages long tables', () => {
      const rows = Array.from({ length: 60 }, (_, i) => [`w${i}`, i]);
      const el = show(table(rows));
      expect(el.querySelectorAll('tbody tr').length).toBe(25);
      expect(el.textContent).toContain('page 1 of 3');
      comp.page = 2;
      render();
      expect(el.querySelectorAll('tbody tr').length).toBe(10);
    });

    it('says when a stored table was cut', () => {
      const el = show(table([['a', 1]], { totalRows: 900, truncated: true }));
      expect(el.textContent).toContain('of 900');
    });

    it('filters the rows by text, all words must match, and shows how many remain', () => {
      const rows = Array.from({ length: 40 }, (_, i) => [i % 2 ? `odd word ${i}` : `even word ${i}`, i]);
      const el = show(table(rows));
      comp.textFilter = 'odd 7'; // both words must occur: the odd rows that contain a 7
      comp.refresh();
      render();
      expect(firstColumn(el)).toEqual(['odd word 7', 'odd word 17', 'odd word 27', 'odd word 37']);
      expect(el.textContent).toContain('4 of 40 rows');
      comp.clearFilters();
      render();
      expect(comp.order.length).toBe(40);
    });

    it('filters a numeric column by a minimum and a text column by a substring', () => {
      const el = show(table([['aa', 1], ['ab', 5], ['bb', 9]]));
      comp.colFilters = ['', '5', ''];
      comp.refresh();
      render();
      expect(firstColumn(el)).toEqual(['ab', 'bb']);
      comp.colFilters = ['a', '5', ''];
      comp.refresh();
      render();
      expect(firstColumn(el)).toEqual(['ab']);
    });

    it('filters on the text of notes in a cell', () => {
      const el = show(table([[pitchNotation([29, 31]), 1], [pitchNotation([30, 32]), 2]]));
      comp.textFilter = 'd4 f4';
      comp.refresh();
      render();
      expect(el.querySelectorAll('tbody tr').length).toBe(1);
    });

    it('draws the notes of a cell as a staff and reports the pattern on a click', () => {
      const el = show(table([[intervalNotation([2, -1]), 1], [pitchNotation([29, 31]), 2], ['x', 3]]));
      expect(el.querySelectorAll('tbody app-notation-snippet').length).toBe(2);
      const got: { unit: PatternUnit; text: string }[] = [];
      comp.searchPattern.subscribe((p: { unit: PatternUnit; text: string }) => got.push(p));
      (el.querySelectorAll('tbody .rv-notes')[0] as HTMLButtonElement).click();
      (el.querySelectorAll('tbody .rv-notes')[1] as HTMLButtonElement).click();
      expect(got).toEqual([{ unit: 'interval', text: '+2 -1' }, { unit: 'pitch', text: 'D4 F4' }]);
    });

    it('a contour is reported as a contour', () => {
      show(table([['x', 1]]));
      const got: { unit: PatternUnit; text: string }[] = [];
      comp.searchPattern.subscribe((p: { unit: PatternUnit; text: string }) => got.push(p));
      comp.clickPattern('u d r …', 'interval');
      expect(got).toEqual([{ unit: 'contour', text: 'u d r' }]);
    });

    it('offers the documents behind a row, and behind all rows that pass the filter', () => {
      const el = show(table([['a', 1], ['b', 2], ['c', 3]], { rowDocs: [['d1'], ['d2', 'd3'], null] }));
      let got: string[] = [];
      comp.openDocs.subscribe((ids: string[]) => (got = ids));
      (el.querySelector('tbody button.btn-link') as HTMLButtonElement).click();
      expect(got).toEqual(['d1']);
      comp.textFilter = 'b';
      comp.refresh();
      expect(comp.filteredDocs).toEqual(['d2', 'd3']);
    });

    it('puts bars inside the cells of the first measure column of a wide table, not of a two-column table', () => {
      show(table([['a', 1], ['b', 2], ['c', 3], ['d', 4]]));
      expect(comp.barCol).toBe(1);
      expect(comp.barPct(3)).toBe(100);
      show({ kind: 'table', title: 'T', columns: [{ key: 'k', label: 'Measure' }, { key: 'v', label: 'Value', numeric: true }], rows: [['a', 1], ['b', 2], ['c', 3], ['d', 4]], totalRows: 4, truncated: false });
      expect(comp.barCol).toBe(-1);
    });
  });

  describe('charts', () => {
    it('draws a histogram as thin columns on one baseline with the peak marked and its value on top', () => {
      const el = show({ kind: 'bars', layout: 'columns', title: 'H', items: [{ label: 'a', value: 10 }, { label: 'b', value: 40 }, { label: 'c', value: 20 }], unit: 'notes' });
      expect(el.querySelectorAll('path.rv-col').length).toBe(3);
      expect(el.querySelectorAll('path.rv-col-peak').length).toBe(1);
      expect(el.querySelector('.rv-peak')!.textContent).toContain('40');
      expect(el.querySelectorAll('line.rv-grid-line').length).toBeGreaterThan(2);
    });

    it('draws a ranking with the notes as labels, longest bar scaled to the full width', () => {
      const el = show({ kind: 'bars', layout: 'rows', title: 'R', items: [{ label: '+2', value: 10, notation: intervalNotation([2]).notation }, { label: 'x', value: 5 }] });
      const bars = Array.from(el.querySelectorAll('.rv-rank-bar')) as HTMLElement[];
      expect(bars.map((b) => b.style.width)).toEqual(['86%', '43%']);
      expect(el.querySelectorAll('.rv-rank-label app-notation-snippet').length).toBe(1);
    });

    it('can show the data behind a chart as a table', () => {
      const el = show({ kind: 'bars', layout: 'columns', title: 'H', items: [{ label: 'a', value: 10 }, { label: 'b', value: 5 }] });
      comp.showData = true;
      render();
      expect(el.querySelectorAll('tbody tr').length).toBe(2);
    });

    it('draws a heat map with one cell per value, darkest where it is closest', () => {
      const el = show({ kind: 'matrix', title: 'M', rowLabels: ['a', 'b'], colLabels: ['a', 'b'], values: [[0, 1], [1, 0]], digits: 2, lowIsClose: true });
      expect(el.querySelectorAll('tbody td').length).toBe(4);
      expect(comp.cellColor(0)).not.toBe(comp.cellColor(1));
      expect(comp.cellInk(0)).toBe('#ffffff');
      expect(comp.cellInk(1)).toBe('#0b0b0b');
    });

    it('draws a dendrogram with a line pair per merge, every leaf and a distance scale', () => {
      const el = show({ kind: 'tree', title: 'T', leaves: ['A', 'B', 'C'], merges: [{ a: 0, b: 1, height: 1 }, { a: 3, b: 2, height: 4 }] });
      expect(el.querySelectorAll('svg line.rv-tree-line').length).toBe(6);
      const labels = Array.from(el.querySelectorAll('svg text.rv-leaf')).map((t) => t.textContent!.trim()).sort();
      expect(labels).toEqual(['A', 'B', 'C']);
      expect(comp.treeTicks.length).toBeGreaterThan(1);
    });

    it('draws a scatter plot with a point per entry and a frame', () => {
      const el = show({ kind: 'scatter', title: 'S', points: [{ label: 'a', x: 0, y: 0, group: 'g' }, { label: 'b', x: 1, y: 2, group: 'h' }] });
      expect(el.querySelectorAll('svg circle').length).toBe(2);
      expect(el.querySelector('svg rect.rv-frame')).toBeTruthy();
    });
  });
});

describe('chart geometry', () => {
  it('niceTicks gives clean steps from 0 up to the maximum', () => {
    expect(niceTicks(7800)).toEqual([0, 2000, 4000, 6000, 8000]);
    expect(niceTicks(12)).toEqual([0, 5, 10, 15]);
    expect(niceTicks(0)).toEqual([0, 1]);
  });

  it('tickLabel is full below 10,000 and compact on a larger axis', () => {
    expect(tickLabel(8000, false)).toBe('8000');
    expect(tickLabel(15000, true)).toBe('15K');
    expect(tickLabel(500, true)).toBe('500');
  });

  it('layoutColumns keeps columns at most 16 px wide with a gap, rounded at the data end and flat at the base', () => {
    const c = layoutColumns({ kind: 'bars', title: 't', layout: 'columns', items: [{ label: 'a', value: 5 }, { label: 'b', value: 10 }] });
    for (const b of c.bars) {
      expect(b.w).toBeLessThanOrEqual(16);
      expect(b.y + b.h).toBeCloseTo(c.baseY, 5);
    }
    expect(c.bars[1].h).toBeGreaterThan(c.bars[0].h);
    expect(c.bars[1].x - (c.bars[0].x + c.bars[0].w)).toBeGreaterThanOrEqual(2);
    expect(c.bars[1].path).toContain('Q');
    expect(c.bars[1].path.startsWith(`M${c.bars[1].x},${c.baseY}`)).toBeTrue();
  });

  it('layoutColumns draws nothing for a zero value and thins the x labels of a long axis', () => {
    const items = Array.from({ length: 100 }, (_, i) => ({ label: `l${i}`, value: i % 7 === 0 ? 0 : i }));
    const c = layoutColumns({ kind: 'bars', title: 't', layout: 'columns', items });
    expect(c.bars[0].path).toBe('');
    expect(c.xLabels.length).toBeLessThan(40);
  });

  it('rampColor runs from light to dark blue', () => {
    expect(rampColor(0)).toBe('rgb(205,226,251)');
    expect(rampColor(1)).toBe('rgb(13,54,107)');
  });
});
