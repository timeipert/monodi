/** Metadata edits as the grid sends them: field values per document or source, applied in one pass. */

export interface MetadataPatch {
  id: string;
  /** Field name → new value. `custom.<key>` addresses a custom field. */
  fields: Record<string, string>;
}

export const CUSTOM_FIELD_PREFIX = 'custom.';

/** The fields of a document that metadata edits may change. Not `id`, not `quelle_id` (that would move the document). */
export const DOCUMENT_METADATA_FIELDS: ReadonlySet<string> = new Set([
  'dokumenten_id', 'gattung1', 'gattung2', 'festtag', 'feier', 'textinitium', 'bibliographischerverweis',
  'druckausgabe', 'zeilenstart', 'foliostart', 'kommentar', 'editionsstatus',
]);

export const SOURCE_METADATA_FIELDS: ReadonlySet<string> = new Set([
  'quellensigle', 'herkunftsregion', 'herkunftsort', 'herkunftsinstitution', 'ordenstradition', 'quellentyp',
  'bibliotheksort', 'bibliothek', 'bibliothekssignatur', 'kommentar', 'datierung',
]);

export interface PatchResult<T> {
  /** The list with the patches applied. Items without a patch are the same objects as before. */
  items: T[];
  /** Ids of the items that actually changed. */
  changedIds: string[];
  /** Patches whose id is not in the list. */
  missingIds: string[];
  /** Fields that were refused (unknown name, or one that must not be edited this way). */
  rejectedFields: number;
}

/**
 * Applies the patches in one pass over `items`: O(items + patches), however many edits there are. A patched item is
 * a new object (the old one is not mutated, so anything holding it keeps a consistent snapshot).
 */
export function applyMetadataPatches<T extends { id?: string; custom?: { [key: string]: string } }>(
  items: T[],
  patches: MetadataPatch[],
  allowed: ReadonlySet<string>,
): PatchResult<T> {
  const byId = new Map<string, MetadataPatch['fields']>();
  for (const p of patches) byId.set(p.id, { ...(byId.get(p.id) ?? {}), ...p.fields });

  const changedIds: string[] = [];
  const seen = new Set<string>();
  let rejectedFields = 0;

  const out = items.map((item) => {
    const fields = item.id !== undefined ? byId.get(item.id) : undefined;
    if (!fields) return item;
    seen.add(item.id!);
    const next: T = { ...item };
    let custom: { [key: string]: string } | undefined;
    let changed = false;
    for (const [key, value] of Object.entries(fields)) {
      if (key.startsWith(CUSTOM_FIELD_PREFIX)) {
        const ck = key.slice(CUSTOM_FIELD_PREFIX.length);
        if (!ck) { rejectedFields++; continue; }
        if ((item.custom?.[ck] ?? '') === value) continue;
        custom ??= { ...(item.custom ?? {}) };
        custom[ck] = value;
        changed = true;
      } else if (allowed.has(key)) {
        if (String((item as Record<string, unknown>)[key] ?? '') === value) continue;
        (next as Record<string, unknown>)[key] = value;
        changed = true;
      } else {
        rejectedFields++;
      }
    }
    if (custom) next.custom = custom;
    if (!changed) return item;
    changedIds.push(item.id!);
    return next;
  });

  const missingIds = Array.from(byId.keys()).filter((id) => !seen.has(id));
  return { items: out, changedIds, missingIds, rejectedFields };
}
