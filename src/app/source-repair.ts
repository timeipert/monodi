import { v4 as uuidv4 } from 'uuid';
import type { Source } from './api.service';

/**
 * Makes what was read from storage safe to list and open. A source without an id can never be opened (its row
 * links to `/source/undefined`), and an entry that is not an object breaks every page that lists sources.
 * Entries that are not objects are dropped; a missing or duplicate id gets a fresh one. `repaired` says whether
 * anything changed, so the caller writes the result back once instead of repairing again on every start.
 */
export function repairStoredSources(stored: unknown): { sources: Source[]; repaired: boolean } {
  if (!Array.isArray(stored)) return { sources: [], repaired: false };
  const seen = new Set<string>();
  let repaired = false;
  const sources: Source[] = [];
  for (const entry of stored) {
    if (!entry || typeof entry !== 'object') { repaired = true; continue; }
    const source = entry as Source;
    if (typeof source.id !== 'string' || source.id === '' || seen.has(source.id)) {
      source.id = uuidv4();
      repaired = true;
    }
    seen.add(source.id);
    sources.push(source);
  }
  return { sources, repaired };
}
