import * as VM from '../types/model';
import { MeiMappingProfileV2 } from './mei-mapping.model';
import { MeiSchemaCatalog, checkAttribute } from './schema/mei-schema-catalog';
import { ruleProblem } from './mei-annotations';

export interface AnnotationIssue {
  level: 'error' | 'warning';
  /** Where the attribute comes from: a rule (by name) or a hand-set annotation (syllable text and note). */
  where: string;
  element: string;
  attribute: string;
  message: string;
}

/** Element names the annotations of each target are written to, as the profile maps them. */
export function targetElements(profile: MeiMappingProfileV2): { nc: string; neume: string; syllable: string } {
  return {
    nc: profile.entities.note.tag || 'nc',
    neume: profile.entities.neume.tag || 'neume',
    syllable: profile.entities.syllable.tag || 'syllable'
  };
}

/**
 * Checks the annotation rules of the profile and every hand-set annotation in the document against the
 * schema catalog. The export writes all of them regardless: this is a report for the person, not a gate.
 */
export function checkAnnotations(root: VM.RootContainer | undefined, profile: MeiMappingProfileV2, catalog: MeiSchemaCatalog | undefined): AnnotationIssue[] {
  const issues: AnnotationIssue[] = [];
  const policy = profile.attributePolicy ?? 'warn';
  const el = targetElements(profile);

  for (const rule of profile.annotationRules ?? []) {
    if (!rule.enabled) continue;
    const problem = ruleProblem(rule);
    if (problem) issues.push({ level: 'error', where: `Rule "${rule.name}"`, element: el[rule.target], attribute: '', message: problem });
    for (const [name, value] of Object.entries(rule.set)) {
      // A template value such as {pname} is only known at export; its name is still checked.
      const check = checkAttribute(catalog, el[rule.target], name, value.includes('{') ? null : value, policy);
      if (check) issues.push({ level: check.level, where: `Rule "${rule.name}"`, element: el[rule.target], attribute: name, message: check.message });
    }
  }

  if (root) {
    const handChecks = (where: string, element: string, attrs: Record<string, string> | undefined) => {
      for (const [name, value] of Object.entries(attrs ?? {})) {
        const check = checkAttribute(catalog, element, name, value, policy);
        if (check) issues.push({ level: check.level, where, element, attribute: name, message: check.message });
      }
    };
    for (const syl of VM.getSyllables(root)) {
      const label = syl.text ? `"${syl.text}"` : 'a syllable without text';
      handChecks(`Syllable ${label}`, el.syllable, syl.meiAttrs);
      for (const voice of [syl.notes, ...(syl.additionalMelodies ?? [])]) {
        for (const neume of voice?.spaced ?? []) {
          let first = true;
          for (const g of neume.nonSpaced) for (const n of g.grouped) {
            if (first) { handChecks(`Neume in ${label}`, el.neume, n.meiNeumeAttrs); first = false; }
            handChecks(`Note ${n.base}${n.octave} in ${label}`, el.nc, n.meiAttrs);
          }
        }
      }
    }
  }
  return issues;
}
