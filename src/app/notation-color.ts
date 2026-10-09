/** Default and validation for the notation colour setting (dark grey, not pure black). */
export const DEFAULT_NOTATION_COLOR = '#333333';

export function sanitizeNotationColor(v: unknown): string {
  return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v.trim()) ? v.trim().toLowerCase() : DEFAULT_NOTATION_COLOR;
}
