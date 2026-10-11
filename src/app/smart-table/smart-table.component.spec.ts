import { waitForAsync, ComponentFixture, TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { SmartTableComponent } from './smart-table.component';

describe('SmartTableComponent', () => {
  let component: SmartTableComponent<any>;
  let fixture: ComponentFixture<SmartTableComponent<any>>;

  beforeEach(waitForAsync(() => {
    TestBed.configureTestingModule({
      declarations: [ SmartTableComponent ],
      imports: [ FormsModule ]
    })
    .compileComponents();
  }));

  beforeEach(() => {
    fixture = TestBed.createComponent(SmartTableComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should generate truncated visible page items when total pages > 7', () => {
    component.filteredRows = new Array(410).fill({ dataObject: {}, cells: [] });
    component.pageSize = 10;
    component.currentPage = 1;

    expect(component.totalPages).toBe(41);
    expect(component.visiblePageItems).toEqual([1, 2, 3, 4, 5, '...', 41]);

    component.currentPage = 15;
    expect(component.visiblePageItems).toEqual([1, '...', 14, 15, 16, '...', 41]);

    component.currentPage = 40;
    expect(component.visiblePageItems).toEqual([1, '...', 37, 38, 39, 40, 41]);
  });

  it('should change page size and persist in localStorage', () => {
    const key = 'test_smart_table_page_size';
    component.storageKey = key;
    component.filteredRows = new Array(100).fill({ dataObject: {}, cells: [] });

    component.onPageSizeChange(25);
    expect(component.pageSize).toBe(25);
    expect(localStorage.getItem(key)).toBe('25');

    localStorage.removeItem(key);
  });

  it('should sort rows numerically when sortValue is provided', () => {
    component.headers = [{ name: 'Docs', makeCell: (obj: any) => ({ kind: 'text', text: obj.text, sortValue: obj.total }) }];
    component.objects = [
      { text: '1/20', total: 20 },
      { text: '5', total: 5 },
      { text: '2/100', total: 100 },
      { text: '2', total: 2 }
    ];
    component.ngOnChanges({});

    component.sortBy(component.headers[0]);
    expect(component.allRows.map(r => r.dataObject.total)).toEqual([2, 5, 20, 100]);

    component.sortBy(component.headers[0]); // Descending
    expect(component.allRows.map(r => r.dataObject.total)).toEqual([100, 20, 5, 2]);
  });

  it('should persist sort field and direction in localStorage when storageKey is set', () => {
    const key = 'test_sort_persistence';
    component.storageKey = key;
    component.headers = [{ name: 'Siglum', makeCell: (obj: any) => ({ kind: 'text', text: obj.siglum }) }];
    component.objects = [
      { siglum: 'B' },
      { siglum: 'A' }
    ];
    component.ngOnChanges({});

    component.sortBy(component.headers[0]);
    expect(localStorage.getItem(`${key}_sort_field`)).toBe('Siglum');
    expect(localStorage.getItem(`${key}_sort_desc`)).toBe('false');

    component.sortBy(component.headers[0]);
    expect(localStorage.getItem(`${key}_sort_desc`)).toBe('true');

    localStorage.removeItem(`${key}_sort_field`);
    localStorage.removeItem(`${key}_sort_desc`);
  });

  it('should restore sort and sort rows on initial load when sort state exists in localStorage', () => {
    const key = 'test_restore_on_refresh';
    localStorage.setItem(`${key}_sort_field`, 'Docs');
    localStorage.setItem(`${key}_sort_desc`, 'true');

    const newFixture = TestBed.createComponent(SmartTableComponent);
    const newComp = newFixture.componentInstance;
    newComp.storageKey = key;
    newComp.headers = [{ name: 'Docs', makeCell: (obj: any) => ({ kind: 'text', text: String(obj.total), sortValue: obj.total }) }];
    newComp.objects = [
      { total: 5 },
      { total: 100 },
      { total: 2 }
    ];

    newComp.ngOnChanges({});

    expect(newComp.sortFieldName).toBe('Docs');
    expect(newComp.sortDescending).toBe(true);
    expect(newComp.allRows.map(r => (r.dataObject as any).total)).toEqual([100, 5, 2]);

    localStorage.removeItem(`${key}_sort_field`);
    localStorage.removeItem(`${key}_sort_desc`);
  });

  it('should support toggling row selection and select all paged rows (page specific)', () => {
    const item1 = { id: 1, name: 'Item 1' };
    const item2 = { id: 2, name: 'Item 2' };
    const item3 = { id: 3, name: 'Item 3' };
    component.headers = [{ name: 'Name', key: 'name', makeCell: (obj: any) => ({ kind: 'text', text: obj.name }) }];
    component.objects = [item1, item2, item3];
    component.pageSize = 2;
    component.ngOnChanges({});

    expect(component.selectedCount).toBe(0);
    expect(component.pagedRows.length).toBe(2);

    const dummyEvent = { stopPropagation: () => {} } as any;
    component.toggleSelectRow(item1, dummyEvent, 0);
    expect(component.isObjectSelected(item1)).toBe(true);
    expect(component.selectedCount).toBe(1);

    // Toggle select all on page 1 (should only select page 1 items: item1 & item2, NOT item3 on page 2)
    component.toggleSelectAllPaged(dummyEvent);
    expect(component.selectedCount).toBe(2);
    expect(component.isAllPagedSelected).toBe(true);
    expect(component.isObjectSelected(item3)).toBe(false);

    component.toggleSelectAllPaged(dummyEvent);
    expect(component.selectedCount).toBe(0);
  });

  it('should support page sizes up to 200 and 500', () => {
    expect(component.pageSizeOptions).toContain(200);
    expect(component.pageSizeOptions).toContain(500);
  });

  it('should support Shift-click range selection', () => {
    const items = [
      { id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }
    ];
    component.headers = [{ name: 'ID', key: 'id', makeCell: (obj: any) => ({ kind: 'text', text: String(obj.id) }) }];
    component.objects = items;
    component.ngOnChanges({});

    const dummyEvent = { stopPropagation: () => {} } as any;
    const shiftEvent = { stopPropagation: () => {}, shiftKey: true } as any;

    // Click first item
    component.toggleSelectRow(items[0], dummyEvent, 0);
    expect(component.selectedCount).toBe(1);

    // Shift-click fourth item (range 0..3)
    component.toggleSelectRow(items[3], shiftEvent, 3);
    expect(component.selectedCount).toBe(4);
  });

  it('should require clicking delete confirmation button twice before deleting', () => {
    const item1 = { id: 1 };
    const item2 = { id: 2 };
    component.headers = [{ name: 'ID', key: 'id', makeCell: (obj: any) => ({ kind: 'text', text: String(obj.id) }) }];
    component.objects = [item1, item2];
    component.canDelete = true;
    component.ngOnChanges({});

    const dummyEvent = { stopPropagation: () => {} } as any;
    component.toggleSelectRow(item1, dummyEvent, 0);

    let deletedItems: any[] = [];
    component.onBatchDelete.subscribe(items => deletedItems = items);

    // Start batch delete -> modal opens
    component.startBatchDelete();
    expect(component.showDeleteConfirmModal).toBe(true);
    expect(component.deleteConfirmClickedOnce).toBe(false);
    expect(deletedItems.length).toBe(0);

    // Click confirm button 1st time -> button changes state to click again
    component.handleDeleteButtonClick();
    expect(component.deleteConfirmClickedOnce).toBe(true);
    expect(deletedItems.length).toBe(0); // Not deleted yet!

    // Click confirm button 2nd time -> triggers batch deletion!
    component.handleDeleteButtonClick();
    expect(deletedItems).toEqual([item1]);
    expect(component.showDeleteConfirmModal).toBe(false);
    expect(component.selectedCount).toBe(0);
  });

  it('should apply batch edit column value across selected rows', () => {
    const item1 = { id: 1, region: 'North' };
    const item2 = { id: 2, region: 'South' };
    component.headers = [{ name: 'Region', key: 'region', makeCell: (obj: any) => ({ kind: 'text', text: obj.region }) }];
    component.objects = [item1, item2];
    component.batchFields = [{ key: 'region', label: 'Region' }];
    component.ngOnChanges({});

    const dummyEvent = { stopPropagation: () => {} } as any;
    component.toggleSelectRow(item1, dummyEvent, 0);
    component.toggleSelectRow(item2, dummyEvent, 1);

    let batchEditResult: any = null;
    component.onBatchEdit.subscribe(res => batchEditResult = res);

    component.openBatchEditModal();
    expect(component.showBatchEditModal).toBe(true);

    component.selectedBatchFieldKey = 'region';
    component.batchEditValue = 'East';
    component.applyBatchEdit();

    expect(batchEditResult).toEqual({
      items: [item1, item2],
      key: 'region',
      value: 'East'
    });
    expect(item1.region).toBe('East');
    expect(item2.region).toBe('East');
    expect(component.selectedCount).toBe(0);
  });

  describe('sorting text with numbers in it', () => {
    const header = { name: 'ID', key: 'id', makeCell: (obj: any) => ({ kind: 'text' as const, text: obj.id }) };
    const sortedIds = (ids: string[], descending = false) => {
      component.headers = [header];
      component.objects = ids.map(id => ({ id }));
      component.sortFieldName = undefined;
      component.ngOnChanges({});
      component.sortBy(header);
      if (descending) component.sortBy(header);
      return component.allRows.map(r => r.dataObject.id);
    };

    it('orders every part of an ID by its value, not by its characters', () => {
      expect(sortedIds(['Pa 10-1-1', 'Pa 2-1-1'])).toEqual(['Pa 2-1-1', 'Pa 10-1-1']);
      expect(sortedIds(['Mo 1-10-1', 'Mo 1-2-1'])).toEqual(['Mo 1-2-1', 'Mo 1-10-1']);
      expect(sortedIds(['Mo 1-1-10', 'Mo 1-1-2'])).toEqual(['Mo 1-1-2', 'Mo 1-1-10']);
    });

    it('puts the letters first: Aa 20-1-1 comes before Pa 1-1-1', () => {
      expect(sortedIds(['Pa 1-1-1', 'Aa 20-1-1'])).toEqual(['Aa 20-1-1', 'Pa 1-1-1']);
    });

    it('sorts a whole list, ascending and descending', () => {
      const shuffled = ['Pa 10-1-1', 'Mo 1-1-10', 'Pa 1-1-1', 'Mo 1-10-1', 'Aa 20-1-1', 'Mo 1-1-2', 'Pa 2-1-1', 'Mo 1-2-1'];
      const ascending = ['Aa 20-1-1', 'Mo 1-1-2', 'Mo 1-1-10', 'Mo 1-2-1', 'Mo 1-10-1', 'Pa 1-1-1', 'Pa 2-1-1', 'Pa 10-1-1'];
      expect(sortedIds(shuffled)).toEqual(ascending);
      expect(sortedIds(shuffled, true)).toEqual([...ascending].reverse());
    });

    it('does not let capitals decide, and keeps plain numbers numeric', () => {
      expect(sortedIds(['b 1', 'A 2', 'a 10'])).toEqual(['A 2', 'a 10', 'b 1']);
      expect(sortedIds(['10', '9', '100'])).toEqual(['9', '10', '100']);
    });

    it('keeps empty values together at the start', () => {
      expect(sortedIds(['B 1', '', 'A 1'])).toEqual(['', 'A 1', 'B 1']);
    });
  });

  describe('stable rows', () => {
    const header = { name: 'Name', key: 'name', makeCell: (obj: any) => ({ kind: 'text' as const, text: obj.name }) };

    it('keeps its rows when change detection hands it equal inputs again', () => {
      const items = [{ name: 'A' }, { name: 'B' }];
      component.headers = [header];
      component.objects = items;
      component.ngOnChanges({});
      const rows = [...component.allRows];

      component.ngOnChanges({});
      component.ngOnChanges({});

      expect(component.allRows.length).toBe(2);
      expect(component.allRows[0]).toBe(rows[0]);
      expect(component.allRows[1]).toBe(rows[1]);
    });

    it('rebuilds its rows when the objects or the headers are replaced', () => {
      component.headers = [header];
      component.objects = [{ name: 'A' }];
      component.ngOnChanges({});
      const first = component.allRows[0];

      component.objects = [{ name: 'A' }];
      component.ngOnChanges({});
      expect(component.allRows[0]).not.toBe(first);

      const second = component.allRows[0];
      component.headers = [{ ...header }];
      component.ngOnChanges({});
      expect(component.allRows[0]).not.toBe(second);
    });

    it('rebuilds its rows when objects are added to the same array', () => {
      const items: any[] = [{ name: 'A' }];
      component.headers = [header];
      component.objects = items;
      component.ngOnChanges({});
      expect(component.allRows.length).toBe(1);

      items.push({ name: 'B' });
      component.ngOnChanges({});
      expect(component.allRows.length).toBe(2);
    });

    it('survives objects and headers that are missing', () => {
      component.objects = undefined as any;
      component.headers = undefined as any;
      expect(() => component.ngOnChanges({})).not.toThrow();
      expect(component.allRows).toEqual([]);
    });

    it('keeps the same <tr> elements while a parent keeps passing a new, equal batchFields array', () => {
      const items = [{ name: 'A' }, { name: 'B' }];
      fixture.componentRef.setInput('headers', [header]);
      fixture.componentRef.setInput('objects', items);
      fixture.detectChanges();
      const trs = Array.from(fixture.nativeElement.querySelectorAll('tbody tr')) as HTMLElement[];
      expect(trs.length).toBe(2);

      for (let i = 0; i < 3; i++) {
        fixture.componentRef.setInput('batchFields', [{ key: 'name', label: 'Name' }]);
        fixture.detectChanges();
      }

      const after = Array.from(fixture.nativeElement.querySelectorAll('tbody tr')) as HTMLElement[];
      expect(after.length).toBe(2);
      expect(after[0]).toBe(trs[0]);
      expect(after[1]).toBe(trs[1]);
    });

    it('keeps the same <tr> elements when a column is hidden or shown', () => {
      const other = { name: 'Other', key: 'other', makeCell: (obj: any) => ({ kind: 'text' as const, text: obj.other }) };
      const items = [{ name: 'A', other: 'x' }];
      fixture.componentRef.setInput('headers', [header, other]);
      fixture.componentRef.setInput('objects', items);
      fixture.detectChanges();
      const tr = fixture.nativeElement.querySelector('tbody tr') as HTMLElement;

      fixture.componentRef.setInput('headers', [header]);
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelector('tbody tr')).toBe(tr);
      expect(tr.querySelectorAll('td.td-smart-row').length).toBe(1);
    });

    it('emits the row object when a row is clicked, also after the inputs were refreshed', () => {
      const items = [{ name: 'A' }, { name: 'B' }];
      fixture.componentRef.setInput('headers', [header]);
      fixture.componentRef.setInput('objects', items);
      fixture.detectChanges();
      const clicked: any[] = [];
      component.onRowClick.subscribe(o => clicked.push(o));

      fixture.componentRef.setInput('batchFields', [{ key: 'name', label: 'Name' }]);
      fixture.detectChanges();
      (fixture.nativeElement.querySelectorAll('tbody tr')[1].querySelector('td.td-smart-row') as HTMLElement).click();

      expect(clicked).toEqual([items[1]]);
    });

    it('shows the new values after a batch edit', () => {
      const item = { name: 'A', region: 'North' };
      const region = { name: 'Region', key: 'region', makeCell: (obj: any) => ({ kind: 'text' as const, text: obj.region }) };
      component.headers = [region];
      component.objects = [item];
      component.batchFields = [{ key: 'region', label: 'Region' }];
      component.ngOnChanges({});
      component.toggleSelectRow(item, { stopPropagation: () => {} } as any, 0);

      component.openBatchEditModal();
      component.batchEditValue = 'East';
      component.applyBatchEdit();

      expect(component.pagedRows[0].cells[0]).toEqual(jasmine.objectContaining({ text: 'East' }));
    });

    it('keeps the selection when only the headers change', () => {
      const item = { name: 'A' };
      component.headers = [header];
      component.objects = [item];
      component.ngOnChanges({});
      component.toggleSelectRow(item, { stopPropagation: () => {} } as any, 0);

      component.headers = [{ ...header }];
      component.ngOnChanges({});

      expect(component.isObjectSelected(item)).toBeTrue();
    });
  });
});

