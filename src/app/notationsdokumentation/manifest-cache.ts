/**
 * The canvases of IIIF manifests, each read once per session: the notation documentation and
 * "Show in manuscript" both need them. A manifest that could not be read is asked for again next time.
 */

const cache = new Map<string, Promise<any[]>>();

/** The canvases of a manifest (Presentation 2 or 3); rejects if it cannot be read (offline, no CORS, not a manifest). */
export function manifestCanvases(url: string): Promise<any[]> {
  let p = cache.get(url);
  if (!p) {
    p = (async () => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const manifest: any = await res.json();
      return manifest?.sequences?.[0]?.canvases ?? manifest?.items ?? [];
    })();
    cache.set(url, p);
    p.catch(() => { if (cache.get(url) === p) cache.delete(url); });
  }
  return p;
}
