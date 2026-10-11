import { Document } from '../api.service';
import * as VM from '../types/model';

export interface LoadedDoc {
  doc: Document;
  sourceSigle: string;
  notes: VM.Note[];
  syllables: VM.Syllable[];
  sylIdx: number[];
  sequence: string[];
}

export interface PatternOccurrence {
  doc: Document;
  sourceSigle: string;
  startNoteIdx: number;
  endNoteIdx: number;
  matchingSyllables: VM.Syllable[];
  matchSylSet: Set<string>;
  matchNoteSet: Set<string>;
  notes: VM.Note[];
  sequenceStr: string;
}

export interface PatternGroup {
  id: number;
  representativeKey: string;
  representativePitches: string;
  occurrences: PatternOccurrence[];
  uniqueDocCount: number;
  isCompound?: boolean;
}

/**
 * Levenshtein distance — single rolling row (O(min(m,n)) memory) and
 * early-exit "is it ≤ maxDist" check via a banded computation.
 *
 * For the duplicate-detection use case we only care about
 * `dist <= floor(maxLen * (1 - threshold))`. Knowing the cap lets us
 *   (a) short-circuit on a length difference greater than the cap and
 *   (b) compute the matrix only in a `(2·cap + 1)`-wide diagonal band,
 * cutting work from O(m·n) to O(m · cap) — for our 0.9 similarity
 * threshold the band is roughly one-tenth of the row, an order of
 * magnitude faster on long sequences.
 *
 * When `maxDist` is `Infinity` (the default) we get plain full-matrix
 * behaviour, just with the single-row memory layout.
 */
export function levenshteinDistance(s1: string, s2: string, maxDist: number = Infinity): number {
  return rollingLevenshtein(s1, s2, (a, i) => a.charCodeAt(i), maxDist);
}

/** Array-of-strings Levenshtein with the same rolling + banded tricks. */
export function arrayLevenshtein(a: string[], b: string[], maxDist: number = Infinity): number {
  return rollingLevenshtein(a, b, (arr, i) => arr[i] as any as number, maxDist);
}

/**
 * Generic banded rolling-row Levenshtein. `at(seq, i)` is meant to return
 * something Strict-equality-comparable per index — either a char code (for
 * `string`s) or the array element itself (for `string[]`). Using
 * `charCodeAt` for strings avoids the per-cell `s1[i-1] === s2[j-1]` allocation
 * shape JS engines fall into and is measurably faster.
 */
function rollingLevenshtein<T>(
  a: T,
  b: T,
  at: (seq: T, i: number) => number,
  maxDist: number,
): number {
  const m = (a as any).length as number;
  const n = (b as any).length as number;

  // Length-difference lower bound. Saves the whole computation when
  // sequences are obviously too different to possibly match within
  // `maxDist`.
  if (Math.abs(m - n) > maxDist) return maxDist + 1;
  if (m === 0) return n <= maxDist ? n : maxDist + 1;
  if (n === 0) return m <= maxDist ? m : maxDist + 1;

  // Place the shorter sequence on the inner loop so the rolling row stays
  // as small as possible.
  let s: T, t: T, slen: number, tlen: number;
  if (m <= n) { s = a; t = b; slen = m; tlen = n; }
  else        { s = b; t = a; slen = n; tlen = m; }

  // Choose a band. Anything outside abs(i-j) > band is unreachable under
  // the cap, so we just don't touch those cells.
  const band = maxDist === Infinity ? slen : Math.min(slen, maxDist);

  // Single rolling row of length slen+1 (the row indexed by `j`).
  // Use Int32Array — typed arrays are faster for numeric work and reduce
  // GC pressure when the function is hot.
  const prev = new Int32Array(slen + 1);
  for (let j = 0; j <= slen; j++) prev[j] = j;

  for (let i = 1; i <= tlen; i++) {
    const ti = at(t, i - 1);
    const jStart = Math.max(1, i - band);
    const jEnd   = Math.min(slen, i + band);

    // The leftmost edge of the band: substitution / insertion only.
    let prevDiag = prev[jStart - 1];
    // Boundary cell when the band starts at column 1, otherwise the cell
    // immediately above us at jStart-1 is inside the band — handled in the
    // loop below.
    prev[jStart - 1] = jStart === 1 ? i : (maxDist + 1);

    let rowMin = Infinity;
    for (let j = jStart; j <= jEnd; j++) {
      const cost = ti === at(s, j - 1) ? 0 : 1;
      const above = prev[j];        // dp[i-1][j]
      const left  = prev[j - 1];    // dp[i][j-1] — already overwritten this row
      const diag  = prevDiag;       // dp[i-1][j-1]
      const v = Math.min(above + 1, left + 1, diag + cost);
      prevDiag = above;
      prev[j] = v;
      if (v < rowMin) rowMin = v;
    }

    // Force cells just outside the band to a "too big to matter" value so
    // they can never feed a successful path.
    if (jEnd < slen) prev[jEnd + 1] = maxDist + 1;

    // Early termination: if the smallest value in the band already
    // exceeds maxDist there's no way to finish within the cap.
    if (rowMin > maxDist) return maxDist + 1;
  }

  return prev[slen];
}

export function toPitchNames(notes: VM.Note[], withOctave: boolean): string[] {
  return notes.map(n => {
    let name = n.base.toLowerCase();
    if (n.noteType === VM.NoteType.Flat) {
      name += 'b';
    } else if (n.noteType === VM.NoteType.Sharp) {
      name += '#';
    }
    return withOctave ? `${name}${n.octave}` : name;
  });
}

export function toContour(notes: VM.Note[]): string[] {
  const result: string[] = [];
  for (let i = 1; i < notes.length; i++) {
    const p = notes[i - 1].octave * 7 + VM.baseNoteIndexes[notes[i - 1].base];
    const c = notes[i].octave * 7 + VM.baseNoteIndexes[notes[i].base];
    result.push(c > p ? 'u' : c < p ? 'd' : 'r');
  }
  return result;
}

export function toIntervals(notes: VM.Note[]): string[] {
  const result: string[] = [];
  for (let i = 1; i < notes.length; i++) {
    const p = notes[i - 1].octave * 7 + VM.baseNoteIndexes[notes[i - 1].base];
    const c = notes[i].octave * 7 + VM.baseNoteIndexes[notes[i].base];
    const diff = c - p;
    result.push(diff > 0 ? `+${diff}` : `${diff}`);
  }
  return result;
}

/**
 * Compute a string similarity in [0, 1] with an optional lower-bound short
 * circuit. If `threshold` is supplied and the two strings provably cannot
 * reach that similarity, the function returns 0 immediately — much faster
 * than computing a full Levenshtein distance just to reject the pair.
 */
export function getStringSimilarity(s1: string, s2: string, threshold: number = 0): number {
  if (!s1 || !s2) return 0;
  if (s1 === s2) return 1.0;
  const maxLen = Math.max(s1.length, s2.length);
  if (maxLen === 0) return 0;

  // Length-difference upper bound. If even keeping every shared character
  // can't reach `threshold`, skip the Levenshtein.
  const minLen = Math.min(s1.length, s2.length);
  if (minLen / maxLen < threshold) return 0;

  const maxDist = threshold > 0 ? Math.floor(maxLen * (1 - threshold)) : Infinity;
  const dist = levenshteinDistance(s1, s2, maxDist);
  if (dist > maxDist) return 0;
  return (maxLen - dist) / maxLen;
}

/** Same as {@link getStringSimilarity} but for token sequences (melodies). */
export function getSequenceSimilarity(seq1: string[], seq2: string[], threshold: number = 0): number {
  if (!seq1 || !seq2 || seq1.length === 0 || seq2.length === 0) return 0;
  const maxLen = Math.max(seq1.length, seq2.length);
  const minLen = Math.min(seq1.length, seq2.length);
  if (minLen / maxLen < threshold) return 0;

  const maxDist = threshold > 0 ? Math.floor(maxLen * (1 - threshold)) : Infinity;
  const dist = arrayLevenshtein(seq1, seq2, maxDist);
  if (dist > maxDist) return 0;
  return (maxLen - dist) / maxLen;
}

/**
 * Cheap 3-gram Jaccard upper-bound on Levenshtein similarity. Computed
 * once per document (as `buildShingleSet`) and reused for every pair.
 *
 * Useful as a pre-filter before paying for a full edit-distance: if
 * `jaccard(A, B) < threshold` then `getSequenceSimilarity(A, B) < threshold`
 * is overwhelmingly likely to also hold. Empirically this prunes >95% of
 * unrelated pairs at near-zero cost.
 */
export function buildShingleSet(tokens: string[] | string, k: number = 3): Set<string> {
  const out = new Set<string>();
  if (typeof tokens === 'string') {
    if (tokens.length < k) { out.add(tokens); return out; }
    for (let i = 0; i <= tokens.length - k; i++) out.add(tokens.substring(i, i + k));
  } else {
    if (tokens.length < k) { out.add(tokens.join('|')); return out; }
    for (let i = 0; i <= tokens.length - k; i++) out.add(tokens.slice(i, i + k).join('|'));
  }
  return out;
}

/** Jaccard similarity of two pre-computed shingle sets, in [0, 1]. */
export function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  // Iterate the smaller for cheaper intersection.
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  let inter = 0;
  for (const s of small) if (big.has(s)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

/**
 * The pairs of occurrences, as indexes into `nodes` (smaller first, in index order), of which one lies inside the
 * other in the same document. Only occurrences of one document can nest, and in start order an occurrence can only
 * hold the ones that begin before it ends, so this does not compare every occurrence of the corpus with every other.
 */
export function nestedPairs(nodes: ReadonlyArray<{ d: number; start: number; end: number }>): [number, number][] {
  const byDoc = new Map<number, number[]>();
  nodes.forEach((n, i) => {
    const list = byDoc.get(n.d);
    if (list) list.push(i); else byDoc.set(n.d, [i]);
  });

  const pairs: [number, number][] = [];
  for (const indexes of byDoc.values()) {
    // The outer one of two nested ranges always comes first: it starts earlier, or starts together and ends later.
    indexes.sort((a, b) => nodes[a].start - nodes[b].start || nodes[b].end - nodes[a].end);
    for (let x = 0; x < indexes.length; x++) {
      const outer = nodes[indexes[x]];
      for (let y = x + 1; y < indexes.length && nodes[indexes[y]].start <= outer.end; y++) {
        if (nodes[indexes[y]].end <= outer.end) {
          const i = indexes[x], j = indexes[y];
          pairs.push(i < j ? [i, j] : [j, i]);
        }
      }
    }
  }
  return pairs.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
}

/**
 * Drops the occurrences that lie inside another occurrence of the same document; of identical ranges the first
 * stays. The rest keep their order.
 */
export function dropNestedOccurrences<T extends { doc: { id: string }; startNoteIdx: number; endNoteIdx: number }>(
  occurrences: readonly T[]
): T[] {
  const byDoc = new Map<string, number[]>();
  occurrences.forEach((o, i) => {
    const list = byDoc.get(o.doc.id);
    if (list) list.push(i); else byDoc.set(o.doc.id, [i]);
  });

  const redundant = new Array<boolean>(occurrences.length).fill(false);
  for (const indexes of byDoc.values()) {
    indexes.sort((a, b) =>
      occurrences[a].startNoteIdx - occurrences[b].startNoteIdx
      || occurrences[b].endNoteIdx - occurrences[a].endNoteIdx
      || a - b);
    // In this order everything that could hold an occurrence comes before it; it is held if one of them reaches
    // at least as far.
    let reach = -Infinity;
    for (const i of indexes) {
      const end = occurrences[i].endNoteIdx;
      if (end <= reach) redundant[i] = true;
      else reach = end;
    }
  }
  return occurrences.filter((_, i) => !redundant[i]);
}

export function computePatternGroups(
  loadedDocs: LoadedDoc[],
  patternType: 'pitch' | 'interval' | 'contour',
  patternLength: number,
  patternStrictness: 'exact' | 'fuzzy',
  mergeEnabled = true,
  minMergeOverlap = 1
): PatternGroup[] {
  const windowSize = patternType === 'pitch' ? patternLength : patternLength - 1;

  interface WindowMatch {
    j1: number;
    j2: number;
  }

  const matchesByDocPair = new Map<string, Map<number, WindowMatch[]>>();

  const addMatch = (d1: number, d2: number, j1: number, j2: number) => {
    const pairKey = `${d1},${d2}`;
    if (!matchesByDocPair.has(pairKey)) {
      matchesByDocPair.set(pairKey, new Map<number, WindowMatch[]>());
    }
    const offsetMap = matchesByDocPair.get(pairKey)!;
    const offset = j2 - j1;
    if (!offsetMap.has(offset)) {
      offsetMap.set(offset, []);
    }
    offsetMap.get(offset)!.push({ j1, j2 });
  };

  if (patternStrictness === 'exact') {
    const keyMap = new Map<string, { d: number, j: number }[]>();
    for (let d = 0; d < loadedDocs.length; d++) {
      const seq = loadedDocs[d].sequence;
      for (let j = 0; j <= seq.length - windowSize; j++) {
        const key = seq.slice(j, j + windowSize).join(',');
        if (!keyMap.has(key)) keyMap.set(key, []);
        keyMap.get(key)!.push({ d, j });
      }
    }

    for (const bucket of keyMap.values()) {
      if (bucket.length < 2) continue;
      for (let i = 0; i < bucket.length; i++) {
        for (let j = i + 1; j < bucket.length; j++) {
          const o1 = bucket[i];
          const o2 = bucket[j];
          if (o1.d !== o2.d) {
            const d1 = Math.min(o1.d, o2.d);
            const d2 = Math.max(o1.d, o2.d);
            const j1 = o1.d < o2.d ? o1.j : o2.j;
            const j2 = o1.d < o2.d ? o2.j : o1.j;
            addMatch(d1, d2, j1, j2);
          }
        }
      }
    }
  } else {
    const half = Math.floor(windowSize / 2);
    const prefixMap = new Map<string, { d: number, j: number }[]>();
    const suffixMap = new Map<string, { d: number, j: number }[]>();

    for (let d = 0; d < loadedDocs.length; d++) {
      const seq = loadedDocs[d].sequence;
      for (let j = 0; j <= seq.length - windowSize; j++) {
        const win = seq.slice(j, j + windowSize);
        const pref = win.slice(0, half).join(',');
        const suff = win.slice(half).join(',');

        if (!prefixMap.has(pref)) prefixMap.set(pref, []);
        prefixMap.get(pref)!.push({ d, j });

        if (!suffixMap.has(suff)) suffixMap.set(suff, []);
        suffixMap.get(suff)!.push({ d, j });
      }
    }

    const checkedPairs = new Set<string>();

    for (let d1 = 0; d1 < loadedDocs.length; d1++) {
      const seq1 = loadedDocs[d1].sequence;
      for (let j1 = 0; j1 <= seq1.length - windowSize; j1++) {
        const w1 = seq1.slice(j1, j1 + windowSize);
        const pref = w1.slice(0, half).join(',');
        const suff = w1.slice(half).join(',');

        const candidates = new Set<{ d: number, j: number }>();
        const pList = prefixMap.get(pref) ?? [];
        const sList = suffixMap.get(suff) ?? [];
        
        for (const item of pList) {
          if (item.d > d1) candidates.add(item);
        }
        for (const item of sList) {
          if (item.d > d1) candidates.add(item);
        }

        for (const cand of candidates) {
          const pairKey = `${d1}_${j1}_${cand.d}_${cand.j}`;
          if (checkedPairs.has(pairKey)) continue;
          checkedPairs.add(pairKey);

          const w2 = loadedDocs[cand.d].sequence.slice(cand.j, cand.j + windowSize);
          // Banded + early-exit Levenshtein with cap=1 — we only care
          // whether the two windows are within edit-distance 1 of each
          // other. The full O(n²) matrix isn't necessary.
          if (arrayLevenshtein(w1, w2, 1) <= 1) {
            addMatch(d1, cand.d, j1, cand.j);
          }
        }
      }
    }
  }

  interface MergedSegment {
    d1: number;
    d2: number;
    start1: number;
    end1: number;
    start2: number;
    end2: number;
  }

  const mergedSegments: MergedSegment[] = [];

  for (const [pairKey, offsetMap] of matchesByDocPair.entries()) {
    const [d1Str, d2Str] = pairKey.split(',');
    const d1 = parseInt(d1Str, 10);
    const d2 = parseInt(d2Str, 10);

    for (const offsetMatches of offsetMap.values()) {
      if (!mergeEnabled) {
        for (const m of offsetMatches) {
          mergedSegments.push({
            d1,
            d2,
            start1: m.j1,
            end1: m.j1 + windowSize - 1,
            start2: m.j2,
            end2: m.j2 + windowSize - 1
          });
        }
        continue;
      }

      offsetMatches.sort((a, b) => a.j1 - b.j1);

      let currentSeg = {
        d1,
        d2,
        start1: offsetMatches[0].j1,
        end1: offsetMatches[0].j1 + windowSize - 1,
        start2: offsetMatches[0].j2,
        end2: offsetMatches[0].j2 + windowSize - 1
      };

      for (let k = 1; k < offsetMatches.length; k++) {
        const m = offsetMatches[k];
        if (m.j1 <= currentSeg.end1 + 1 - (minMergeOverlap - 1)) {
          currentSeg.end1 = Math.max(currentSeg.end1, m.j1 + windowSize - 1);
          currentSeg.end2 = Math.max(currentSeg.end2, m.j2 + windowSize - 1);
        } else {
          mergedSegments.push(currentSeg);
          currentSeg = {
            d1,
            d2,
            start1: m.j1,
            end1: m.j1 + windowSize - 1,
            start2: m.j2,
            end2: m.j2 + windowSize - 1
          };
        }
      }
      mergedSegments.push(currentSeg);
    }
  }

  interface OccurrenceNode {
    d: number;
    start: number;
    end: number;
    id: string;
  }

  const occurrenceMap = new Map<string, OccurrenceNode>();
  const getOrAddOccurrence = (d: number, start: number, end: number): string => {
    const id = `${d}_${start}_${end}`;
    if (!occurrenceMap.has(id)) {
      occurrenceMap.set(id, { d, start, end, id });
    }
    return id;
  };

  const links: [string, string][] = [];
  for (const seg of mergedSegments) {
    const id1 = getOrAddOccurrence(seg.d1, seg.start1, seg.end1);
    const id2 = getOrAddOccurrence(seg.d2, seg.start2, seg.end2);
    links.push([id1, id2]);
  }

  const uniqueOccurrences = Array.from(occurrenceMap.values());

  // Occurrences that lie inside one another belong together, too.
  for (const [i, j] of nestedPairs(uniqueOccurrences)) {
    links.push([uniqueOccurrences[i].id, uniqueOccurrences[j].id]);
  }

  const adj = new Map<string, string[]>();
  for (const occ of uniqueOccurrences) {
    adj.set(occ.id, []);
  }
  for (const [id1, id2] of links) {
    adj.get(id1)!.push(id2);
    adj.get(id2)!.push(id1);
  }

  const visitedOccs = new Set<string>();
  const components: string[][] = [];

  for (const occ of uniqueOccurrences) {
    if (visitedOccs.has(occ.id)) continue;

    const comp: string[] = [];
    const queue: string[] = [occ.id];
    visitedOccs.add(occ.id);

    // `shift()` on a long array moves every element; walk it with a head index instead.
    for (let head = 0; head < queue.length; head++) {
      const curr = queue[head];
      comp.push(curr);

      for (const neighbor of adj.get(curr)!) {
        if (!visitedOccs.has(neighbor)) {
          visitedOccs.add(neighbor);
          queue.push(neighbor);
        }
      }
    }

    const distinctDocs = new Set(comp.map(id => occurrenceMap.get(id)!.d));
    if (distinctDocs.size >= 2) {
      components.push(comp);
    }
  }

  const groups: PatternGroup[] = [];
  let groupIdCounter = 1;

  for (const comp of components) {
    const occurrences: PatternOccurrence[] = [];
    
    for (const occId of comp) {
      const node = occurrenceMap.get(occId)!;
      const docData = loadedDocs[node.d];
      
      const startNoteIdx = node.start;
      const endNoteIdx = patternType === 'pitch' ? node.end : node.end + 1;

      const notesSlice = docData.notes.slice(startNoteIdx, endNoteIdx + 1);

      const matchingSyllableIndices: number[] = [];
      const matchSylSet = new Set<string>();
      for (let ni = startNoteIdx; ni <= endNoteIdx && ni < docData.sylIdx.length; ni++) {
        const sIdx = docData.sylIdx[ni];
        matchingSyllableIndices.push(sIdx);
        const syl = docData.syllables[sIdx];
        if (syl?.uuid) matchSylSet.add(syl.uuid);
      }

      const matchNoteSet = new Set<string>();
      for (const note of notesSlice) {
        if (note?.uuid) matchNoteSet.add(note.uuid);
      }

      const matchSylMin = Math.min(...matchingSyllableIndices);
      const matchSylMax = Math.max(...matchingSyllableIndices);

      const ctxFirst = Math.max(0, matchSylMin - 2);
      const ctxLast  = Math.min(docData.syllables.length - 1, matchSylMax + 2);
      const contextSyllables = docData.syllables.slice(ctxFirst, ctxLast + 1);

      const seqStart = startNoteIdx;
      const seqEnd = patternType === 'pitch' ? endNoteIdx : endNoteIdx - 1;
      const occurrenceSeq = docData.sequence.slice(seqStart, seqEnd + 1);
      const seqKey = occurrenceSeq.join(',');

      occurrences.push({
        doc: docData.doc,
        sourceSigle: docData.sourceSigle,
        startNoteIdx,
        endNoteIdx,
        matchingSyllables: contextSyllables,
        matchSylSet,
        matchNoteSet,
        notes: notesSlice,
        sequenceStr: seqKey
      });
    }

    const uniqueOccsList = dropNestedOccurrences(occurrences);

    uniqueOccsList.sort((a, b) => {
      const sigleComp = a.sourceSigle.localeCompare(b.sourceSigle);
      if (sigleComp !== 0) return sigleComp;
      return (a.doc.textinitium || '').localeCompare(b.doc.textinitium || '');
    });

    let longestOcc = uniqueOccsList[0];
    for (const occ of uniqueOccsList) {
      if (occ.notes.length > longestOcc.notes.length) {
        longestOcc = occ;
      }
    }
    const bestKey = longestOcc.sequenceStr;
    const uniqueDocs = new Set(uniqueOccsList.map(o => o.doc.id));

    let formattedRepKey = '';
    const repArray = bestKey.split(',');
    if (patternType === 'pitch') {
      formattedRepKey = repArray.join(' - ').toUpperCase();
    } else if (patternType === 'interval') {
      formattedRepKey = repArray.join(', ');
    } else if (patternType === 'contour') {
      formattedRepKey = repArray.map(char => {
        if (char === 'u') return '↗';
        if (char === 'd') return '↘';
        if (char === 'r') return '→';
        return char;
      }).join(' ');
    }

    const pitchNames = toPitchNames(longestOcc.notes, false);
    const representativePitches = pitchNames.join(' - ').toUpperCase();
    
    const isCompound = longestOcc.notes.length > patternLength;

    groups.push({
      id: groupIdCounter++,
      representativeKey: formattedRepKey,
      representativePitches,
      occurrences: uniqueOccsList,
      uniqueDocCount: uniqueDocs.size,
      isCompound
    });
  }

  groups.sort((a, b) => {
    if (b.uniqueDocCount !== a.uniqueDocCount) {
      return b.uniqueDocCount - a.uniqueDocCount;
    }
    return b.occurrences.length - a.occurrences.length;
  });

  return groups;
}
