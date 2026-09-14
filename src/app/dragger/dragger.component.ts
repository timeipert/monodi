import {
  Input, Output, EventEmitter, Component, OnInit, OnDestroy,
  ChangeDetectionStrategy, ChangeDetectorRef, NgZone, ElementRef, AfterViewInit, ViewChild
} from '@angular/core';
import { Subscription } from 'rxjs';
import { DragStateService } from './drag-state.service';

@Component({
    selector: 'app-dragger',
    templateUrl: './dragger.component.html',
    styleUrls: ['./dragger.component.css'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false
})
export class DraggerComponent implements OnInit, AfterViewInit, OnDestroy {
  @Input() zipper!: number[];
  @Input() actions!: string[];

  @Output() actionRequested = new EventEmitter<string>();
  @Output() dropRequested = new EventEmitter<DragRequest>();
  @Output() dragEnterTarget = new EventEmitter<void>();
  @Output() dragLeaveTarget = new EventEmitter<void>();

  @ViewChild('middle') middleEl!: ElementRef<HTMLElement>;

  isDragTarget = false;
  isValidDrop = false;
  isDraggingSelf = false;

  private sub = new Subscription();

  constructor(
    private dragState: DragStateService,
    private cdr: ChangeDetectorRef,
    private zone: NgZone
  ) {}

  ngOnInit() {}

  ngAfterViewInit() {
    // Run dragover outside Angular so it doesn't trigger CD on every frame
    this.zone.runOutsideAngular(() => {
      this.middleEl.nativeElement.addEventListener('dragover', (ev: DragEvent) => {
        ev.preventDefault();
      });
    });

    this.sub.add(
      this.dragState.change$.subscribe(() => {
        const dz = this.dragState.draggingZipper;
        const self = !!dz && this.dragState.zippersEqual(dz, this.zipper);
        const valid = this.dragState.isValidTarget(this.zipper);
        if (valid !== this.isValidDrop || self !== this.isDraggingSelf) {
          this.isValidDrop = valid;
          this.isDraggingSelf = self;
          this.cdr.markForCheck();
        }
      })
    );
  }

  ngOnDestroy() {
    this.sub.unsubscribe();
  }

  dragstart(ev: DragEvent): void {
    ev.dataTransfer!.setData('text/plain', JSON.stringify(this.zipper));
    ev.dataTransfer!.dropEffect = 'move';
    setTimeout(() => {
      this.dragState.startDrag(this.zipper);
    }, 0);
  }

  dragend(_ev: DragEvent): void {
    this.dragState.endDrag();
    this.isDragTarget = false;
    this.dragLeaveTarget.emit();
  }

  dragenter(_ev: DragEvent): void {
    if (this.dragState.isValidTarget(this.zipper)) {
      this.isDragTarget = true;
      this.dragState.setHovered(this.zipper);
      this.dragEnterTarget.emit();
      this.cdr.markForCheck();
    }
  }

  dragleave(_ev: DragEvent): void {
    this.isDragTarget = false;
    this.dragState.setHovered(null);
    this.dragLeaveTarget.emit();
    this.cdr.markForCheck();
  }

  drop(ev: DragEvent): void {
    ev.preventDefault();
    this.isDragTarget = false;
    this.dragState.endDrag();
    this.dragLeaveTarget.emit();
    this.dropRequested.emit({
      from: JSON.parse(ev.dataTransfer!.getData('text/plain')),
      to: this.zipper
    });
  }

  getActionIcon(action: string): string {
    const a = action.toLowerCase();
    if (a.includes('delete') || a.startsWith('x ')) {
      return 'bi bi-trash text-danger';
    }
    if (a.includes('merge')) {
      return 'bi bi-intersect text-warning';
    }
    if (a.includes('line')) {
      return 'bi bi-music-note-list text-success';
    }

    if (a.includes('text')) {
      return 'bi bi-file-earmark-text text-primary';
    }
    if (a.includes('copy')) {
      return 'bi bi-copy text-secondary';
    }
    if (a.includes('paste')) {
      if (a.includes('notes')) return 'bi bi-clipboard-x text-secondary';
      if (a.includes('text')) return 'bi bi-clipboard-minus text-secondary';
      return 'bi bi-clipboard-check text-secondary';
    }
    if (a.includes('+ l')) {
      return 'bi bi-plus-square text-info';
    }
    return 'bi bi-gear';
  }

  getActionLabel(action: string): string {
    if (action === 'Copy') {
      return 'Copy section';
    }
    if (action === 'x Delete') {
      return 'Delete';
    }
    return action;
  }
}

export interface DragRequest {
  from: number[];
  to: number[];
}
