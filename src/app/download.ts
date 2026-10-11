/**
 * Starts a browser download of `blob` under `filename`.
 *
 * The link is put into the page for the click (Firefox ignores `click()` on a detached link), and the blob URL is
 * released only after a delay: revoking it right after the click cancels the download in Safari and Firefox.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    a.remove();
    window.URL.revokeObjectURL(url);
  }, 5000);
}
