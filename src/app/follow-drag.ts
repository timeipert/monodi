import { NgZone } from '@angular/core';

/**
 * Follows the mouse for the length of one drag: `onMove` for every movement, `onEnd` once on release.
 *
 * Why not `@HostListener('window:mousemove')`: that listener lives as long as the component and sits inside the
 * Angular zone, so every mouse movement anywhere on the page runs a full change-detection pass of the whole
 * component tree, drag or no drag. Here the window listeners exist only while a drag runs, outside the zone, and
 * only the callbacks go back into it. Returns a function that ends the drag early (for example on destroy).
 */
export function followDrag(zone: NgZone, onMove: (event: MouseEvent) => void, onEnd: () => void = () => {}): () => void {
  let active = true;
  const stop = () => {
    if (!active) return;
    active = false;
    window.removeEventListener('mousemove', move);
    window.removeEventListener('mouseup', up);
  };
  const move = (event: MouseEvent) => zone.run(() => onMove(event));
  const up = () => { stop(); zone.run(onEnd); };
  zone.runOutsideAngular(() => {
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  });
  return stop;
}
