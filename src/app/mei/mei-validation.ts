import { MeiMappingProfileV2, ENTITY_FIELDS, MeiEntityKey } from '@monodi/core/mei';

export interface MeiValidationError {
  entity?: string;
  message: string;
  isError: boolean;
}

export function validateMeiProfile(profile: MeiMappingProfileV2): MeiValidationError[] {
  const errors: MeiValidationError[] = [];
  
  if (profile.skeleton.length === 0) {
    errors.push({ entity: 'skeleton', message: 'Document skeleton is completely empty. No root elements will wrap the content.', isError: false });
  }

  Object.entries(profile.entities).forEach(([key, rule]) => {
    if (!rule.enabled) return;
    
    if (!rule.tag || rule.tag.trim() === '') {
      errors.push({ entity: key, message: 'Element tag is empty.', isError: false });
    }

    const attrNames = new Set<string>();
    rule.attributes.forEach(attr => {
      if (!attr.name) return;
      if (attrNames.has(attr.name)) {
        errors.push({ entity: key, message: `Duplicate attribute "${attr.name}".`, isError: false });
      }
      attrNames.add(attr.name);

      if (attr.source === 'field') {
        const availableFields = ENTITY_FIELDS[key as MeiEntityKey] || [];
        if (!availableFields.some(f => f.key === attr.value)) {
          errors.push({ entity: key, message: `Attribute "${attr.name}" references invalid data field "${attr.value}".`, isError: false });
        }
      }
    });
  });

  return errors;
}
