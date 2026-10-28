/**
 * Annotations in the `meta.json` of a source inside a Monodi ZIP.
 *
 * A source record may carry the neume table rows (`equivalents`), the line regions (`annotationRegions`) and the snippets
 * (`annotationItems`) of the notation documentation, in the shapes of `Source` itself. The ZIP import used to leave them out of
 * the source it built, so a ZIP made with them lost them silently. They are merged here with the rules of the annotation
 * exchange (`annotation-exchange.ts`): by id, the file's geometry and names win, nothing that is already in the workspace is
 * deleted, the manifest address is taken only when the source has none.
 *
 * Pure functions on plain data (the import component calls them).
 */
import { Source } from './api.service';
import { ExchangeSource, applyPlan, planChangesAnything, planMerge } from './annotation-exchange';

/** Whether a `meta.json` carries any of the three annotation lists (non-empty). */
export function hasMetaAnnotations(meta: any): boolean {
  return !!meta && ['equivalents', 'annotationRegions', 'annotationItems'].some(k => Array.isArray(meta[k]) && meta[k].length > 0);
}

/**
 * Merges the annotation lists of `meta` into `target` (changed in place). Returns what was added, in words ('' if nothing),
 * for the import summary.
 */
export function mergeMetaAnnotations(target: Source, meta: any): string {
  if (!hasMetaAnnotations(meta)) return '';
  const list = (k: string) => (Array.isArray(meta[k]) ? meta[k] : []);
  const incoming: ExchangeSource = {
    id: target.id,
    quellensigle: target.quellensigle,
    equivalents: list('equivalents'),
    annotationRegions: list('annotationRegions'),
    annotationItems: list('annotationItems'),
  };
  const plan = planMerge(target, incoming);
  if (!planChangesAnything(plan)) return '';
  Object.assign(target, applyPlan(target, plan));
  const c = plan.counts;
  return `${c.regionsNew} line regions, ${c.itemsNew} snippets, ${c.equivalentsNew} table rows`;
}
