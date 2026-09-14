import { Component, Input, OnChanges, HostListener } from '@angular/core';

export interface CutoutOverlayItem {
  id: string;
  points: string;
  displayId: string;
  pattern: string;
}

@Component({
    selector: 'app-annotation-cutout',
    templateUrl: './annotation-cutout.component.html',
    styleUrls: ['./annotation-cutout.component.css'],
    standalone: false
})
export class AnnotationCutoutComponent implements OnChanges {
  @Input() imageUrl!: string;
  @Input() regionPoints!: string;
  @Input() items: CutoutOverlayItem[] = [];
  @Input() width: string = '100%';
  @Input() height: string = 'auto';

  viewBox: string = '0 0 100 100';
  vbCoords = { x: 0, y: 0, w: 100, h: 100 };
  private baseVbCoords = { x: 0, y: 0, w: 100, h: 100 };

  zoomLevel = 1;
  panX = 0;
  panY = 0;

  ngOnChanges() {
    this.updateViewBox();
  }

  updateViewBox() {
    if (!this.regionPoints) {
      this.baseVbCoords = { x: 0, y: 0, w: 100, h: 100 };
      this.applyZoomAndPan();
      return;
    }

    const arr = this.regionPoints.split(' ').filter(p => p).map(p => {
      const parts = p.split(',');
      return { x: +parts[0], y: +parts[1] };
    });

    if (arr.length === 0) return;

    const xs = arr.map(p => p.x);
    const ys = arr.map(p => p.y);
    const mx = Math.min(...xs);
    const my = Math.min(...ys);
    const w = Math.max(...xs) - mx;
    const h = Math.max(...ys) - my;

    const pad = 0.3; // 30% padding
    const px = Math.max(w * pad, 1.5);
    const py = Math.max(h * pad, 5.0); // More padding on top for labels

    const vbX = Math.max(0, mx - px);
    const vbY = Math.max(0, my - py);
    const vbW = Math.min(100 - vbX, w + px * 2);
    const vbH = Math.min(100 - vbY, h + py * 1.5); // Slightly less padding on bottom

    this.baseVbCoords = { x: vbX, y: vbY, w: vbW, h: vbH };
    this.applyZoomAndPan();
  }

  applyZoomAndPan() {
    const w = this.baseVbCoords.w / this.zoomLevel;
    const h = this.baseVbCoords.h / this.zoomLevel;
    
    const cx = this.baseVbCoords.x + this.baseVbCoords.w / 2 + this.panX;
    const cy = this.baseVbCoords.y + this.baseVbCoords.h / 2 + this.panY;

    this.vbCoords = { 
      x: cx - w/2, 
      y: cy - h/2, 
      w, 
      h 
    };
    this.viewBox = `${this.vbCoords.x} ${this.vbCoords.y} ${this.vbCoords.w} ${this.vbCoords.h}`;
  }

  onWheel(event: WheelEvent) {
    event.preventDefault();
    const zoomSpeed = 0.1;
    if (event.deltaY < 0) {
      this.zoomLevel *= (1 + zoomSpeed);
    } else {
      this.zoomLevel /= (1 + zoomSpeed);
    }
    this.zoomLevel = Math.max(0.5, Math.min(this.zoomLevel, 10));
    this.applyZoomAndPan();
  }

  isDragging = false;
  private lastMouseX = 0;
  private lastMouseY = 0;

  onMouseDown(event: MouseEvent) {
    this.isDragging = true;
    this.lastMouseX = event.clientX;
    this.lastMouseY = event.clientY;
  }

  @HostListener('window:mousemove', ['$event'])
  onMouseMove(event: MouseEvent) {
    if (!this.isDragging) return;
    const dx = event.clientX - this.lastMouseX;
    const dy = event.clientY - this.lastMouseY;
    this.lastMouseX = event.clientX;
    this.lastMouseY = event.clientY;

    const scaleX = this.vbCoords.w / 500; 
    const scaleY = this.vbCoords.h / 150; 
    
    this.panX -= dx * scaleX;
    this.panY -= dy * scaleY;
    this.applyZoomAndPan();
  }

  @HostListener('window:mouseup')
  onMouseUp() {
    this.isDragging = false;
  }

  resetView() {
    this.zoomLevel = 1;
    this.panX = 0;
    this.panY = 0;
    this.applyZoomAndPan();
  }

  getLabelStyle(ov: CutoutOverlayItem) {
    if (!ov.points) return {};
    const pts = ov.points.split(' ')[0].split(',');
    const itemX = parseFloat(pts[0]);
    const itemY = parseFloat(pts[1]);

    const xPercent = (itemX - this.vbCoords.x) / this.vbCoords.w;
    const yPercent = (itemY - this.vbCoords.y) / this.vbCoords.h;

    return {
      left: `${xPercent * 100}%`,
      top: `${yPercent * 100}%`
    };
  }
}
