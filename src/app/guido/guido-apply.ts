import * as localforage from 'localforage';
import type { Document, Source } from '../api.service';
import { NoteFlagDef } from '../notes/note-flags';
import { NotesStore } from '../notes-store';
import { PushCache } from '../push-cache';
import { RootContainer } from '../types/model';
import { GuidoImportResult } from './guido-import';

/**
 * What to do with a document the workspace already has (same id):
 *  - skip: keep it, add only what is new (the default; nothing of yours is touched);
 *  - replace: write the imported notes over it (its comments and apparatus are lost);
 *  - copy: import it as a new document next to the old one.
 */
export type GuidoConflictMode = 'skip' | 'replace' | 'copy';

export interface PlannedDocument {
  document: Document;
  notes: RootContainer;
  action: 'new' | 'replace' | 'copy' | 'skip';
}

export interface GuidoPlan {
  /** Sources that do not exist yet; one with the same siglum is reused, whatever its id. */
  newSources: Source[];
  documents: PlannedDocument[];
}

/** What the import would do, from the ids the workspace has. Pure: nothing is stored. */
export function planGuidoImport(
  result: GuidoImportResult, existingSources: Source[], existingDocumentIds: Iterable<string>, mode: GuidoConflictMode
): GuidoPlan {
  const taken = new Set(existingDocumentIds);
  const sourceId = new Map<string, string>();               // imported source id -> id in the workspace
  const newSources: Source[] = [];
  for (const s of result.sources) {
    const have = existingSources.find(e => e.id === s.id) ?? existingSources.find(e => e.quellensigle === s.quellensigle);
    if (have?.id) sourceId.set(s.id!, have.id);
    else { sourceId.set(s.id!, s.id!); newSources.push({ ...s }); }
  }
  const documents: PlannedDocument[] = [];
  for (const d of result.documents) {
    const quelle_id = sourceId.get(d.quelle_id) ?? d.quelle_id;
    const notes = result.notes[d.id];
    if (!taken.has(d.id)) {
      taken.add(d.id);
      documents.push({ document: { ...d, quelle_id }, notes, action: 'new' });
    } else if (mode === 'skip') {
      documents.push({ document: { ...d, quelle_id }, notes, action: 'skip' });
    } else if (mode === 'replace') {
      documents.push({ document: { ...d, quelle_id }, notes, action: 'replace' });
    } else {
      let n = 2;
      while (taken.has(`${d.id} (${n})`)) n++;
      const id = `${d.id} (${n})`;
      taken.add(id);
      documents.push({ document: { ...d, id, dokumenten_id: id, quelle_id }, notes, action: 'copy' });
    }
  }
  return { newSources, documents };
}

export interface GuidoApplyCounts {
  newSources: number;
  newDocuments: number;
  replaced: number;
  copies: number;
  skipped: number;
}

/** Writes the plan into the workspace (the stores the ZIP and CSV importers use). */
export async function applyGuidoImport(result: GuidoImportResult, mode: GuidoConflictMode): Promise<GuidoApplyCounts> {
  await NotesStore.ensureMigrated();
  const sources = (await localforage.getItem<Source[]>('monodi_sources')) || [];
  const documents = (await localforage.getItem<Document[]>('monodi_documents')) || [];
  const plan = planGuidoImport(result, sources, documents.map(d => d.id), mode);
  const counts: GuidoApplyCounts = { newSources: 0, newDocuments: 0, replaced: 0, copies: 0, skipped: 0 };

  sources.push(...plan.newSources);
  counts.newSources = plan.newSources.length;
  for (const p of plan.documents) {
    if (p.action === 'skip') { counts.skipped++; continue; }
    // the notes first: a document whose notes could not be written must not appear in the list
    await NotesStore.set(p.document.id, p.notes);
    if (p.action === 'replace') {
      const i = documents.findIndex(d => d.id === p.document.id);
      documents[i] = { ...documents[i], ...p.document, custom: { ...(documents[i].custom ?? {}), ...(p.document.custom ?? {}) } };
      counts.replaced++;
    } else {
      documents.push(p.document);
      if (p.action === 'copy') counts.copies++; else counts.newDocuments++;
    }
  }
  await localforage.setItem('monodi_sources', sources);
  await localforage.setItem('monodi_documents', documents);
  await PushCache.invalidateAll();
  return counts;
}

/** The flag definitions of a template that the settings do not have yet are added; yours are never changed. */
export function mergeNoteFlags(existing: NoteFlagDef[] | undefined, ensure: NoteFlagDef[]): { flags: NoteFlagDef[]; added: string[] } {
  const flags = [...(existing ?? [])];
  const added: string[] = [];
  for (const f of ensure) {
    if (flags.some(e => e.key === f.key)) continue;
    flags.push({ ...f });
    added.push(f.key);
  }
  return { flags, added };
}

/** Flag keys the imported notes carry but the settings (with the template's additions) do not define. */
export function undefinedFlags(result: GuidoImportResult, defined: NoteFlagDef[] | undefined): string[] {
  const have = new Set(mergeNoteFlags(defined, result.template.ensureFlags).flags.map(f => f.key));
  const used = new Set<string>();
  for (const root of Object.values(result.notes)) {
    const walk = (node: any) => {
      if (!node) return;
      if (Array.isArray(node.flags)) node.flags.forEach((k: string) => used.add(k));
      for (const k of ['children', 'spaced', 'nonSpaced', 'grouped']) if (Array.isArray(node[k])) node[k].forEach(walk);
      if (node.notes) walk(node.notes);
    };
    walk(root);
  }
  return Array.from(used).filter(k => !have.has(k)).sort();
}
