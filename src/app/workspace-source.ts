import * as localforage from 'localforage';
import { NotesStore } from './notes-store';
import { Bundle, ManuscriptSource } from './github.service';

/** Bundle id used for documents/notes that have no owning manuscript. */
export const ORPHAN_BUNDLE_ID = '__unassigned__';

/**
 * Streams the local workspace to the sync layer one manuscript at a time.
 *
 * The whole point is to never hold the entire workspace in memory. Sources
 * and document *metadata* are small and loaded once; the heavy part — each
 * document's notes — is fetched per document, only while the manuscript that
 * owns it is being serialized, and released again immediately after.
 *
 * This replaces the old "load everything via NotesStore.getAll(), then
 * JSON.stringify all of it into an array" approach, which held the raw
 * objects, a pretty-printed string copy and a base64 copy of a multi-GB
 * workspace alive at the same time and reliably killed the browser tab.
 */
export class LocalWorkspaceSource implements ManuscriptSource {
  private sources: any[] | null = null;
  private docsByManuscript: Map<string, any[]> | null = null;
  private knownDocIds: Set<string> | null = null;

  /** Loads the small metadata index (sources + document records), once. */
  private async index(): Promise<void> {
    if (this.docsByManuscript) return;

    const sources = await localforage.getItem<any[]>('monodi_sources') || [];
    const documents = await localforage.getItem<any[]>('monodi_documents') || [];

    const map = new Map<string, any[]>();
    for (const s of sources) {
      if (s?.id && !map.has(s.id)) map.set(s.id, []);
    }
    const known = new Set<string>();
    for (const d of documents) {
      const key = d?.quelle_id || ORPHAN_BUNDLE_ID;
      let list = map.get(key);
      if (!list) { list = []; map.set(key, list); }
      list.push(d);
      if (d?.id) known.add(d.id);
    }

    this.sources = sources;
    this.docsByManuscript = map;
    this.knownDocIds = known;
  }

  async listIds(): Promise<string[]> {
    await this.index();
    const ids = new Set<string>(this.docsByManuscript!.keys());

    // Notes whose document no longer exists still need a home, otherwise a
    // push would silently drop them.
    const noteIds = await NotesStore.getIndex();
    if (noteIds.some(id => !this.knownDocIds!.has(id))) ids.add(ORPHAN_BUNDLE_ID);

    return Array.from(ids);
  }

  async load(id: string): Promise<Bundle> {
    await this.index();

    const source = (this.sources || []).find(s => s?.id === id) || null;
    const documents = this.docsByManuscript!.get(id) || [];

    const notes: { [docId: string]: any } = {};
    for (const d of documents) {
      if (!d?.id) continue;
      const n = await NotesStore.get(d.id);
      if (n !== null && n !== undefined) notes[d.id] = n;
    }

    if (id === ORPHAN_BUNDLE_ID) {
      for (const noteId of await NotesStore.getIndex()) {
        if (this.knownDocIds!.has(noteId)) continue;
        const n = await NotesStore.get(noteId);
        if (n !== null && n !== undefined) notes[noteId] = n;
      }
    }

    return { source, documents, notes };
  }

  async loadSettings(): Promise<any> {
    return await localforage.getItem<any>('monodi_settings') || null;
  }
}
