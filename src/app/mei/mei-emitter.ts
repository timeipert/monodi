import { 
  RootContainer, 
  ContainerKind, 
  LinePartKind, 
  ZeileContainer, 
  Syllable, 
  Clef, 
  Note, 
  FormteilContainer, 
  MiscContainer,
  NoteType
} from '../types/model';
import { Document as MonodiDocument, Source, PublicationSettings } from '../api.service';
import { generateCommentTreeDOM } from './mei-comment-tree';
import { buildMeiHead } from './mei-header';
import { flagDefsOf } from '../notes/note-flags';
import { extractPattern } from '../transcription-analyzer-core';
import { 
  MeiMappingProfileV2, 
  MeiEntityKey, 
  MeiEntityRule,
  resolvePatternRule
} from './mei-mapping.model';

export function resolveFormteilFields(formteil: FormteilContainer): Record<string, string> {
  const res: Record<string, string> = { uuid: formteil.uuid };
  if (formteil.data) {
    for (const d of formteil.data) {
      if (d.name === 'Signatur' && d.data) {
        res['signature'] = d.data;
      } else if (d.name === 'LemmatisiertesTextInitium' && d.data) {
        res['n'] = d.data;
      } else if (d.name === 'Status' && d.data) {
        res['status'] = d.data;
      }
    }
  }
  return res;
}

export function resolveClefFields(clef: Clef): Record<string, string> {
  return {
    uuid: clef.uuid,
    shape: clef.shape ? clef.shape.toUpperCase() : 'C'
  };
}

export function resolveNoteFields(note: Note, isConnectionGap: boolean, connectionGapValue: string = 'g'): Record<string, string> {
  const res: Record<string, string> = {
    uuid: note.uuid,
    base: note.base ? note.base.toLowerCase() : '',
    octave: note.octave !== undefined ? note.octave.toString() : ''
  };
  if (isConnectionGap) {
    res['connectionGap'] = connectionGapValue;
  }
  if (note.flags && note.flags.length > 0) {
    res['flags'] = note.flags.join(' ');
  }
  return res;
}


function getOrCreateWrapper(parent: Element, wrapperTag: string, doc: Document): Element {
  let existing = parent.querySelector(`:scope > ${wrapperTag}`);
  if (!existing) {
    existing = doc.createElementNS('http://www.music-encoding.org/ns/mei', wrapperTag);
    if (wrapperTag === 'staff' || wrapperTag === 'layer') {
      existing.setAttribute('n', '1');
    }
    parent.appendChild(existing);
  }
  return existing;
}

/** Siglum of the manuscript being exported; read by the pattern-rule lookup. emitMei is synchronous, so a module variable is safe. */
let activeSiglum: string | undefined;

/**
 * Schema-conformant structure (profile.schemaConformant): the body follows the MEI 5.0 schema that ships with the app
 * (mei-all.rng). The default structure does not (see CM-hub/docs/MEI-BODY-MAPPING.md). Module variables, like activeSiglum:
 * emitMei is synchronous.
 */
let conformant = false;
/** Prefix of generated xml:id values. Commentary copies of notes get their own prefix, so no id occurs twice. */
let idPrefix = 'm-';

/** Optional data for the header levels above the baseline. */
export interface EmitMeiOptions {
  sourceMeta?: Source;
  publication?: PublicationSettings;
  /** Export time; injectable so tests are deterministic. */
  now?: Date;
  appVersion?: string;
}

export function emitMei(root: RootContainer, profile: MeiMappingProfileV2, documentMeta?: MonodiDocument, sourceSiglum?: string, options?: EmitMeiOptions): string {
  activeSiglum = sourceSiglum || undefined;
  conformant = !!profile.schemaConformant;
  idPrefix = 'm-';
  const doc = document.implementation.createDocument('http://www.music-encoding.org/ns/mei', 'mei', null);
  const mei = doc.documentElement;
  mei.setAttribute('meiversion', '5.0');

  // 1. Emit Header. Level 1 is the baseline header; higher levels follow the shared mapping (see mei-header.ts).
  if (profile.emitHeader) {
    mei.appendChild(buildMeiHead(doc, {
      root, documentMeta, sourceSiglum,
      sourceMeta: options?.sourceMeta, publication: options?.publication,
      level: profile.headerLevel ?? 1, now: options?.now, appVersion: options?.appVersion
    }));
  }

  // 2. Build Skeleton
  let skeletonEnd: Element = mei;
  let bodyElement: Element | null = null;
  for (const tag of profile.skeleton) {
    const el = doc.createElementNS('http://www.music-encoding.org/ns/mei', tag);
    if (tag === 'mdiv') {
      el.setAttribute('type', 'main');
    }
    skeletonEnd.appendChild(el);
    skeletonEnd = el;
    if (tag === 'body') {
      bodyElement = el;
    }
  }

  // Score level scoreDef (must append before content)
  const scoreDef = doc.createElementNS('http://www.music-encoding.org/ns/mei', 'scoreDef');
  skeletonEnd.appendChild(scoreDef);

  // 3. Emit Root Container Element (acting as top-level formteil)
  const rootRule = profile.entities.formteil;
  const rootEl = doc.createElementNS('http://www.music-encoding.org/ns/mei', rootRule.tag);
  rootEl.setAttribute('xml:id', 'm-' + root.uuid);
  skeletonEnd.appendChild(rootEl);

  // Walk Root Container. RootChildren = FormteilContainer | MiscContainer |
  // ZeileContainer | ParatextContainer — a document whose lines sit directly
  // under the root (no Formteil wrapper) must still emit its content.
  if (root.children) {
    for (const child of root.children) {
      if (child.kind === ContainerKind.FormteilContainer) {
        walkFormteil(child, rootEl, doc, profile);
      } else if (child.kind === ContainerKind.MiscContainer) {
        walkMisc(child, rootEl, doc, profile);
      } else if (child.kind === ContainerKind.ZeileContainer) {
        walkZeile(child as any, rootEl, doc, profile);
      } else if (child.kind === ContainerKind.ParatextContainer) {
        walkLinePart(child, rootEl, doc, profile);
      }
    }
  }

  // 4. Process structural comments into appendixed mdivs (Verbatim)
  if (bodyElement && root.comments && root.comments.length > 0) {
    for (let i = 0; i < root.comments.length; i++) {
        const comment = root.comments[i];
        let treeResult = { element: null as Element | null, zeilen: [] as { id: string, zeile: ZeileContainer }[] };
        if (comment.tree) {
            const noteCounter = { count: 0 };
            treeResult = generateCommentTreeDOM(comment.tree, doc, i, noteCounter);
        }
        
        // Tree is the source of truth when present; legacy `lines` are only
        // emitted for truly-legacy comments that were never migrated.
        const hasMusicalStructure = treeResult.zeilen.length > 0 || (!comment.tree && !!comment.lines && comment.lines.length > 0);

        if (hasMusicalStructure) {
            const commentMdiv = doc.createElementNS('http://www.music-encoding.org/ns/mei', 'mdiv');
            commentMdiv.setAttribute('type', 'commentary');
            commentMdiv.setAttribute('xml:id', 'm-comment-' + i);

            const commentScore = doc.createElementNS('http://www.music-encoding.org/ns/mei', 'score');
            const commentScoreDef = doc.createElementNS('http://www.music-encoding.org/ns/mei', 'scoreDef');
            commentScore.appendChild(commentScoreDef);

            if (!comment.tree && comment.lines && comment.lines.length > 0) {
                const commentSection = doc.createElementNS('http://www.music-encoding.org/ns/mei', profile.entities.formteil.tag);
                let currentStaff: Element | null = null;
                let currentLayer: Element | null = null;
                const hasWitnessLabels = comment.readingWitnesses && comment.readingWitnesses.some(w => !!w);
                let readingIndex = 0;
                for (const child of comment.lines) {
                    if (child.kind === ContainerKind.FormteilContainer) {
                        walkFormteil(child, commentSection, doc, profile);
                    } else if (child.kind === ContainerKind.ZeileContainer) {
                        if (hasWitnessLabels) {
                            currentStaff = doc.createElementNS('http://www.music-encoding.org/ns/mei', 'staff');
                            currentStaff.setAttribute('n', '1');
                            currentStaff.setAttribute('xml:id', `m-comment-${i}-reading-${readingIndex}`);
                            currentLayer = doc.createElementNS('http://www.music-encoding.org/ns/mei', 'layer');
                            currentLayer.setAttribute('n', '1');
                            currentStaff.appendChild(currentLayer);
                            commentSection.appendChild(currentStaff);
                            if (conformant) idPrefix = `m-comment-${i}-reading-${readingIndex}-`;
                            walkZeile(child, currentLayer!, doc, profile);
                            idPrefix = 'm-';
                        } else {
                            if (!currentStaff) {
                              currentStaff = doc.createElementNS('http://www.music-encoding.org/ns/mei', 'staff');
                              currentStaff.setAttribute('n', '1');
                              currentLayer = doc.createElementNS('http://www.music-encoding.org/ns/mei', 'layer');
                              currentLayer.setAttribute('n', '1');
                              currentStaff.appendChild(currentLayer);
                              commentSection.appendChild(currentStaff);
                            }
                            if (conformant) idPrefix = `m-comment-${i}-line-${readingIndex}-`;
                            walkZeile(child, currentLayer!, doc, profile);
                            idPrefix = 'm-';
                        }
                        readingIndex++;
                    }
                }
                commentScore.appendChild(commentSection);
            }
            
            if (treeResult.zeilen.length > 0) {
                for (const zItem of treeResult.zeilen) {
                    const ptrSection = doc.createElementNS('http://www.music-encoding.org/ns/mei', profile.entities.formteil.tag);
                    ptrSection.setAttribute('xml:id', zItem.id);
                    const currentStaff = doc.createElementNS('http://www.music-encoding.org/ns/mei', 'staff');
                    currentStaff.setAttribute('n', '1');
                    const currentLayer = doc.createElementNS('http://www.music-encoding.org/ns/mei', 'layer');
                    currentLayer.setAttribute('n', '1');
                    currentStaff.appendChild(currentLayer);
                    ptrSection.appendChild(currentStaff);
                    
                    if (conformant) idPrefix = `${zItem.id}-`;
                    walkZeile(zItem.zeile, currentLayer, doc, profile);
                    idPrefix = 'm-';
                    commentScore.appendChild(ptrSection);
                }
            }
            
            commentMdiv.appendChild(commentScore);
            bodyElement.appendChild(commentMdiv);
        }
    }
  }

  const serializer = new XMLSerializer();
  let xmlString = serializer.serializeToString(mei);
  
  const header = `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<?xml-model href="https://music-encoding.org/schema/dev/mei-Neumes.rng" type="application/xml" schematypens="http://relaxng.org/ns/structure/1.0"?>\n` +
    `<?xml-model href="https://music-encoding.org/schema/dev/mei-Neumes.rng" type="application/xml" schematypens="http://purl.oclc.org/dsdl/schematron"?>\n`;
  
  return header + xmlString;
}

/** Sets pattern-rule attributes; empty values are skipped, pitch is never overridden. */
function applyRuleAttributes(element: Element, attrs?: Record<string, string>) {
  if (!attrs) return;
  for (const [name, value] of Object.entries(attrs)) {
    if (value === '' || value == null || name === 'pname' || name === 'oct') continue;
    element.setAttribute(name, value);
  }
}

function applyAttributes(
  element: Element, 
  rule: MeiEntityRule, 
  resolvedFields: Record<string, string>, 
  customHandler?: (ruleName: string) => string | null
) {
  for (const attrRule of rule.attributes) {
    let val = '';
    if (attrRule.source === 'field') {
      val = resolvedFields[attrRule.value] || '';
    } else {
      val = attrRule.value;
    }

    if (customHandler) {
      const handlerVal = customHandler(attrRule.name);
      if (handlerVal !== null) {
        val = handlerVal;
      }
    }

    if (val !== '' || !attrRule.omitIfEmpty) {
      element.setAttribute(attrRule.name, val);
    }
  }
}

function walkMisc(misc: MiscContainer, parentElement: Element, doc: Document, profile: MeiMappingProfileV2) {
  if (!misc.children) return;
  for (const child of misc.children) {
    if (child.kind === ContainerKind.ZeileContainer) {
      walkZeile(child, parentElement, doc, profile);
    }
  }
}

function walkFormteil(formteil: FormteilContainer, parentElement: Element, doc: Document, profile: MeiMappingProfileV2) {
  const rule = profile.entities.formteil;
  if (!rule.enabled) {
    // Flatten children
    if (formteil.children) {
      for (const child of formteil.children) {
        if (child.kind === ContainerKind.FormteilContainer) {
          walkFormteil(child, parentElement, doc, profile);
        } else if (child.kind === ContainerKind.ZeileContainer) {
          walkZeile(child, parentElement, doc, profile);
        }
      }
    }
    return;
  }

  const section = doc.createElementNS('http://www.music-encoding.org/ns/mei', rule.tag);
  section.setAttribute('xml:id', idPrefix + formteil.uuid);

  const fields = resolveFormteilFields(formteil);
  applyAttributes(section, rule, fields);

  // Verbatim Signatur annotations, Verweis, etc.
  if (formteil.data) {
    for (const d of formteil.data) {
      if (d.name === 'Verweis' && d.data) {
        const annot = doc.createElementNS('http://www.music-encoding.org/ns/mei', 'annot');
        annot.setAttribute('type', 'verweis');
        annot.textContent = d.data;
        section.appendChild(annot);
      }
    }
  }

  // Resolve wrappers outermost-first
  let targetParent = parentElement;
  for (const w of rule.wrappers) {
    targetParent = getOrCreateWrapper(targetParent, w, doc);
  }
  targetParent.appendChild(section);

  if (formteil.children) {
    for (const child of formteil.children) {
      if (child.kind === ContainerKind.FormteilContainer) {
        walkFormteil(child, section, doc, profile);
      } else if (child.kind === ContainerKind.ZeileContainer) {
        walkZeile(child, section, doc, profile);
      }
    }
  }
}

function walkZeile(zeile: ZeileContainer, parentElement: Element, doc: Document, profile: MeiMappingProfileV2) {
  const rule = profile.entities.zeile;
  if (!rule.enabled) {
    // Flatten children
    if (zeile.children) {
      for (const part of zeile.children) {
        walkLinePart(part, parentElement, doc, profile);
      }
    }
    return;
  }

  if (conformant) {
    // Inside a layer (commentary lines) the caller has made staff and layer: no line break, no wrappers.
    // Elsewhere a line is a <staff><layer> of its own, announced by a line break in the section (an <sb> in a layer is invalid).
    let layer = parentElement;
    if (parentElement.localName !== 'layer') {
      const sbElement = doc.createElementNS('http://www.music-encoding.org/ns/mei', rule.tag);
      sbElement.setAttribute('xml:id', idPrefix + zeile.uuid);
      applyAttributes(sbElement, rule, { uuid: zeile.uuid });
      parentElement.appendChild(sbElement);
      const staff = doc.createElementNS('http://www.music-encoding.org/ns/mei', 'staff');
      staff.setAttribute('n', '1');
      layer = doc.createElementNS('http://www.music-encoding.org/ns/mei', 'layer');
      layer.setAttribute('n', '1');
      staff.appendChild(layer);
      parentElement.appendChild(staff);
    }
    for (const part of zeile.children ?? []) {
      walkLinePart(part, layer, doc, profile);
    }
    return;
  }

  // Resolve wrappers outermost-first
  let targetParent = parentElement;
  for (const w of rule.wrappers) {
    targetParent = getOrCreateWrapper(targetParent, w, doc);
  }

  const sb = doc.createElementNS('http://www.music-encoding.org/ns/mei', rule.tag);
  sb.setAttribute('xml:id', idPrefix + zeile.uuid);
  applyAttributes(sb, rule, { uuid: zeile.uuid });
  targetParent.appendChild(sb);

  if (zeile.children) {
    for (const part of zeile.children) {
      walkLinePart(part, targetParent, doc, profile);
    }
  }
}

function walkLinePart(part: any, parentElement: Element, doc: Document, profile: MeiMappingProfileV2) {
  if (part.kind === LinePartKind.Clef) {
    const rule = profile.entities.clef;
    if (!rule.enabled) return;

    // Resolve wrappers outermost-first
    let targetParent = parentElement;
    for (const w of rule.wrappers) {
      targetParent = getOrCreateWrapper(targetParent, w, doc);
    }

    const clef = doc.createElementNS('http://www.music-encoding.org/ns/mei', rule.tag);
    clef.setAttribute('xml:id', idPrefix + part.uuid);
    const fields = resolveClefFields(part);
    applyAttributes(clef, rule, fields);
    targetParent.appendChild(clef);

  } else if (part.kind === LinePartKind.Syllable) {
    const rule = profile.entities.syllable;
    if (!rule.enabled) {
      // Walk notes directly under parentElement
      walkSyllableNotes(part, parentElement, doc, profile);
      return;
    }

    // Resolve wrappers outermost-first
    let targetParent = parentElement;
    for (const w of rule.wrappers) {
      targetParent = getOrCreateWrapper(targetParent, w, doc);
    }

    const syllable = doc.createElementNS('http://www.music-encoding.org/ns/mei', rule.tag);
    syllable.setAttribute('xml:id', idPrefix + part.uuid);
    applyAttributes(syllable, rule, { uuid: part.uuid });

    // syllableText inner tag
    const textRule = profile.entities.syllableText;
    if (textRule.enabled && part.text) {
      const syl = doc.createElementNS('http://www.music-encoding.org/ns/mei', textRule.tag);
      syl.textContent = part.text;
      applyAttributes(syl, textRule, { text: part.text, uuid: part.uuid });
      syllable.appendChild(syl);
    }

    // Walk notes under the syllable element
    walkSyllableNotes(part, syllable, doc, profile);

    targetParent.appendChild(syllable);

  } else if (part.kind === ContainerKind.ParatextContainer || (part.text !== undefined && part.paratextType !== undefined)) {
    // ParatextContainer
    const rule = profile.entities.paratext;
    if (!rule.enabled) return;

    // Resolve wrappers outermost-first
    let targetParent = parentElement;
    for (const w of rule.wrappers) {
      targetParent = getOrCreateWrapper(targetParent, w, doc);
    }

    const dir = doc.createElementNS('http://www.music-encoding.org/ns/mei', rule.tag);
    dir.setAttribute('xml:id', idPrefix + part.uuid);
    applyAttributes(dir, rule, { text: part.text || '', paratextType: part.paratextType || '', uuid: part.uuid });
    if (rule.textFrom === 'text') {
      dir.textContent = part.text || '';
    }
    targetParent.appendChild(dir);
  }
}

/**
 * Break INSIDE a neume: consecutive non-empty `grouped` arrays are not
 * graphically ligated (`*u` as opposed to the ligature `[*u]`). As in MEI,
 * con="g" sits on the nc that follows the break and describes its connection
 * to the preceding nc.
 */
function isGroupBreakGap(groups: { grouped: Note[] }[], gIndex: number, nIndex: number): boolean {
  if (nIndex !== 0) return false;
  for (let g = gIndex - 1; g >= 0; g--) {
    if (groups[g]?.grouped?.length > 0) return true;
  }
  return false;
}

function walkSyllableNotes(syllable: Syllable, parentElement: Element, doc: Document, profile: MeiMappingProfileV2) {
  if (!syllable.notes || !syllable.notes.spaced) return;

  const spacedArr = syllable.notes.spaced;
  // Every spaced unit becomes its own <neume>, so a gap between units needs no
  // mark. con="g" only marks a gap INSIDE a neume, between non-ligated groups
  // (`*u`, see isGroupBreakGap); notes in one `grouped` array are a ligature.
  for (let sIndex = 0; sIndex < spacedArr.length; sIndex++) {
    const neumeData = spacedArr[sIndex];
    if (!neumeData.nonSpaced || neumeData.nonSpaced.length === 0) continue;

    const patternRule = resolvePatternRule(profile.patternRules, extractPattern(neumeData), activeSiglum);
    let flatIndex = 0;

    const neumeRule = profile.entities.neume;
    let targetParent = parentElement;

    if (neumeRule.enabled) {
      // Resolve wrappers outermost-first
      for (const w of neumeRule.wrappers) {
        targetParent = getOrCreateWrapper(targetParent, w, doc);
      }
      const neume = doc.createElementNS('http://www.music-encoding.org/ns/mei', neumeRule.tag);
      applyAttributes(neume, neumeRule, {});
      applyRuleAttributes(neume, patternRule?.neume);
      targetParent.appendChild(neume);
      targetParent = neume;
    }

    for (let gIndex = 0; gIndex < neumeData.nonSpaced.length; gIndex++) {
      const groupedData = neumeData.nonSpaced[gIndex];
      if (!groupedData.grouped || groupedData.grouped.length === 0) continue;

      for (let nIndex = 0; nIndex < groupedData.grouped.length; nIndex++) {
        const note = groupedData.grouped[nIndex];

        let entityKey: MeiEntityKey = 'note';
        if (note.noteType === NoteType.Oriscus) {
          entityKey = 'oriscus';
        } else if (note.noteType === NoteType.Quilisma) {
          entityKey = 'quilisma';
        } else if (note.noteType === NoteType.Strophicus) {
          entityKey = 'strophicus';
        } else if (note.noteType === NoteType.Liquescent || note.liquescent) {
          entityKey = 'liquescent';
        }

        // Conformant: an ornament is an empty child of its <nc>, never a replacement for it.
        const ornaments: MeiEntityKey[] = [];
        if (conformant) {
          entityKey = 'note';
          if (note.noteType === NoteType.Oriscus) ornaments.push('oriscus');
          if (note.noteType === NoteType.Quilisma) ornaments.push('quilisma');
          if (note.noteType === NoteType.Strophicus) ornaments.push('strophicus');
          if (note.noteType === NoteType.Liquescent || note.liquescent) ornaments.push('liquescent');
        }

        const noteRule = profile.entities[entityKey];
        if (!noteRule.enabled) continue;

        // Resolve wrappers outermost-first
        let noteTargetParent = targetParent;
        for (const w of noteRule.wrappers) {
          noteTargetParent = getOrCreateWrapper(noteTargetParent, w, doc);
        }

        // User-defined note flags: may rename the element and add fixed attributes.
        const flagDefs = flagDefsOf(note.flags);
        const flagTag = flagDefs.find(f => f.meiTag)?.meiTag;
        const nc = doc.createElementNS('http://www.music-encoding.org/ns/mei', flagTag || noteRule.tag);
        nc.setAttribute('xml:id', idPrefix + note.uuid);

        const isConnectionGap = isGroupBreakGap(neumeData.nonSpaced, gIndex, nIndex);

        // Find custom attribute name mappings for curve/con rules to perform proper conditional checks
        // Addressed by name (curve / con), not by position, so users can reorder rules.
        const liquescentRule = noteRule.attributes.find(a => a.name === 'curve') || noteRule.attributes[2];
        const connectionRule = noteRule.attributes.find(a => a.name === 'con') || noteRule.attributes[3];
        const liquescentAttrName = liquescentRule?.name || 'curve';
        const connectionAttrName = connectionRule?.name || 'con';
        const connectionGapValue = connectionRule?.value || 'g';

        const fields = resolveNoteFields(note, isConnectionGap, connectionGapValue);

        applyAttributes(nc, noteRule, fields, (ruleName) => {
          if (ruleName === liquescentAttrName && (conformant || !note.liquescent || nc.tagName === profile.entities.liquescent.tag)) {
            return ''; // Omit liquescent attribute if not liquescent or tag is liquescent
          }
          if (ruleName === connectionAttrName && !isConnectionGap) {
            return ''; // Omit connection attribute if not at connection gap
          }
          return null; // Keep resolved default
        });

        for (const fd of flagDefs) applyRuleAttributes(nc, fd.mei);

        // Pattern rule: the rule's nc entry for this note position (never pname/oct).
        applyRuleAttributes(nc, patternRule?.nc[flatIndex]);
        flatIndex++;

        for (const key of ornaments) {
          const ornamentRule = profile.entities[key];
          if (ornamentRule.enabled) nc.appendChild(doc.createElementNS('http://www.music-encoding.org/ns/mei', ornamentRule.tag));
        }

        noteTargetParent.appendChild(nc);
      }
    }
  }
}
