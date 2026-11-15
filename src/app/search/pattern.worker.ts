/// <reference lib="webworker" />

/**
 * Pattern-detection worker.
 *
 * Lifts two CPU-heavy phases off the main thread:
 *
 *   1. **Duplicate detection** — every pair of `loadedDocs` is compared via
 *      Levenshtein on both their syllable text and their melody sequence.
 *      For the workspace sizes we ship to (thousands of chants) this is
 *      the most expensive piece of the analysis; running it in the worker
 *      keeps the editor UI fully responsive.
 *
 *   2. **Pattern grouping** — the prefix/suffix indexed sliding-window
 *      scan inside `computePatternGroups`.
 *
 * The worker emits incremental `progress` messages so the page can show a
 * real progress bar instead of staring at a spinner.
 */

import {
  computePatternGroups,
  getStringSimilarity,
  getSequenceSimilarity,
  buildShingleSet,
  jaccardSimilarity,
} from './pattern-algo';

/** Similarity threshold above which two documents are treated as the same
 *  chant — i.e. one is dropped from the pattern analysis. Kept in sync
 *  with the previous main-thread implementation. */
const DUP_SIMILARITY_THRESHOLD = 0.9;

/** Send a progress update back to the main thread. Coalesced to roughly
 *  one message every `EMIT_EVERY_MS` so we don't drown the page in tiny
 *  postMessages on huge libraries. */
const EMIT_EVERY_MS = 80;
let lastEmit = 0;
/** The request that is being worked on; every message back carries it so the page can drop answers of an older run. */
let currentRunId = 0;
function emitProgress(phase: string, current: number, total: number) {
  const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  if (now - lastEmit < EMIT_EVERY_MS && current !== total) return;
  lastEmit = now;
  const percent = total > 0 ? Math.round((current / total) * 100) : 0;
  postMessage({ kind: 'progress', runId: currentRunId, phase, current, total, percent });
}

addEventListener('message', ({ data }) => {
  currentRunId = (data as { runId?: number }).runId ?? 0;
  const {
    loadedDocs,
    patternType,
    patternLength,
    patternStrictness,
    patternMergeEnabled,
    patternMinMergeOverlap,
    patternDeduplicateEnabled,
  } = data as {
    loadedDocs: any[];
    patternType: 'pitch' | 'interval' | 'contour';
    patternLength: number;
    patternStrictness: 'exact' | 'fuzzy';
    patternMergeEnabled: boolean;
    patternMinMergeOverlap: number;
    patternDeduplicateEnabled: boolean;
  };

  try {
    const detectedDuplicates: { doc1: any; doc2: any; similarity: number }[] = [];
    const excludedDocIds = new Set<string>();

    // -------- 1. duplicate detection (only if it'll be used) --------
    if (patternDeduplicateEnabled && loadedDocs.length > 1) {
      lastEmit = 0;
      emitProgress('Preparing duplicate check…', 0, loadedDocs.length);

      // Pre-compute everything that's reused across pairs ONCE per doc:
      //   • normalised text,
      //   • a small 3-shingle set for a cheap Jaccard upper-bound.
      // Without this we re-join every doc's syllable list O(N) times.
      const N = loadedDocs.length;
      const texts: string[] = new Array(N);
      const textShingles: Set<string>[] = new Array(N);
      const seqShingles: Set<string>[]  = new Array(N);
      for (let i = 0; i < N; i++) {
        const t = loadedDocs[i].syllables.map((s: any) => s.text || '').join(' ').trim();
        texts[i] = t;
        textShingles[i] = buildShingleSet(t, 3);
        seqShingles[i]  = buildShingleSet(loadedDocs[i].sequence, 3);
      }

      const totalPairs = (N * (N - 1)) / 2;
      let donePairs = 0;

      for (let i = 0; i < N; i++) {
        const doc1 = loadedDocs[i];
        const t1   = texts[i];
        const ts1  = textShingles[i];
        const ss1  = seqShingles[i];

        for (let j = i + 1; j < N; j++) {
          donePairs++;
          const doc2 = loadedDocs[j];
          // The same document listed twice is not a duplicate of itself (and must not be dropped with its twin).
          if (doc1.doc.id === doc2.doc.id) continue;

          // Cheap Jaccard pre-filter. If either text or melody is too far
          // off in their shingle sets we know Levenshtein similarity will
          // also be below threshold, so we skip both expensive distance
          // computations entirely.
          if (jaccardSimilarity(ts1, textShingles[j]) < 0.4) continue;
          if (jaccardSimilarity(ss1, seqShingles[j])  < 0.4) continue;

          // Bounded similarity — bails out the instant distance > cap.
          const textSim = getStringSimilarity(t1, texts[j], DUP_SIMILARITY_THRESHOLD);
          if (textSim < DUP_SIMILARITY_THRESHOLD) continue;
          const melodySim = getSequenceSimilarity(doc1.sequence, doc2.sequence, DUP_SIMILARITY_THRESHOLD);
          if (melodySim < DUP_SIMILARITY_THRESHOLD) continue;

          detectedDuplicates.push({
            doc1,
            doc2,
            similarity: (textSim + melodySim) / 2,
          });
          excludedDocIds.add(doc2.doc.id!);
        }
        emitProgress('Detecting duplicates…', donePairs, totalPairs);
      }
      // Final flush of the dedup progress.
      emitProgress('Detecting duplicates…', totalPairs, totalPairs);
    }

    // -------- 2. pattern grouping --------
    const docsToAnalyze = patternDeduplicateEnabled
      ? loadedDocs.filter((ld: any) => !excludedDocIds.has(ld.doc.id!))
      : loadedDocs;

    emitProgress('Analyzing subsequences…', 0, docsToAnalyze.length);

    const groups = computePatternGroups(
      docsToAnalyze,
      patternType,
      patternLength,
      patternStrictness,
      patternMergeEnabled,
      patternMinMergeOverlap,
    );

    // -------- 3. build timeline documents and similarity sort --------
    const getPatternColor = (groupId: number): string => {
      const colors = [
        '#3b82f6', // blue-500
        '#10b981', // emerald-500
        '#f59e0b', // amber-500
        '#8b5cf6', // violet-500
        '#ec4899', // pink-500
        '#06b6d4', // cyan-500
        '#ef4444', // red-500
        '#84cc16', // lime-500
        '#14b8a6', // teal-500
        '#f97316', // orange-500
        '#a855f7', // purple-500
        '#6366f1'  // indigo-500
      ];
      return colors[(groupId - 1) % colors.length];
    };

    const docTotalNotes = new Map<string, number>();
    for (const ld of docsToAnalyze) {
      docTotalNotes.set(ld.doc.id!, ld.notes.length);
    }

    const timelineDocMap = new Map<string, any>();
    for (const g of groups) {
      for (const occ of g.occurrences) {
        const docId = occ.doc.id!;
        const totalNotes = docTotalNotes.get(docId) || occ.notes.length || 100;
        if (!timelineDocMap.has(docId)) {
          timelineDocMap.set(docId, {
            doc: occ.doc,
            sourceSigle: occ.sourceSigle,
            totalNotes,
            occurrences: []
          });
        }
        const startPct = (occ.startNoteIdx / totalNotes) * 100;
        const endPct = ((occ.endNoteIdx + 1) / totalNotes) * 100;
        const widthPct = endPct - startPct;
        timelineDocMap.get(docId)!.occurrences.push({
          groupId: g.id,
          occurrence: occ,
          color: getPatternColor(g.id),
          startPct,
          endPct,
          widthPct,
          length: occ.endNoteIdx - occ.startNoteIdx + 1
        });
      }
    }
    const rawTimelineDocs = Array.from(timelineDocMap.values());

    const groupTimelinesBySimilarity = (docs: any[]): any[] => {
      if (docs.length <= 2) return docs;

      const docsWithSets = docs.map(d => ({
        docRow: d,
        groups: new Set(d.occurrences.map((o: any) => o.groupId))
      }));

      const ordered: any[] = [];
      const remaining = [...docsWithSets];

      remaining.sort((a, b) => b.groups.size - a.groups.size);
      const first = remaining.shift()!;
      ordered.push(first.docRow);

      let current = first;

      while (remaining.length > 0) {
        let bestIdx = 0;
        let bestSim = -1;

        for (let i = 0; i < remaining.length; i++) {
          const candidate = remaining[i];
          
          let intersectSize = 0;
          for (const g of current.groups) {
            if (candidate.groups.has(g)) {
              intersectSize++;
            }
          }
          const unionSize = current.groups.size + candidate.groups.size - intersectSize;
          const sim = unionSize > 0 ? intersectSize / unionSize : 0;
          
          if (sim > bestSim) {
            bestSim = sim;
            bestIdx = i;
          }
        }

        current = remaining.splice(bestIdx, 1)[0];
        ordered.push(current.docRow);
      }

      return ordered;
    };

    const patternTimelineDocs = groupTimelinesBySimilarity(rawTimelineDocs);

    postMessage({
      kind: 'success',
      runId: currentRunId,
      groups,
      patternTimelineDocs,
      detectedDuplicates,
      excludedDocIds: Array.from(excludedDocIds),
    });
  } catch (err) {
    postMessage({ kind: 'error', runId: currentRunId, error: (err as Error).message });
  }
});
