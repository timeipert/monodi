import { ORPHAN_BUNDLE_ID } from './workspace-source';

/**
 * Decisions of the pull-and-merge walk that must not lose local work. The walk compares what the remote has with
 * what is local, and calls a manuscript "in sync" (so a push may skip it) when nothing it saw differs. What it did
 * not see, because the remote lacks it, is just as different.
 */

/**
 * The visited manuscripts that have documents the remote does not have: documents added, or moved in from another
 * manuscript (a merge of two sources). They differ from GitHub and must still be pushed, however alike everything the
 * remote did show is.
 */
export function manuscriptsWithLocalOnlyDocuments(
  localDocuments: readonly { id?: string; quelle_id?: string }[],
  remoteDocumentIds: ReadonlyMap<string, ReadonlySet<string>>,
): Set<string> {
  const out = new Set<string>();
  for (const d of localDocuments) {
    const owner = d?.quelle_id || ORPHAN_BUNDLE_ID;
    const remote = remoteDocumentIds.get(owner);
    if (remote && d?.id && !remote.has(d.id)) out.add(owner);
  }
  return out;
}

/**
 * The visited manuscripts the walk may record as in sync with GitHub (so the next push skips them): those without a
 * conflict and without a local-only document.
 */
export function inSyncManuscripts(
  visited: Iterable<string>,
  conflicted: ReadonlySet<string>,
  localDocuments: readonly { id?: string; quelle_id?: string }[],
  remoteDocumentIds: ReadonlyMap<string, ReadonlySet<string>>,
): string[] {
  const localOnly = manuscriptsWithLocalOnlyDocuments(localDocuments, remoteDocumentIds);
  return Array.from(visited).filter((id) => !conflicted.has(id) && !localOnly.has(id));
}
