import * as localforage from 'localforage';

/**
 * Pictures of line regions that have no IIIF page to be cut from (a Neumen-Editor documentation made from
 * screenshots). They are not part of the source, which is pushed to GitHub: they stay on this computer, one row
 * per source, and are only read when the notation documentation is printed. A workspace backup does not
 * carry them; importing the documentation again brings them back.
 */
const keyOf = (sourceId: string): string => `monodi_notation_strip_images_${sourceId}`;

/** The pictures kept for a source, by region id (data URLs); none if there are none or storage cannot be read. */
export async function loadStripImages(sourceId: string | undefined): Promise<{ [regionId: string]: string }> {
  if (!sourceId) return {};
  try {
    return (await localforage.getItem<{ [regionId: string]: string }>(keyOf(sourceId))) ?? {};
  } catch {
    return {};
  }
}

/** Keeps pictures next to the ones already kept; a picture of the same region is replaced. Throws if storage refuses. */
export async function saveStripImages(sourceId: string, images: { [regionId: string]: string }): Promise<void> {
  const kept = await loadStripImages(sourceId);
  await localforage.setItem(keyOf(sourceId), { ...kept, ...images });
}
