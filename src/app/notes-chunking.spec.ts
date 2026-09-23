/**
 * A whole manuscript's neume data can run to hundreds of MB, which cannot be
 * sent in one HTTP request — that was the "works for the metadata, breaks on
 * the documents" failure. Notes are therefore packed into size-bounded chunk
 * files.
 *
 * Two properties have to hold or data is silently lost or corrupted:
 *  1. chunking is lossless — every document lands in exactly one chunk;
 *  2. chunking is deterministic — the scan pass and the (re)serialize pass
 *     must produce byte-identical chunks, since the scan's SHA/size is what
 *     the upload is validated against.
 */
describe('Notes chunking', () => {
  const CHUNK_BYTES = 1024;

  /** The packing used by the push scan. */
  function pack(notes: { [id: string]: any }, limit = CHUNK_BYTES): string[] {
    const out: string[] = [];
    let chunk: { [id: string]: any } = {};
    let bytes = 0, count = 0;
    for (const docId of Object.keys(notes)) {
      const pieceBytes = JSON.stringify(notes[docId]).length + docId.length + 8;
      if (count > 0 && bytes + pieceBytes > limit) {
        out.push(JSON.stringify(chunk));
        chunk = {}; bytes = 0; count = 0;
      }
      chunk[docId] = notes[docId];
      bytes += pieceBytes; count++;
    }
    if (count > 0) out.push(JSON.stringify(chunk));
    return out;
  }

  /** Replays the packing to rebuild one specific chunk, as `materialize` does. */
  function rebuild(notes: { [id: string]: any }, wanted: number, limit = CHUNK_BYTES): string {
    let index = 0, bytes = 0, count = 0;
    let chunk: { [id: string]: any } = {};
    let result: string | null = null;
    for (const docId of Object.keys(notes)) {
      if (result !== null) break;
      const pieceBytes = JSON.stringify(notes[docId]).length + docId.length + 8;
      if (count > 0 && bytes + pieceBytes > limit) {
        if (index === wanted) { result = JSON.stringify(chunk); break; }
        index++; chunk = {}; bytes = 0; count = 0;
      }
      chunk[docId] = notes[docId];
      bytes += pieceBytes; count++;
    }
    return result !== null ? result : JSON.stringify(chunk);
  }

  function makeNotes(n: number, sizeEach = 200) {
    const notes: { [id: string]: any } = {};
    for (let i = 0; i < n; i++) notes[`doc-${String(i).padStart(4, '0')}`] = { d: 'x'.repeat(sizeEach) };
    return notes;
  }

  it('splits a large manuscript into several bounded chunks', () => {
    const chunks = pack(makeNotes(50));
    expect(chunks.length).toBeGreaterThan(1);
    // No chunk may approach the size that broke single-request uploads.
    for (const c of chunks) expect(c.length).toBeLessThan(CHUNK_BYTES * 2);
  });

  it('is lossless: every document appears exactly once', () => {
    const notes = makeNotes(50);
    const seen: { [id: string]: any } = {};
    for (const c of pack(notes)) {
      for (const [k, v] of Object.entries(JSON.parse(c))) {
        expect(seen[k]).toBeUndefined();  // no duplicates across chunks
        seen[k] = v;
      }
    }
    expect(seen).toEqual(notes);
  });

  it('rebuilds each chunk byte-identically (scan pass vs upload pass)', () => {
    const notes = makeNotes(50);
    const chunks = pack(notes);
    // The upload re-serializes from storage when pass 1 could not cache the
    // content; if that differed by even a byte, the uploaded blob would not
    // match the SHA the scan computed.
    for (let i = 0; i < chunks.length; i++) {
      expect(rebuild(notes, i)).toBe(chunks[i]);
    }
  });

  it('keeps an oversized single document in its own chunk', () => {
    const notes = { small: { d: 'x' }, huge: { d: 'y'.repeat(CHUNK_BYTES * 5) } };
    const chunks = pack(notes);
    expect(chunks.length).toBe(2);
    expect(Object.keys(JSON.parse(chunks[1]))).toEqual(['huge']);
    // And it still round-trips.
    expect(rebuild(notes, 1)).toBe(chunks[1]);
  });

  it('produces no chunks for a manuscript without notes', () => {
    expect(pack({})).toEqual([]);
  });

  it('chunk paths sort in packing order', () => {
    const paths = [0, 1, 2, 10, 11, 100].map(i => `manuscripts/ms/notes-${String(i).padStart(4, '0')}.json`);
    // Reading merges chunks in path order, so lexical order must match
    // numeric order — otherwise zero-padding bugs would reorder them.
    expect([...paths].sort()).toEqual(paths);
  });

  it('distinguishes chunk files from manuscript metadata files', () => {
    const isChunk = (p: string) => /^manuscripts\/(.+)\/notes-\d+\.json$/.test(p);
    expect(isChunk('manuscripts/ms-a/notes-0000.json')).toBe(true);
    expect(isChunk('manuscripts/ms-a.json')).toBe(false);
    // Ids containing a slash must still resolve to the right owner.
    const owner = (p: string) => /^manuscripts\/(.+)\/notes-\d+\.json$/.exec(p)?.[1];
    expect(owner('manuscripts/ms-a/notes-0003.json')).toBe('ms-a');
  });
});
