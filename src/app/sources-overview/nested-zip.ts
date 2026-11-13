/**
 * An export that was zipped a second time (the browser or Finder wraps a downloaded .zip when it is "compressed" again)
 * holds nothing but the real archive. This names that archive's path, or null when the ZIP is not such a wrapper:
 * it must hold exactly one real file (macOS noise such as `__MACOSX/` and `.DS_Store` does not count) and that is a .zip.
 */
export function nestedZipPath(paths: readonly string[]): string | null {
  const real = paths.filter((p) => p && !p.endsWith('/') && !p.includes('__MACOSX/') && !/(^|\/)\.DS_Store$/.test(p));
  return real.length === 1 && /\.zip$/i.test(real[0]) ? real[0] : null;
}
