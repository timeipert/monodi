import { jsPDF } from 'jspdf';

/**
 * Embed the bundled Noto Sans (SIL OFL) into a jsPDF document so that PDF export
 * can render non-western text (extended Latin, Greek, Cyrillic, many diacritics)
 * that the built-in WinAnsi fonts (times/helvetica) cannot.
 *
 * The TTFs live in `src/assets/font/static` and are fetched on demand at export
 * time (not bundled as base64), then embedded into the PDF. The base64 payloads
 * are cached in memory after the first export.
 */

const FONT_BASE = 'assets/font/static/';
const STYLES: { style: string; file: string }[] = [
  { style: 'normal',     file: 'NotoSans-Regular.ttf' },
  { style: 'bold',       file: 'NotoSans-Bold.ttf' },
  { style: 'italic',     file: 'NotoSans-Italic.ttf' },
  { style: 'bolditalic', file: 'NotoSans-BoldItalic.ttf' },
];

let base64Cache: { [file: string]: string } | null = null;

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  }
  return btoa(binary);
}

/** True when the configured PDF font is the embedded Unicode Noto Sans. */
export function isNotoFamily(family: string | undefined | null): boolean {
  return (family || '').toLowerCase().replace(/\s+/g, '') === 'notosans';
}

/**
 * Register Noto Sans in `doc` under the family name 'NotoSans' (normal/bold/
 * italic/bolditalic). Safe to call once per document before rendering text.
 */
export async function registerNotoSans(doc: jsPDF): Promise<void> {
  if (!base64Cache) {
    const entries = await Promise.all(
      STYLES.map(async ({ file }) => {
        const buf = await fetch(FONT_BASE + file).then(r => r.arrayBuffer());
        return [file, arrayBufferToBase64(buf)] as [string, string];
      })
    );
    base64Cache = Object.fromEntries(entries);
  }
  for (const { style, file } of STYLES) {
    doc.addFileToVFS(file, base64Cache[file]);
    doc.addFont(file, 'NotoSans', style);
  }
}
