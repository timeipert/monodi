import * as localforage from 'localforage';
import { PushCache } from './push-cache';

describe('PushCache', () => {
  let mockStore: Map<string, any>;

  beforeEach(() => {
    mockStore = new Map<string, any>();
    spyOn(localforage, 'getItem').and.callFake(async (key: string) =>
      mockStore.has(key) ? mockStore.get(key) : null);
    spyOn(localforage, 'setItem').and.callFake(async (key: string, value: any) => {
      mockStore.set(key, value); return value;
    });
    // Reset the in-memory caches so tests don't leak into each other.
    (PushCache as any).cleanIds = null;
    (PushCache as any).deletedIds = null;
  });

  it('starts with nothing clean', async () => {
    expect(await PushCache.getCleanIds()).toEqual(new Set());
  });

  it('markClean then getCleanIds round-trips', async () => {
    await PushCache.markClean(['a', 'b']);
    expect(await PushCache.getCleanIds()).toEqual(new Set(['a', 'b']));
  });

  it('markDirty evicts from the clean set', async () => {
    await PushCache.markClean(['a', 'b', 'c']);
    await PushCache.markDirty('b');
    expect(await PushCache.getCleanIds()).toEqual(new Set(['a', 'c']));
  });

  it('markDirty accepts a single id, an array, or null/undefined entries without throwing', async () => {
    await PushCache.markClean(['a']);
    await PushCache.markDirty('a');
    expect(await PushCache.getCleanIds()).toEqual(new Set());

    await PushCache.markClean(['x', 'y']);
    await PushCache.markDirty([null, undefined, 'x'] as any);
    expect(await PushCache.getCleanIds()).toEqual(new Set(['y']));

    await expectAsync(PushCache.markDirty(null)).toBeResolved();
    await expectAsync(PushCache.markDirty(undefined)).toBeResolved();
  });

  it('persists across a fresh in-memory load (survives "reload")', async () => {
    await PushCache.markClean(['a', 'b']);
    // Simulate a fresh page load: drop the in-memory cache, force a reload
    // from the (mocked) persisted store.
    (PushCache as any).cleanIds = null;
    expect(await PushCache.getCleanIds()).toEqual(new Set(['a', 'b']));
  });

  it('markDeleted removes from clean and records the deletion', async () => {
    await PushCache.markClean(['a']);
    await PushCache.markDeleted(['a', 'b']);
    expect(await PushCache.getCleanIds()).toEqual(new Set());
    expect(await PushCache.getPendingDeletions()).toEqual(new Set(['a', 'b']));
  });

  it('clearDeleted removes from the pending-deletions set', async () => {
    await PushCache.markDeleted(['a', 'b', 'c']);
    await PushCache.clearDeleted(['b']);
    expect(await PushCache.getPendingDeletions()).toEqual(new Set(['a', 'c']));
  });

  it('invalidateAll clears both clean and pending-deletion state', async () => {
    await PushCache.markClean(['a', 'b']);
    await PushCache.markDeleted(['c']);
    await PushCache.invalidateAll();
    expect(await PushCache.getCleanIds()).toEqual(new Set());
    expect(await PushCache.getPendingDeletions()).toEqual(new Set());
  });

  it('getCleanIds returns a copy, not the live set', async () => {
    await PushCache.markClean(['a']);
    const got = await PushCache.getCleanIds();
    got.add('intruder');
    expect(await PushCache.getCleanIds()).toEqual(new Set(['a']));
  });
});
