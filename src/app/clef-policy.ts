/**
 * When is the automatic G-clef drawn at the start of a staff?
 *
 *  - `document-start` (default, like the printed edition): only at the very start
 *    of the document's chant.
 *  - `every-line`: at the start of every manuscript line (`ZeileContainer`).
 *  - `every-break`: additionally after every manuscript line break
 *    (`LineChange`) and at the start of every automatically wrapped system.
 */
export type ClefDisplayMode = 'document-start' | 'every-line' | 'every-break';

export const CLEF_DISPLAY_MODES: readonly ClefDisplayMode[] = ['document-start', 'every-line', 'every-break'];
export const DEFAULT_CLEF_DISPLAY_MODE: ClefDisplayMode = 'document-start';

export function sanitizeClefDisplayMode(v: unknown): ClefDisplayMode {
  return CLEF_DISPLAY_MODES.includes(v as ClefDisplayMode) ? (v as ClefDisplayMode) : DEFAULT_CLEF_DISPLAY_MODE;
}

export interface ClefContext {
  /** First element of the whole document. */
  firstInDocument: boolean;
  /** First element of its ZeileContainer. */
  firstInZeile: boolean;
  /** Directly follows a LineChange marker. */
  afterLineChange: boolean;
  /** First element of an automatically wrapped system (PDF only). */
  wrapStart: boolean;
}

export function shouldShowClef(mode: ClefDisplayMode, ctx: ClefContext): boolean {
  if (ctx.firstInDocument) return true;
  switch (mode) {
    case 'every-break':
      return ctx.firstInZeile || ctx.afterLineChange || ctx.wrapStart;
    case 'every-line':
      return ctx.firstInZeile;
    default:
      return false;
  }
}
