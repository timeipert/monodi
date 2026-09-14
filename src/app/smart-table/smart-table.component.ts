import { Output, EventEmitter, SimpleChanges, Input, OnChanges, Component, OnInit } from '@angular/core';

@Component({
    selector: 'app-smart-table',
    templateUrl: './smart-table.component.html',
    styleUrls: ['./smart-table.component.css'],
    standalone: false
})
export class SmartTableComponent<T> implements OnInit, OnChanges {
  @Input()
  objects: T[] = [];

  @Input()
  headers: Header<T>[] = [];

  @Input()
  canDelete: boolean = false;

  @Input()
  filterable: boolean = true;

  @Input()
  paginated: boolean = true;

  @Input()
  pageSize: number = 10;

  @Input()
  pageSizeOptions: number[] = [10, 25, 50, 100, 200, 500];

  @Input()
  storageKey: string = 'monodi_smart_table_page_size';

  @Input()
  selectable: boolean = true;

  @Input()
  batchFields: BatchField[] = [];

  @Output()
  onRowClick = new EventEmitter<T>();

  @Output()
  onDelete = new EventEmitter<T>();

  @Output()
  onSelectionChange = new EventEmitter<T[]>();

  @Output()
  onBatchDelete = new EventEmitter<T[]>();

  @Output()
  onBatchEdit = new EventEmitter<{ items: T[]; key: string; value: string }>();

  selectedObjects = new Set<T>();
  lastSelectedIndex = -1;

  // Batch edit modal state
  showBatchEditModal = false;
  selectedBatchFieldKey = '';
  batchEditValue = '';

  // Batch delete modal state (single prompt with click-twice confirm button)
  showDeleteConfirmModal = false;
  deleteConfirmClickedOnce = false;

  sortFieldName: string | undefined = undefined;
  sortDescending = false;

  filterText = '';
  currentPage = 1;

  allRows: Row<T>[] = [];
  filteredRows: Row<T>[] = [];
  pagedRows: Row<T>[] = [];

  constructor() { }

  private isStateLoaded = false;

  private ensureStateLoaded() {
    if (this.isStateLoaded) return;
    if (this.storageKey) {
      try {
        const savedSize = localStorage.getItem(`${this.storageKey}_page_size`) || localStorage.getItem(this.storageKey);
        if (savedSize) {
          const parsed = parseInt(savedSize, 10);
          if (!isNaN(parsed) && parsed > 0) {
            this.pageSize = parsed;
          }
        }
        const savedField = localStorage.getItem(`${this.storageKey}_sort_field`);
        if (savedField) {
          this.sortFieldName = savedField;
        }
        const savedDesc = localStorage.getItem(`${this.storageKey}_sort_desc`);
        if (savedDesc !== null) {
          this.sortDescending = savedDesc === 'true';
        }
      } catch (e) {
        // Storage access error fallback
      }
    }
    this.isStateLoaded = true;
  }

  ngOnInit() {
    this.ensureStateLoaded();
  }

  private compareCells(cellA: Cell, cellB: Cell): number {
    if (cellA.sortValue !== undefined && cellB.sortValue !== undefined) {
      return cellA.sortValue - cellB.sortValue;
    }

    const txtA = (cellA.text || '').toString().trim();
    const txtB = (cellB.text || '').toString().trim();

    const numA = Number(txtA);
    const numB = Number(txtB);
    if (txtA !== '' && txtB !== '' && !isNaN(numA) && !isNaN(numB)) {
      return numA - numB;
    }

    const lowerA = txtA.toLowerCase();
    const lowerB = txtB.toLowerCase();
    return lowerA < lowerB ? -1 : lowerA > lowerB ? 1 : 0;
  }

  private saveSortState() {
    if (!this.storageKey) return;
    try {
      if (this.sortFieldName !== undefined) {
        localStorage.setItem(`${this.storageKey}_sort_field`, this.sortFieldName);
        localStorage.setItem(`${this.storageKey}_sort_desc`, String(this.sortDescending));
      } else {
        localStorage.removeItem(`${this.storageKey}_sort_field`);
        localStorage.removeItem(`${this.storageKey}_sort_desc`);
      }
    } catch (e) {
      // Storage access error fallback
    }
  }

  ngOnChanges(changes: SimpleChanges) {
    this.ensureStateLoaded();

    let structureChanged = false;
    
    if (changes['headers']) {
      const prev = changes['headers'].previousValue as Header<T>[] | undefined;
      const curr = changes['headers'].currentValue as Header<T>[] | undefined;
      if (!prev || !curr || prev.length !== curr.length || prev.some((h, i) => h.name !== curr[i].name)) {
        structureChanged = true;
      }
    }

    this.allRows = this.objects.map(o => ({
      dataObject: o,
      cells: this.headers.map(h => h.makeCell(o))
    }));

    // Clean up selection if underlying objects changed
    const validObjects = new Set(this.objects);
    for (const item of Array.from(this.selectedObjects)) {
      if (!validObjects.has(item)) {
        this.selectedObjects.delete(item);
      }
    }

    if (this.sortFieldName !== undefined) {
      const h = this.headers.find(x => x.name === this.sortFieldName);
      if (h) {
        const index = this.headers.indexOf(h);
        const multiplier = this.sortDescending ? -1 : 1;
        this.allRows.sort((a, b) => multiplier * this.compareCells(a.cells[index], b.cells[index]));
      } else {
        this.sortFieldName = undefined;
        this.saveSortState();
      }
    }

    this.applyFilterAndPagination();
  }

  sortBy(h: Header<T>) {
    const index = this.headers.indexOf(h);
    if (this.sortFieldName === h.name) {
      if (this.sortDescending) {
        this.sortFieldName = undefined;
        this.sortDescending = false;
        this.allRows = this.objects.map(o => ({
          dataObject: o,
          cells: this.headers.map(h => h.makeCell(o))
        }));
      } else {
        this.sortDescending = true;
      }
    } else {
      this.sortDescending = false;
      this.sortFieldName = h.name;
    }

    this.saveSortState();

    if (this.sortFieldName !== undefined) {
      const multiplier = this.sortDescending ? -1 : 1;
      this.allRows.sort((a, b) => multiplier * this.compareCells(a.cells[index], b.cells[index]));
    }

    this.applyFilterAndPagination();
  }

  applyFilterAndPagination() {
    // 1. Filtering
    if (this.filterable && this.filterText.trim()) {
      const q = this.filterText.toLowerCase();
      this.filteredRows = this.allRows.filter(row =>
        row.cells.some(cell => (cell.text || '').toString().toLowerCase().includes(q))
      );
    } else {
      this.filteredRows = [...this.allRows];
    }

    // 2. Pagination
    if (this.paginated) {
      const maxPage = Math.max(1, Math.ceil(this.filteredRows.length / this.pageSize));
      if (this.currentPage > maxPage) {
        this.currentPage = maxPage;
      }
      const start = (this.currentPage - 1) * this.pageSize;
      this.pagedRows = this.filteredRows.slice(start, start + this.pageSize);
    } else {
      this.pagedRows = [...this.filteredRows];
    }
  }

  onPageSizeChange(newSize: number | string) {
    const size = typeof newSize === 'string' ? parseInt(newSize, 10) : newSize;
    if (isNaN(size) || size < 1) return;
    this.pageSize = size;
    if (this.storageKey) {
      try {
        localStorage.setItem(this.storageKey, size.toString());
      } catch (e) {
        // Storage access error fallback
      }
    }
    this.currentPage = 1;
    this.applyFilterAndPagination();
  }

  setPage(page: number) {
    if (page < 1 || page > this.totalPages) return;
    this.currentPage = page;
    this.applyFilterAndPagination();
  }

  get totalPages(): number {
    return Math.ceil(this.filteredRows.length / this.pageSize);
  }

  get startRow(): number {
    return (this.currentPage - 1) * this.pageSize;
  }

  get endRow(): number {
    const end = this.currentPage * this.pageSize;
    return end > this.filteredRows.length ? this.filteredRows.length : end;
  }

  get visiblePageItems(): (number | '...')[] {
    const total = this.totalPages;
    const current = this.currentPage;

    if (total <= 7) {
      const pages: number[] = [];
      for (let i = 1; i <= total; i++) pages.push(i);
      return pages;
    }

    if (current <= 4) {
      return [1, 2, 3, 4, 5, '...', total];
    }

    if (current >= total - 3) {
      return [1, '...', total - 4, total - 3, total - 2, total - 1, total];
    }

    return [1, '...', current - 1, current, current + 1, '...', total];
  }

  get pageNumbers(): number[] {
    const pages: number[] = [];
    for (let i = 1; i <= this.totalPages; i++) {
      pages.push(i);
    }
    return pages;
  }

  rowClicked(t: T) {
    this.onRowClick.emit(t);
  }

  requestDelete(t: T) {
    this.onDelete.emit(t);
  }

  // --- Selection Logic ---
  isObjectSelected(obj: T): boolean {
    return this.selectedObjects.has(obj);
  }

  getSelectedArray(): T[] {
    return Array.from(this.selectedObjects);
  }

  get selectedCount(): number {
    return this.selectedObjects.size;
  }

  get isAllPagedSelected(): boolean {
    if (this.pagedRows.length === 0) return false;
    return this.pagedRows.every(r => this.selectedObjects.has(r.dataObject));
  }

  get isSomePagedSelected(): boolean {
    if (this.pagedRows.length === 0) return false;
    return this.pagedRows.some(r => this.selectedObjects.has(r.dataObject));
  }

  toggleSelectAllPaged(event: Event) {
    event.stopPropagation();
    const shouldSelectAll = !this.isAllPagedSelected;
    for (const r of this.pagedRows) {
      if (shouldSelectAll) {
        this.selectedObjects.add(r.dataObject);
      } else {
        this.selectedObjects.delete(r.dataObject);
      }
    }
    this.emitSelectionChange();
  }

  toggleSelectRow(obj: T, event: MouseEvent, indexInPaged: number) {
    event.stopPropagation();

    if (event.shiftKey && this.lastSelectedIndex !== -1 && this.lastSelectedIndex !== indexInPaged) {
      const start = Math.min(this.lastSelectedIndex, indexInPaged);
      const end = Math.max(this.lastSelectedIndex, indexInPaged);
      const targetState = !this.selectedObjects.has(obj);
      for (let i = start; i <= end; i++) {
        if (this.pagedRows[i]) {
          if (targetState) {
            this.selectedObjects.add(this.pagedRows[i].dataObject);
          } else {
            this.selectedObjects.delete(this.pagedRows[i].dataObject);
          }
        }
      }
    } else {
      if (this.selectedObjects.has(obj)) {
        this.selectedObjects.delete(obj);
      } else {
        this.selectedObjects.add(obj);
      }
    }

    this.lastSelectedIndex = indexInPaged;
    this.emitSelectionChange();
  }

  clearSelection() {
    this.selectedObjects.clear();
    this.lastSelectedIndex = -1;
    this.emitSelectionChange();
  }

  private emitSelectionChange() {
    this.onSelectionChange.emit(this.getSelectedArray());
  }

  // --- Batch Fields Inference ---
  get availableBatchFields(): BatchField[] {
    if (this.batchFields && this.batchFields.length > 0) {
      return this.batchFields;
    }
    return this.headers
      .filter(h => h.key && h.key !== 'docCounts' && h.key !== 'id')
      .map(h => ({
        key: h.key!,
        label: h.name
      }));
  }

  get currentBatchField(): BatchField | undefined {
    return this.availableBatchFields.find(f => f.key === this.selectedBatchFieldKey);
  }

  // --- Batch Edit Modal Handlers ---
  openBatchEditModal() {
    if (this.selectedCount === 0) return;
    const fields = this.availableBatchFields;
    if (fields.length > 0) {
      this.selectedBatchFieldKey = fields[0].key;
    } else {
      this.selectedBatchFieldKey = '';
    }
    this.batchEditValue = '';
    this.showBatchEditModal = true;
  }

  closeBatchEditModal() {
    this.showBatchEditModal = false;
  }

  applyBatchEdit() {
    if (!this.selectedBatchFieldKey || this.selectedCount === 0) return;
    const selectedItems = this.getSelectedArray();

    // Modify objects locally as fallback/convenience
    for (const item of selectedItems) {
      const target = item as any;
      if (target.custom && Object.prototype.hasOwnProperty.call(target.custom, this.selectedBatchFieldKey)) {
        target.custom[this.selectedBatchFieldKey] = this.batchEditValue;
      } else {
        target[this.selectedBatchFieldKey] = this.batchEditValue;
      }
    }

    this.onBatchEdit.emit({
      items: selectedItems,
      key: this.selectedBatchFieldKey,
      value: this.batchEditValue
    });

    this.closeBatchEditModal();
    this.clearSelection();
    this.applyFilterAndPagination();
  }

  // --- Batch Delete Single Prompt Modal (with click-twice confirm button) ---
  startBatchDelete() {
    if (this.selectedCount === 0) return;
    this.deleteConfirmClickedOnce = false;
    this.showDeleteConfirmModal = true;
  }

  closeDeleteModal() {
    this.showDeleteConfirmModal = false;
    this.deleteConfirmClickedOnce = false;
  }

  handleDeleteButtonClick() {
    if (!this.deleteConfirmClickedOnce) {
      // First click on confirm button inside modal
      this.deleteConfirmClickedOnce = true;
    } else {
      // Second click on confirm button -> execute deletion!
      this.confirmBatchDelete();
    }
  }

  confirmBatchDelete() {
    if (this.selectedCount === 0) return;
    const itemsToDelete = this.getSelectedArray();
    this.onBatchDelete.emit(itemsToDelete);
    this.closeDeleteModal();
    this.clearSelection();
  }
}

export type Cell = TextCell | LinkCell | BadgeCell;

export interface TextCell {
  kind: "text";
  text: string;
  title?: string;
  sortValue?: number;
}

export interface LinkCell {
  kind: "link";
  text: string;
  href: string;
  title?: string;
  sortValue?: number;
}

export interface BadgeCell {
  kind: "badge";
  text: string;
  title?: string;
  sortValue?: number;
}

export interface Header<T> {
  name: string;
  key?: string;
  makeCell(data: T): Cell;
}

export interface Row<T> {
  dataObject: T;
  cells: Cell[];
}

export interface BatchField {
  key: string;
  label: string;
  type?: 'text' | 'select';
  options?: string[];
}
