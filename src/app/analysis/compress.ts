/**
 * Storing JSON compactly. Results above `COMPRESS_OVER` characters are written gzip-compressed (the browser's
 * `CompressionStream`, no library); smaller ones stay as text so they remain readable in the developer tools.
 * Where `CompressionStream` is missing the text is stored as it is.
 */

export const COMPRESS_OVER = 256 * 1024;

/** A value as it lies in IndexedDB: either the JSON text or the gzip bytes of it. */
export type Packed = { gz: false; text: string } | { gz: true; bytes: ArrayBuffer; chars: number };

function streamsAvailable(): boolean {
  return typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined' && typeof Response !== 'undefined';
}

async function transform(data: Uint8Array | ArrayBuffer, stream: CompressionStream | DecompressionStream): Promise<ArrayBuffer> {
  const body = new Blob([data as BlobPart]).stream().pipeThrough(stream as unknown as ReadableWritablePair<Uint8Array, Uint8Array>);
  return new Response(body).arrayBuffer();
}

/** Serialise a value; large ones are compressed. */
export async function packJson(value: unknown): Promise<Packed> {
  const text = JSON.stringify(value);
  if (text.length <= COMPRESS_OVER || !streamsAvailable()) return { gz: false, text };
  const bytes = await transform(new TextEncoder().encode(text), new CompressionStream('gzip'));
  return { gz: true, bytes, chars: text.length };
}

/** The inverse of `packJson`. */
export async function unpackJson<T>(packed: Packed): Promise<T> {
  if (!packed.gz) return JSON.parse(packed.text) as T;
  const raw = await transform(packed.bytes, new DecompressionStream('gzip'));
  return JSON.parse(new TextDecoder().decode(raw)) as T;
}

/** Approximate stored size in bytes. */
export function packedSize(packed: Packed): number {
  return packed.gz ? packed.bytes.byteLength : packed.text.length * 2;
}
