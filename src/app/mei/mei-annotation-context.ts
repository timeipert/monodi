import { MeiMappingProfileV2 } from '@monodi/core/mei';

/**
 * The MEI profile that is active in the open project. The editor's context menu reads it to know which
 * schema and which favourite attributes to offer, without every component loading the settings itself.
 * Set when the project settings are loaded or saved (`sanitizeSettings` in api.service.ts), like the note flags.
 */
let active: MeiMappingProfileV2 | undefined;

export function setActiveMeiProfile(profile: MeiMappingProfileV2 | undefined): void {
  active = profile;
}

export function getActiveMeiProfile(): MeiMappingProfileV2 | undefined {
  return active;
}
