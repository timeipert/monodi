import { ChangeDetectorRef } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { intervalNotation, pitchNotation } from '@monodi/core/analysis';
import type { PatternUnit, ResultView, TableView } from '@monodi/core/analysis';
import { niceTicks, rampColor, ResultViewComponent, tickLabel } from './result-view.component';
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
    const grouped: ResultView = {
      kind: 'bars', layout: 'columns', title: 'Pitch', unit: 'notes',
      items: [{ label: 'C4', value: 6 }, { label: 'D4', value: 10 }],
      series: [{ name: 'A', n: 3, values: [4, 6] }, { name: 'B', n: 2, values: [2, 4] }],
    };

    it('draws a histogram as an SVG in black and white, one bar per value, with no background', () => {
      const el = show({ kind: 'bars', layout: 'columns', title: 'H', items: [{ label: 'a', value: 10 }, { label: 'b', value: 40 }, { label: 'c', value: 20 }], unit: 'notes' });
      const svg = el.querySelector('.rv-fig svg')!;
      expect(svg).toBeTruthy();
      expect(svg.querySelectorAll('rect').length).toBe(3);
      expect(Array.from(svg.querySelectorAll('[fill]')).map((n) => n.getAttribute('fill')).every((f) => f === '#000000')).toBeTrue();
      expect(el.textContent).not.toContain('Panels'); // one series: nothing to arrange
    });

    it('offers panels, share and colour for groups and redraws when one is changed', () => {
      const el = show(grouped);
      expect(el.textContent).toContain('Panels');
      expect(el.querySelectorAll('.rv-fig svg rect').length).toBe(4);
      expect(el.querySelector('.rv-fig svg')!.textContent).toContain('A (n = 3)');
      comp.setStyle({ colour: true });
      render();
      expect(el.querySelector('.rv-fig svg')!.innerHTML).toContain('#2a78d6');
      comp.setStyle({ groups: 'grouped' });
      render();
      expect(el.querySelector('.rv-fig svg')!.textContent).toContain('A (n = 3)');
    });

    it('starts a group chart as shares and a chart without groups as counts', () => {
      show(grouped);
      expect(comp.style.value).toBe('share');
      show({ kind: 'bars', layout: 'columns', title: 'H', items: [{ label: 'a', value: 1 }] });
      expect(comp.style.value).toBe('count');
    });

    it('shows a figure with its caption and a download menu', () => {
      const el = show({ kind: 'figure', title: 'Figure 1', panels: [grouped as any], caption: 'Figure 1. A caption.' });
      expect(el.querySelector('.rv-fig svg')).toBeTruthy();
      expect(el.querySelector('.rv-caption')!.textContent).toContain('Figure 1. A caption.');
      const items = Array.from(el.querySelectorAll('[ngbDropdownItem]')).map((b) => b.textContent!.trim().split(/\s+/)[0]);
      expect(items).toEqual(['PDF', 'PNG', 'SVG']);
      expect(comp.style.widthMm).toBe(175);
    });

    it('downloads the figure as SVG without tooltips and as PNG and PDF files', async () => {
      const downloads: Blob[] = [];
      spyOn(window.URL, 'createObjectURL').and.callFake((b: Blob | MediaSource) => { downloads.push(b as Blob); return 'blob:test'; });
      show(grouped);
      await comp.download('svg');
      expect(downloads.length).toBe(1);
      const text = await downloads[0].text();
      expect(text.startsWith('<?xml')).toBeTrue();
      expect(text).not.toContain('<title>');
      await comp.download('png');
      expect(downloads[1].type).toBe('image/png');
      await comp.download('pdf');
      expect(downloads[2].type).toBe('application/pdf');
      expect(comp.exportError).toBe('');
    });

    it('draws a ranking with the notes as labels, longest bar scaled to the full width', () => {
      const el = show({ kind: 'bars', layout: 'rows', title: 'R', items: [{ label: '+2', value: 10, notation: intervalNotation([2]).notation }, { label: 'x', value: 5 }] });
      const bars = Array.from(el.querySelectorAll('.rv-rank-bar')) as HTMLElement[];
      expect(bars.map((b) => b.style.width)).toEqual(['86%', '43%']);
      expect(el.querySelectorAll('.rv-rank-label app-notation-snippet').length).toBe(1);
      expect(el.querySelector('.rv-fig')).toBeNull();
    });

    it('can show the data behind a chart as a table, with a column per group', () => {
      const el = show(grouped);
      comp.showData = true;
      render();
      expect(el.querySelectorAll('tbody tr').length).toBe(2);
      expect(Array.from(el.querySelectorAll('thead th')).map((t) => t.textContent!.trim())).toEqual(['', 'All', 'A', 'B']);
    });

    it('draws a heat map with one cell per value, darkest where it is closest', () => {
      const el = show({ kind: 'matrix', title: 'M', rowLabels: ['a', 'b'], colLabels: ['a', 'b'], values: [[0, 1], [1, 0]], digits: 2, lowIsClose: true });
      expect(el.querySelectorAll('tbody td').length).toBe(4);
      expect(comp.cellColor(0)).not.toBe(comp.cellColor(1));
      expect(comp.cellInk(0)).toBe('#ffffff');
      expect(comp.cellInk(1)).toBe('#0b0b0b');
    });

    it('draws a dendrogram as an SVG with every leaf', () => {
      const el = show({ kind: 'tree', title: 'T', leaves: ['A', 'B', 'C'], merges: [{ a: 0, b: 1, height: 1 }, { a: 3, b: 2, height: 4 }] });
      const labels = Array.from(el.querySelectorAll('.rv-fig svg text')).map((t) => t.textContent!.trim());
      expect(labels).toEqual(jasmine.arrayContaining(['A', 'B', 'C']));
      expect(el.querySelectorAll('.rv-fig svg line').length).toBeGreaterThan(6);
    });

    it('draws a scatter plot with a point per entry and a marker per group', () => {
      const el = show({ kind: 'scatter', title: 'S', points: [{ label: 'a', x: 0, y: 0, group: 'g' }, { label: 'b', x: 1, y: 2, group: 'h' }] });
      expect(el.querySelectorAll('.rv-fig svg circle').length).toBeGreaterThanOrEqual(2); // a circle for group g, in the legend too
      expect(el.querySelector('.rv-fig svg polygon')).toBeTruthy(); // a triangle for group h
    });
  });
});

describe('chart helpers', () => {
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

  it('rampColor runs from light to dark grey', () => {
    expect(rampColor(0)).toBe('rgb(242,242,242)');
    expect(rampColor(1)).toBe('rgb(26,26,26)');
  });
});
