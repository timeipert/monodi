import * as localforage from 'localforage';
import { NotesStore } from './notes-store';

describe('NotesStore Tests', () => {
  let mockStore: Map<string, any>;

  beforeEach(() => {
    mockStore = new Map<string, any>();
    
    spyOn(localforage, 'getItem').and.callFake(async (key: string) => {
      return mockStore.has(key) ? mockStore.get(key) : null;
    });

    spyOn(localforage, 'setItem').and.callFake(async (key: string, value: any) => {
      mockStore.set(key, value);
      return value;
    });

    spyOn(localforage, 'removeItem').and.callFake(async (key: string) => {
      mockStore.delete(key);
    });

    // Reset the static migration promise on NotesStore
    (NotesStore as any).migrationPromise = null;
  });

  it('revision counts the writes, so caches derived from the notes can notice a change', async () => {
    const r0 = NotesStore.revision;
    await NotesStore.set('doc-1', { a: 1 });
    await NotesStore.merge({ 'doc-2': { b: 2 } });
    await NotesStore.removeMany(['doc-2']);
    await NotesStore.remove('doc-1');
    await NotesStore.replaceAll({});
    expect(NotesStore.revision).toBe(r0 + 5);
    await NotesStore.get('doc-1');
    expect(NotesStore.revision).toBe(r0 + 5); // a read changes nothing
  });

  it('set() then get() round-trips a value and adds the id to the index exactly once', async () => {
    await NotesStore.set('doc-1', { notes: 'hello' });
    const val = await NotesStore.get('doc-1');
    expect(val).toEqual({ notes: 'hello' });

    const index = await NotesStore.getIndex();
    expect(index).toEqual(['doc-1']);

    // calling set twice does not duplicate the index entry
    await NotesStore.set('doc-1', { notes: 'hello2' });
    const index2 = await NotesStore.getIndex();
    expect(index2).toEqual(['doc-1']);
  });

  it('remove() deletes the row and removes the id from the index', async () => {
    await NotesStore.set('doc-1', { notes: 'hello' });
    await NotesStore.remove('doc-1');
    const val = await NotesStore.get('doc-1');
    expect(val).toBeNull();

    const index = await NotesStore.getIndex();
    expect(index).toEqual([]);
  });

  it('removeMany() removes multiple rows and their index entries', async () => {
    await NotesStore.set('doc-1', { notes: 'hello 1' });
    await NotesStore.set('doc-2', { notes: 'hello 2' });
    await NotesStore.set('doc-3', { notes: 'hello 3' });

    await NotesStore.removeMany(['doc-1', 'doc-3']);

    expect(await NotesStore.get('doc-1')).toBeNull();
    expect(await NotesStore.get('doc-2')).toEqual({ notes: 'hello 2' });
    expect(await NotesStore.get('doc-3')).toBeNull();

    const index = await NotesStore.getIndex();
    expect(index).toEqual(['doc-2']);
  });

  it('getIndex() returns [] on empty storage', async () => {
    const index = await NotesStore.getIndex();
    expect(index).toEqual([]);
  });

  it('getAll() returns a dict of all stored docs', async () => {
    await NotesStore.set('doc-1', { notes: 'hello 1' });
    await NotesStore.set('doc-2', { notes: 'hello 2' });

    const all = await NotesStore.getAll();
    expect(all).toEqual({
      'doc-1': { notes: 'hello 1' },
      'doc-2': { notes: 'hello 2' }
    });
  });

  it('Migration: splits legacy blob into per-doc rows, writes index, removes legacy key, sets flag', async () => {
    mockStore.set('monodi_notes', {
      a: { note: 'A' },
      b: { note: 'B' }
    });

    const val = await NotesStore.get('a');
    expect(val).toEqual({ note: 'A' });

    // Check index
    const index = await NotesStore.getIndex();
    expect(index).toEqual(['a', 'b']);

    // Check individual items in mockStore
    expect(mockStore.get('monodi_notes_doc_a')).toEqual({ note: 'A' });
    expect(mockStore.get('monodi_notes_doc_b')).toEqual({ note: 'B' });

    // Check legacy key is deleted
    expect(mockStore.has('monodi_notes')).toBeFalse();

    // Check migration flag
    expect(mockStore.get('monodi_notes_migrated_v1')).toBeTrue();
  });

  it('replaceAll() replaces contents and updates the index', async () => {
    await NotesStore.set('doc-1', { notes: '1' });
    await NotesStore.set('doc-2', { notes: '2' });

    await NotesStore.replaceAll({
      'doc-2': { notes: '2 updated' },
      'doc-3': { notes: '3' }
    });

    expect(await NotesStore.get('doc-1')).toBeNull();
    expect(await NotesStore.get('doc-2')).toEqual({ notes: '2 updated' });
    expect(await NotesStore.get('doc-3')).toEqual({ notes: '3' });

    const index = await NotesStore.getIndex();
    expect(index).toEqual(['doc-2', 'doc-3']);
  });
});
