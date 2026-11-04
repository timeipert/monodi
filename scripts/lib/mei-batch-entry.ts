/**
 * Browser-side entry of the headless MEI export (scripts/export-mei-batch.mjs). Bundled with esbuild and loaded into a
 * headless Chrome page, because the MEI emitter needs a real DOM (document.implementation, XMLSerializer).
 *
 * It does what Monodi-Zero does on import of a Monodi ZIP: `manifest` becomes `iiifManifestUrl`, unknown source keys
 * go to `custom`, and `additionalData` of a document becomes `custom`. Then it calls the same emitMei as the export button.
 */
import { emitMei, defaultMeiProfile, METADATA_MAPPING } from '@monodi/core/mei';
import { monodiDocument, monodiSource } from './monodi-meta';
import type { PublicationContributor, PublicationSettings } from '../../src/app/api.service';

export interface MeiJob {
  root: any;              // data.json of the document (RootContainer)
  document: any;          // meta.json of the document
  source: any;            // meta.json of its source
  level: 1 | 2 | 3;
  /** false = the structure of the export button (not schema-conformant). Default true. */
  conformant?: boolean;
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

export function exportOne(job: MeiJob): { xml?: string; error?: string } {
  try {
    const profile = defaultMeiProfile();
    profile.headerLevel = job.level;
    profile.schemaConformant = job.conformant !== false;      // the dataset gets schema-conformant MEI
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
