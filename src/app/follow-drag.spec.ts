import { NgZone } from '@angular/core';
import { followDrag } from './follow-drag';

describe('followDrag', () => {
  let zone: NgZone;
  let stops: (() => void)[];
  const move = (x = 0) => window.dispatchEvent(new MouseEvent('mousemove', { clientX: x }));
  const release = () => window.dispatchEvent(new MouseEvent('mouseup'));

  beforeEach(() => { zone = new NgZone({ enableLongStackTrace: false }); stops = []; });
  afterEach(() => stops.forEach(s => s()));
  const start = (onMove: (e: MouseEvent) => void, onEnd?: () => void) => { const s = followDrag(zone, onMove, onEnd); stops.push(s); return s; };

  it('reports every movement and the release, inside the zone', () => {
    const seen: number[] = [];
    let ended = 0;
    let moveInZone = false;
    start(e => { seen.push(e.clientX); moveInZone = NgZone.isInAngularZone(); }, () => ended++);
    move(5); move(9); release();
    expect(seen).toEqual([5, 9]);
    expect(moveInZone).toBeTrue();
    expect(ended).toBe(1);
  });

  it('stops listening once released', () => {
    const seen: number[] = [];
    start(e => seen.push(e.clientX));
    release();
    move(3);
    expect(seen).toEqual([]);
  });

  it('runs no change detection for movements before the drag or after it', () => {
    let passes = 0;
    const sub = zone.onMicrotaskEmpty.subscribe(() => passes++);
    move(1);                    // before: nobody listens
    start(() => {});
    release();
    move(2);                    // after: nobody listens any more
    sub.unsubscribe();
    // only the release re-enters the zone (once)
    expect(passes).toBe(1);
  });

  it('can be ended early, and ending twice is harmless', () => {
    const seen: number[] = [];
    const stop = start(e => seen.push(e.clientX));
    stop();
    stop();
    move(4);
    expect(seen).toEqual([]);
  });
});
