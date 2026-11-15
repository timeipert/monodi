/**
 * The analysis library of Monodi-Zero: methods that read a corpus of chants (pitches, syllables, text, metadata) and
 * return plain-data results. No Angular, no DOM, no storage: the app reads the documents, calls `runMethod` (in a web
 * worker) and stores the result under the fingerprint of the documents it read. Import as `@monodi/core/analysis`.
 */
export * from './corpus';
export * from './features';
export * from './fingerprint';
export * from './result';
export * from './figure';
export * from './stats';
export * from './tokens';
export * from './grouping';
export * from './filters';
export * from './cluster';
export * from './segmentation';
export * from './segments';
export * from './notation';
export * from './search';
export * from './registry';
export { matrixToCsv, matrixToNexus } from './methods/stylometry';
export { estimateMode, tenorOf } from './methods/descriptive';
export type { ModeEstimate } from './methods/descriptive';
export { chantAxis, syllableCount } from './methods/chantdigger';
export { tableToCsv } from './csv';
