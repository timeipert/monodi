/**
 * The metadata of a document, of its source and of the project that the `<meiHead>` of an export reads.
 *
 * Structural copies of the app's `Document` and `Source` (`apps/monodi/src/app/api.service.ts`) with the fields that
 * the header reads; the app's types are assignable to them. `PublicationContributor` and `PublicationSettings` are
 * defined here and used by the app (its `api.service.ts` re-exports them), because the header levels above the
 * baseline are the only reader of these values.
 */

/** A person or team credited in the metadata header of exports (see CM-hub/docs/METADATA-STANDARDS.md, section 6). */
export interface PublicationContributor {
  /** Display name, for example "Given Family". Never an e-mail address. */
  name: string;
  /** Text for <resp>, for example "Project direction". */
  role: string;
  orcid?: string;
  gnd?: string;
}

/**
 * Project-wide publication data used by the Standard and Extended MEI header levels. Every field is optional;
 * a missing value produces no element. Level 1 (baseline) ignores all of it.
 */
export interface PublicationSettings {
  publisher?: string;
  /** One address line per entry. */
  address?: string[];
  funderName?: string;
  seriesTitle?: string;
  /** Prefix of the public document URL; the document id is appended. */
  documentBaseUri?: string;
  /** Language of the header text, for example "en". */
  language?: string;
  licenseUri?: string;
  licenseLabel?: string;
  contributors?: PublicationContributor[];
}

/** Metadata of one document (the fields of `Document` in the app's `api.service.ts` that the header reads). */
export interface MonodiDocument {
  id: string;
  dokumenten_id: string;
  gattung1: string;
  gattung2: string;
  festtag: string;
  feier: string;
  textinitium: string;
  bibliographischerverweis: string;
  druckausgabe: string;
  zeilenstart: string;
  foliostart: string;
  kommentar: string;
  editionsstatus: string;
  custom?: { [key: string]: string };
}

/** Metadata of the source (manuscript) of a document (the fields of `Source` in the app's `api.service.ts` that the header reads). */
export interface Source {
  quellensigle: string;
  bibliotheksort: string;
  bibliothek: string;
  bibliothekssignatur: string;
  datierung: string;
}
