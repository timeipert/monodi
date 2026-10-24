/**
 * Types of the shared metadata mapping (CM-hub/config/metadata-mapping.yml).
 * The data itself is generated into metadata-mapping.generated.ts; see CM-hub/docs/METADATA-STANDARDS.md.
 */

/** Header level: 1 Minimal (baseline), 2 Standard, 3 Extended. */
export type HeaderLevel = 1 | 2 | 3;

export type MappingEntity = 'source' | 'document' | 'corpus';

export interface MappingTarget {
  /** Path relative to meiHead; `{alias}` is replaced from `MetadataMapping.aliases`. */
  path: string;
  /** Level from which this target is written (the entry level unless the target overrides it). */
  level: HeaderLevel;
}

export interface MappingEntry {
  id: string;
  entity: MappingEntity;
  /** Names of Monodi-Zero fields the value comes from. */
  monodi: string[];
  /** Names of CM columns (not available inside Monodi-Zero). */
  cm: string[];
  targets: MappingTarget[];
  level: HeaderLevel;
  /** True if the baseline export (Monodi-Zero 0.9.1) already writes this entry. */
  inBaseline: boolean;
  /** True if the path has not been validated against the schema or is an open modelling question. */
  verify: boolean;
}

export interface MappingRole {
  id: string;
  labelEn: string;
  labelDe: string;
  marc: string;
  /** Text for <resp>. */
  respText: string;
  levels: string[];
}

export interface MappingPerson {
  id: string;
  display: string;
  sort: string;
  roles: string[];
  orcid: string;
  gnd: string;
}

export interface MappingProjectDefaults {
  publisher: string;
  address: string[];
  country: string;
  funderName: string;
  seriesTitle: string;
  documentBaseUri: string;
  language: string;
  licenseUri: string;
  licenseLabel: string;
}

export interface MetadataMapping {
  specVersion: number;
  meiVersion: string;
  levels: Record<string, string>;
  aliases: Record<string, string>;
  project: MappingProjectDefaults;
  entries: MappingEntry[];
  roles: MappingRole[];
  people: MappingPerson[];
}
