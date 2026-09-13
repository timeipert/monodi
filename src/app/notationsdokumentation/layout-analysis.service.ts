import { Injectable } from '@angular/core';
import { LayoutBlock, AnalysisRequest, AnalysisResponse } from './layout-analysis.worker';
import * as VM from '../types/model';
import { v4 as UUID } from 'uuid';

@Injectable({
  providedIn: 'root'
})
export class LayoutAnalysisService {
  private worker?: Worker;
  private cache = new Map<string, LayoutBlock[]>();

  constructor() {
    if (typeof Worker !== 'undefined') {
      try {
        this.worker = new Worker(new URL('./layout-analysis.worker', import.meta.url), { type: 'module' });
      } catch (err) {
        console.warn('Web Workers not supported or blocked, layout analysis will fallback to canvas processing.', err);
      }
    }
  }

  async analyzeImage(imageUrl: string, canvasIndex: number): Promise<LayoutBlock[]> {
    if (this.cache.has(imageUrl)) {
      return this.cache.get(imageUrl)!;
    }

    try {
      let imgBitmap: ImageBitmap | HTMLImageElement;
      try {
        const response = await fetch(imageUrl, { mode: 'cors' });
        const blob = await response.blob();
        imgBitmap = await createImageBitmap(blob);
      } catch {
        // Fallback to standard Image element
        imgBitmap = await new Promise<HTMLImageElement>((resolve, reject) => {
          const img = new Image();
          img.crossOrigin = 'Anonymous';
          img.onload = () => resolve(img);
          img.onerror = (e) => reject(e);
          img.src = imageUrl;
        });
      }

      const MAX_DIM = 1200;
      let w = imgBitmap.width;
      let h = imgBitmap.height;
      if (w > MAX_DIM || h > MAX_DIM) {
        const ratio = Math.min(MAX_DIM / w, MAX_DIM / h);
        w = Math.round(w * ratio);
        h = Math.round(h * ratio);
      }

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) return [];

      ctx.drawImage(imgBitmap, 0, 0, w, h);
      const imageData = ctx.getImageData(0, 0, w, h);

      const worker = this.worker;
      if (worker) {
        return await new Promise<LayoutBlock[]>((resolve) => {
          const timeout = setTimeout(() => resolve([]), 5000);
          const handleMessage = (e: MessageEvent<AnalysisResponse>) => {
            if (e.data && e.data.canvasIndex === canvasIndex) {
              clearTimeout(timeout);
              worker.removeEventListener('message', handleMessage);
              this.cache.set(imageUrl, e.data.blocks);
              resolve(e.data.blocks);
            }
          };
          worker.addEventListener('message', handleMessage);
          worker.postMessage({ canvasIndex, imageUrl, width: w, height: h, imageData } as AnalysisRequest);
        });
      }
      return [];
    } catch (err) {
      console.warn('Layout analysis image load failed:', err);
      return [];
    }
  }

  blocksToAnnotationRegions(blocks: LayoutBlock[], canvasIndex: number): VM.AnnotationRegion[] {
    return blocks.map((b) => ({
      id: 'r_' + UUID(),
      name: b.label,
      points: b.points,
      folio: String(canvasIndex)
    }));
  }
}
