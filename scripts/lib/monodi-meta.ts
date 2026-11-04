/**
 * Reads the metadata of a Monodi ZIP the way Monodi-Zero does on import: `manifest` becomes `iiifManifestUrl`, unknown source
 * keys go to `custom`, and `additionalData` of a document becomes `custom`. Shared by the headless MEI and SVG exports.
 */
export const SOURCE_KEYS = ['id', 'quellensigle', 'herkunftsregion', 'herkunftsort', 'herkunftsinstitution', 'ordenstradition', 'quellentyp',
  'bibliotheksort', 'bibliothek', 'bibliothekssignatur', 'kommentar', 'datierung'];

export function monodiSource(meta: any): any {
  const out: any = { custom: {} };
  for (const [k, v] of Object.entries(meta ?? {})) {
    if (SOURCE_KEYS.includes(k)) out[k] = v;
    else if (k === 'manifest') out.iiifManifestUrl = v;
    else if (k === 'additionalData') {
      // the CM columns of the source (CM-hub writes them here for the export): one `custom` entry each, as for a document; no e-mail address in an export
      for (const [ck, cv] of Object.entries((v as Record<string, unknown>) ?? {})) {
        if (cv !== null && cv !== undefined && String(cv).trim() !== '' && !String(cv).includes('@')) out.custom[ck] = String(cv);
      }
    } else out.custom[k] = typeof v === 'string' ? v : JSON.stringify(v);
  }
  for (const k of SOURCE_KEYS) if (out[k] === undefined) out[k] = '';
  return out;
}

export function monodiDocument(meta: any): any {
  const out: any = { ...meta, custom: {} };
  delete out.additionalData;
  for (const [k, v] of Object.entries(meta?.additionalData ?? {})) {
    if (v !== null && v !== undefined && String(v).trim() !== '' && !String(v).includes('@')) out.custom[k] = String(v);   // no e-mail address in an export
  }
  return out;
}

