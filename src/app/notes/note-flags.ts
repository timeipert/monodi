/**
 * User-defined note flags (e.g. a virga): a single uppercase letter on a note,
 * typed as `g[V]` and written as a suffix in pattern codes (`*uV`), as in the
 * Neume Viewer's custom signs. A flag can be mapped to MEI attributes and drawn
 * as an abbreviation or as an SVG outline. Angular-free so the print renderer can use it.
 */
export interface NoteFlagDef {
  /** One uppercase letter, not one of RESERVED_FLAG_KEYS. */
  key: string;
  label: string;
  /** Short text drawn above the note when there is no SVG outline. */
  abbrev: string;
  /** Outline (SVG path `d`) and its viewBox "minX minY w h"; when set it is drawn instead of `abbrev`. */
  svgPath?: string;
  viewBox?: string;
  /** Attributes added to the note's MEI element. */
  mei?: Record<string, string>;
  /** Replaces the note's MEI element name (e.g. `nc` → `virga`). */
  meiTag?: string;
}

/** Suffixes already used by note types in pattern codes. */
export const RESERVED_FLAG_KEYS = ['L', 'Q', 'O', 'S', 'A', 'D'];

export function validateFlagKey(key: string, defs: NoteFlagDef[], own?: NoteFlagDef): string | null {
  if (!/^[A-Z]$/.test(key)) return 'The key must be one uppercase letter.';
  if (RESERVED_FLAG_KEYS.includes(key)) return `"${key}" is reserved for a note type.`;
  if (defs.some(d => d !== own && d.key === key)) return `"${key}" is already used.`;
  return null;
}

/** Drops malformed definitions (settings come from user-editable storage). */
export function sanitizeNoteFlags(raw: unknown): NoteFlagDef[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: NoteFlagDef[] = [];
  for (const r of raw as any[]) {
    if (!r || typeof r.key !== 'string' || !/^[A-Z]$/.test(r.key) || RESERVED_FLAG_KEYS.includes(r.key) || seen.has(r.key)) continue;
    seen.add(r.key);
    out.push({
      key: r.key,
      label: String(r.label ?? r.key),
      abbrev: String(r.abbrev ?? r.key).slice(0, 3),
      svgPath: typeof r.svgPath === 'string' && r.svgPath ? r.svgPath : undefined,
      viewBox: typeof r.viewBox === 'string' && r.viewBox ? r.viewBox : undefined,
      mei: r.mei && typeof r.mei === 'object' ? { ...r.mei } : undefined,
      meiTag: typeof r.meiTag === 'string' && r.meiTag ? r.meiTag : undefined
    });
  }
  return out;
}

let defs: NoteFlagDef[] = [];

/** Set from the project settings whenever they are loaded or saved. */
export function setNoteFlagDefs(next: NoteFlagDef[] | undefined): void {
  defs = next ?? [];
}

export function getNoteFlagDefs(): NoteFlagDef[] {
  return defs;
}

/** Definitions of the flags set on a note, in the note's order; unknown keys are skipped. */
export function flagDefsOf(flags: string[] | undefined): NoteFlagDef[] {
  if (!flags || flags.length === 0) return [];
  return flags.map(k => defs.find(d => d.key === k)).filter((d): d is NoteFlagDef => !!d);
}

/**
 * Reads an uploaded/pasted SVG: all `<path d>` concatenated plus the viewBox
 * (falling back to width/height). Only paths are supported.
 */
export function parseSvgToGlyph(svg: string): { viewBox: string; d: string } | null {
  const paths: string[] = [];
  const re = /<path\b[^>]*?\sd\s*=\s*"([^"]+)"/gi;
  for (let m = re.exec(svg); m; m = re.exec(svg)) paths.push(m[1]);
  if (paths.length === 0) return null;
  let viewBox = svg.match(/viewBox\s*=\s*"([^"]+)"/i)?.[1];
  if (!viewBox) {
    const w = svg.match(/\swidth\s*=\s*"([\d.]+)/i)?.[1];
    const h = svg.match(/\sheight\s*=\s*"([\d.]+)/i)?.[1];
    if (!w || !h) return null;
    viewBox = `0 0 ${w} ${h}`;
  }
  return { viewBox: viewBox.trim().replace(/,/g, ' ').replace(/\s+/g, ' '), d: paths.join(' ') };
}

/** Geometry for drawing a flag marker above a note head; `cx` is the head's horizontal centre. */
export const FLAG_BOX = 9;
