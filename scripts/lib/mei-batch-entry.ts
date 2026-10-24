/**
 * Browser-side entry of the headless MEI export (scripts/export-mei-batch.mjs). Bundled with esbuild and loaded into a
 * headless Chrome page, because the MEI emitter needs a real DOM (document.implementation, XMLSerializer).
 *
 * It does what Monodi-Zero does on import of a Monodi ZIP: `manifest` becomes `iiifManifestUrl`, unknown source keys
 * go to `custom`, and `additionalData` of a document becomes `custom`. Then it calls the same emitMei as the export button.
 */
import { emitMei } from '../../src/app/mei/mei-emitter';
import { defaultMeiProfile } from '../../src/app/mei/mei-mapping.model';
import { METADATA_MAPPING } from '../../src/app/mei/metadata-mapping.generated';
import type { PublicationContributor, PublicationSettings } from '../../src/app/api.service';

const SOURCE_KEYS = ['id', 'quellensigle', 'herkunftsregion', 'herkunftsort', 'herkunftsinstitution', 'ordenstradition', 'quellentyp',
  'bibliotheksort', 'bibliothek', 'bibliothekssignatur', 'kommentar', 'datierung'];

export interface MeiJob {
  root: any;              // data.json of the document (RootContainer)
  document: any;          // meta.json of the document
  source: any;            // meta.json of its source
  level: 1 | 2 | 3;
  publication?: PublicationSettings;
  appVersion?: string;
  now?: string;           // ISO time, for reproducible output
}

/** The values of the shared mapping for the Corpus Monodicum (the same the settings page fills in). */
export function defaultPublication(): PublicationSettings {
  const d = METADATA_MAPPING.project;
  const contributors: PublicationContributor[] = [];
  for (const person of METADATA_MAPPING.people) {
    for (const roleId of person.roles) {
      const role = METADATA_MAPPING.roles.find(r => r.id === roleId);
      if (role && role.levels.includes('corpus') && !role.levels.includes('source')) {
        contributors.push({ name: person.display, role: role.respText, orcid: person.orcid || undefined, gnd: person.gnd || undefined });
      }
    }
  }
  return {
    publisher: d.publisher, address: d.address, funderName: d.funderName, seriesTitle: d.seriesTitle,
    documentBaseUri: d.documentBaseUri, language: d.language, licenseUri: d.licenseUri, licenseLabel: d.licenseLabel, contributors
  };
}

function monodiSource(meta: any): any {
  const out: any = { custom: {} };
  for (const [k, v] of Object.entries(meta ?? {})) {
    if (SOURCE_KEYS.includes(k)) out[k] = v;
    else if (k === 'manifest') out.iiifManifestUrl = v;
    else out.custom[k] = typeof v === 'string' ? v : JSON.stringify(v);
  }
  for (const k of SOURCE_KEYS) if (out[k] === undefined) out[k] = '';
  return out;
}

function monodiDocument(meta: any): any {
  const out: any = { ...meta, custom: {} };
  delete out.additionalData;
  for (const [k, v] of Object.entries(meta?.additionalData ?? {})) {
    if (v !== null && v !== undefined && String(v).trim() !== '') out.custom[k] = String(v);
  }
  return out;
}

export function exportOne(job: MeiJob): { xml?: string; error?: string } {
  try {
    const profile = defaultMeiProfile();
    profile.headerLevel = job.level;
    const source = monodiSource(job.source);
    const xml = emitMei(job.root, profile, monodiDocument(job.document), source.quellensigle || undefined, {
      sourceMeta: source, publication: job.publication, appVersion: job.appVersion, now: job.now ? new Date(job.now) : undefined
    });
    return { xml };
  } catch (e: any) {
    return { error: String(e?.message ?? e) };
  }
}

(window as any).__mei = { exportOne, defaultPublication };
