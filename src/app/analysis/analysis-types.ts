import type { CorpusFilters, MethodResult, ParamValues } from '@monodi/core/analysis';

/**
 * What is stored for a saved analysis (page *Analysis*). Description: `documentation/ANALYSIS-WORKBENCH.md`.
 *
 * An analysis is a named list of documents (the corpus), the methods chosen for it with their parameters, and one
 * stored result per method. The result carries the fingerprint of the documents it was computed from, so opening an
 * analysis shows the stored results at once and a later check can tell whether they are still valid.
 */

/** Where the documents of an analysis came from; kept for the provenance line and for explaining the corpus. */
export type CorpusOrigin = 'selection' | 'hits' | 'all' | 'import' | 'manual';

export interface CorpusSpec {
  /** Document ids, sorted. The analysis never re-evaluates a filter: this list is the corpus. */
  docIds: string[];
  origin: CorpusOrigin;
  /** A short description for people: "selection of 120 documents", "hits of the melody search D F G". */
  label: string;
}

/** A method chosen for an analysis, with its parameters (completed and clamped when it runs). */
export interface MethodChoice {
  id: string;
  params: ParamValues;
}

export const ANALYSIS_FORMAT = 'monodi-analysis';
export const ANALYSIS_FORMAT_VERSION = 1;

export interface AnalysisDefinition {
  id: string;
  name: string;
  /** A free note of the user. */
  note: string;
  createdAt: number;
  updatedAt: number;
  corpus: CorpusSpec;
  methods: MethodChoice[];
  /** Chants and words left out of every method (see `@monodi/core/analysis` `filters`); absent: nothing is left out. */
  filters?: CorpusFilters;
}

/** One line of the list of saved analyses; kept in one small row so the list opens without reading the results. */
export interface AnalysisSummary {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  docCount: number;
  corpusLabel: string;
  methodIds: string[];
  /** Methods that have a stored result. */
  resultIds: string[];
  /** Stored size of each result in bytes, by method id. */
  resultBytes: Record<string, number>;
  /** Approximate size of the stored definition and results in bytes. */
  bytes: number;
}

/** The result of one method together with what is needed to judge later whether it is still valid. */
export interface ResultRecord {
  methodId: string;
  /** `AnalysisMethod.version` when it was computed. */
  methodVersion: number;
  /** The parameters as they were used (completed and clamped). */
  params: ParamValues;
  /** `methodFingerprint`: method, version, parameters, filters and the documents as far as the method reads them. */
  fingerprint: string;
  /** `filtersKey` of the filters in force when it was computed (`''`: none). */
  filtersKey?: string;
  /** Per document, the part of its digests the method reads (`usedDigests`). */
  digests: Record<string, string>;
  computedAt: number;
  durationMs: number;
  /** Size of the serialised result in bytes. */
  bytes: number;
  /** True when the result was cut to stay under the size limit. */
  truncated: boolean;
  result: MethodResult;
}

/** The state of one method of an analysis against the documents as they are. */
export type MethodStatus =
  | { state: 'none' }
  | { state: 'running'; done: number; total: number }
  | { state: 'fresh' }
  /** A result exists; whether the documents changed since is not known (the check has not run). */
  | { state: 'unchecked' }
  | { state: 'stale'; reason: string; changed: number; removed: number }
  | { state: 'error'; message: string };

/** The file written by "Export analysis". */
export interface AnalysisExport {
  format: typeof ANALYSIS_FORMAT;
  version: number;
  exportedAt: number;
  analysis: AnalysisDefinition;
  results: ResultRecord[];
}
