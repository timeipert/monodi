/**
 * The catalogue of analysis methods and the entry point that runs one on a corpus.
 */
import type { Corpus } from './corpus';
import { collocationsMethod, keynessMethod, ngramsMethod } from './methods/ngrams';
import { overviewMethod, tonalProfileMethod } from './methods/descriptive';
import { axisMethod, bridgesMethod, modelsMethod, segmentsMethod, syllableGroupsMethod } from './methods/chantdigger';
import { sourceDistanceMethod, variantsMethod } from './methods/stylometry';
import { normalizeParams } from './result';
import type { AnalysisMethod, MethodGroup, MethodResult, ParamValues, RunIo } from './result';

/** Every method, in the order the workbench lists them within a group. */
export const METHODS: readonly AnalysisMethod[] = [
  overviewMethod,
  tonalProfileMethod,
  variantsMethod,
  ngramsMethod,
  keynessMethod,
  collocationsMethod,
  sourceDistanceMethod,
  segmentsMethod,
  bridgesMethod,
  modelsMethod,
  syllableGroupsMethod,
  axisMethod,
];

export const METHOD_GROUPS: { id: MethodGroup; title: string; blurb: string }[] = [
  { id: 'overview', title: 'Overview', blurb: 'What the corpus looks like.' },
  { id: 'melody', title: 'Melody', blurb: 'Tonal range, mode, variants of one chant.' },
  { id: 'corpus', title: 'Corpus linguistics and stylometry', blurb: 'Frequencies, keyness, collocations, distance between sources.' },
  { id: 'chantdigger', title: 'ChantDigger methods', blurb: 'Syllable segments, bridges, models, equal length, axis (Max Haas, 2014).' },
];

export function getMethod(id: string): AnalysisMethod | undefined {
  return METHODS.find((m) => m.id === id);
}

/** Run a method with parameters that are completed and clamped first. Returns the result and the parameters used. */
export function runMethod(id: string, corpus: Corpus, params: ParamValues | undefined, io: RunIo): { result: MethodResult; params: ParamValues } {
  const method = getMethod(id);
  if (!method) throw new Error(`Unknown analysis method: ${id}`);
  const used = normalizeParams(method, params);
  return { result: method.run(corpus, used, io), params: used };
}
