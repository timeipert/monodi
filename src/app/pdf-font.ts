import { jsPDF } from 'jspdf';

/**
 * Embed bundled Noto fonts (SIL OFL) into a jsPDF document so PDF export can
 * render non-western text that the built-in WinAnsi fonts (times/helvetica)
 * cannot. jsPDF subsets embedded TTFs, so the generated PDFs stay small even
 * though the CJK source fonts are several MB.
 *
 * Families:
 *   'NotoSans'   — extended Latin, Greek, Cyrillic, many diacritics (4 weights).
 *   'NotoSansTC' — Traditional Chinese (+ Latin), one weight for all styles.
 *   'NotoSansSC' — Simplified Chinese (+ Latin), one weight for all styles.
 *
 * The TTFs live under `src/assets/font` and are fetched on demand at export
 * time (not bundled as base64); their base64 payloads are cached in memory.
 */

interface FontDef {
  /** jsPDF style → asset path (several styles may share one file). */
  styles: { style: string; file: string }[];
}

const FONTS: { [family: string]: FontDef } = {
  NotoSans: {
    styles: [
      { style: 'normal',     file: 'assets/font/static/NotoSans-Regular.ttf' },
      { style: 'bold',       file: 'assets/font/static/NotoSans-Bold.ttf' },
      { style: 'italic',     file: 'assets/font/static/NotoSans-Italic.ttf' },
      { style: 'bolditalic', file: 'assets/font/static/NotoSans-BoldItalic.ttf' },
    ],
  },
  // CJK has no italics and only one bundled weight; map every style to Regular.
  NotoSansTC: {
    styles: ['normal', 'bold', 'italic', 'bolditalic'].map(style => ({ style, file: 'assets/font/cjk/NotoSansTC-Regular.ttf' })),
  },
  NotoSansSC: {
    styles: ['normal', 'bold', 'italic', 'bolditalic'].map(style => ({ style, file: 'assets/font/cjk/NotoSansSC-Regular.ttf' })),
  },
};

const base64Cache: { [file: string]: string } = {};

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  }
  return btoa(binary);
}

/** Canonical family name for a configured PDF font, or null for a built-in one. */
export function embeddedFamily(family: string | undefined | null): string | null {
  const key = (family || '').replace(/\s+/g, '');
  const match = Object.keys(FONTS).find(f => f.toLowerCase() === key.toLowerCase());
  return match || null;
}

export function isEmbeddedFamily(family: string | undefined | null): boolean {
  return embeddedFamily(family) !== null;
}

/** Backwards-compatible name kept for existing call sites. */
export function isNotoFamily(family: string | undefined | null): boolean {
  return isEmbeddedFamily(family);
}

/**
 * Fetch and register the given embedded font family into `doc`. Call once per
 * document before rendering text. No-op for built-in families.
 */
export async function registerEmbeddedFont(doc: jsPDF, family: string | undefined | null): Promise<void> {
  const fam = embeddedFamily(family);
  if (!fam) return;
  const def = FONTS[fam];

  // Fetch any payloads not yet cached.
  const files = Array.from(new Set(def.styles.map(s => s.file)));
  await Promise.all(files.map(async file => {
    if (base64Cache[file]) return;
    const buf = await fetch(file).then(r => r.arrayBuffer());
    base64Cache[file] = arrayBufferToBase64(buf);
  }));

  const added = new Set<string>();
  for (const { style, file } of def.styles) {
    if (!added.has(file)) { doc.addFileToVFS(file, base64Cache[file]); added.add(file); }
    doc.addFont(file, fam, style);
  }
}

/** Backwards-compatible alias. */
export async function registerNotoSans(doc: jsPDF): Promise<void> {
  await registerEmbeddedFont(doc, 'NotoSans');
}
