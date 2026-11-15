import * as localforage from 'localforage';
import { SYNC_EXCLUDED_KEY, SyncExclusions } from './sync-exclusions';

describe('SyncExclusions', () => {
  beforeEach(async () => { await localforage.removeItem(SYNC_EXCLUDED_KEY); });
  afterEach(async () => { await localforage.removeItem(SYNC_EXCLUDED_KEY); });

  it('starts empty and keeps what is added, without repeats', async () => {
    expect((await SyncExclusions.getAll()).size).toBe(0);
    await SyncExclusions.add(['a', 'b']);
    await SyncExclusions.add(['b', 'c', '']);
    expect(Array.from(await SyncExclusions.getAll()).sort()).toEqual(['a', 'b', 'c']);
    expect(await SyncExclusions.has('b')).toBeTrue();
    expect(await SyncExclusions.has('z')).toBeFalse();
  });

  it('removes sources and leaves the others', async () => {
    await SyncExclusions.add(['a', 'b']);
    await SyncExclusions.remove(['a', 'not there']);
    expect(Array.from(await SyncExclusions.getAll())).toEqual(['b']);
  });

  it('reads a stored value that is not a list of texts as empty', async () => {
    await localforage.setItem(SYNC_EXCLUDED_KEY, { nonsense: true });
    expect((await SyncExclusions.getAll()).size).toBe(0);
    await localforage.setItem(SYNC_EXCLUDED_KEY, ['ok', 5, null]);
    expect(Array.from(await SyncExclusions.getAll())).toEqual(['ok']);
  });
});
