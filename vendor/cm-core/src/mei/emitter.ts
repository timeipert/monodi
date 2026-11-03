import {
  ContainerKind,
  LinePartKind,
  NoteType,
  baseNoteIndexes,
  allNotes
} from '../document/model';
import type {
  RootContainer,
  ZeileContainer,
  Syllable,
  Clef,
  Note,
  FormteilContainer,
  MiscContainer,
  Spaced
} from '../document/model';
import type { MonodiDocument, Source, PublicationSettings } from './meta';
import { generateCommentTreeDOM } from './comment-tree';
import { buildMeiHead } from './header';
import { flagDefsOf } from '../document/note-flags';
import { applyAnnotationAttrs, buildAnnotationIndex, emptyIndex, firstNoteOf, mergedAttrs } from './annotations';
import type { AnnotationIndex } from './annotations';
import { extractPattern } from '../document/pattern';
import {
  resolvePatternRule,
  syllableTypeRule,
  DEFAULT_STAFF
} from './mapping.model';
import type {
  MeiMappingProfileV2,
  MeiEntityKey,
  MeiEntityRule
} from './mapping.model';

export function resolveFormteilFields(formteil: FormteilContainer): Record<string, string> {
  const res: Record<string, string> = { uuid: formteil.uuid };
  if (formteil.data) {
    for (const d of formteil.data) {
      if (d.name === 'Signatur' && d.data) {
        res['signature'] = d.data;
      } else if (d.name === 'LemmatisiertesTextInitium' && d.data) {
        res['n'] = d.data;
        res['initium'] = d.data;
      } else if (d.name === 'Status' && d.data) {
        res['status'] = d.data;
      }
    }
  }
  return res;
}

/**
 * Staff line of a clef: the editor draws the bottom line at E of octave 4 and a line every third, so a clef sign
 * on a line has an even number of steps above it. A clef in a space (odd number) is given the line below it; one outside the
 * five lines the nearest line.
 */
export function clefLine(clef: Clef): number {
  const steps = clef.octave * 7 + (baseNoteIndexes[clef.base] ?? 0) - (4 * 7 + 2);
  return Math.min(5, Math.max(1, Math.floor(steps / 2) + 1));
}

export function resolveClefFields(clef: Clef): Record<string, string> {
  return {
    uuid: clef.uuid,
    shape: clef.shape ? clef.shape.toUpperCase() : 'C',
    line: String(clefLine(clef))
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
/** Flat, sharp and natural are written as `<accid>` of the syllable (profile.accidentals, default on) and not as a note. */
let accidAsElement = true;
/** ids of page and line breaks written so far in this document: Monodi data can repeat the uuid of a FolioChange or LineChange. */
let pageBreakIds = new Set<string>();
/** The previous syllable of the line ends with a hyphen, so the word continues (for `@wordpos`). */
let wordOpen = false;
/** Prefix of generated xml:id values. Commentary copies of notes get their own prefix, so no id occurs twice. */
let idPrefix = 'm-';
/** Attributes from the profile's annotation rules for the document being exported. */
let annotations: AnnotationIndex = emptyIndex();
/** Profile of the export in progress (module variable like the ones above: emitMei is synchronous). */
let activeProfile: MeiMappingProfileV2 | undefined;
/** The line being written has adiastematic notation and the profile asks for contours instead of pitches. */
let contourLine = false;
/** Pitch (octave * 7 + step) of the previous note of the line, for `@intm` of a contour line. */
let previousPitch: number | null = null;

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
  activeProfile = profile;
  conformant = profile.schemaConformant !== false;
  contourLine = false;
  previousPitch = null;
  accidAsElement = profile.accidentals !== 'note';
  pageBreakIds = new Set<string>();
  wordOpen = false;
  idPrefix = 'm-';
  annotations = buildAnnotationIndex(root, profile.annotationRules, activeSiglum);
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
    if (conformant) appendGlobalComment(mei, doc, root);
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
  skeletonEnd.appendChild(makeScoreDef(doc, profile));

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
            commentScore.appendChild(makeScoreDef(doc, profile));

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

  if (conformant) makeVerovioSafe(mei, doc);

  const serializer = new XMLSerializer();
  let xmlString = serializer.serializeToString(mei);
  
  // The development schema URL answers 404 (state 2026-10-26). The conformant structure names the released MEI 5.0 neumes
  // customization, which accepts meiversion="5.0"; the default keeps the line of earlier exports.
  const schemaUrl = conformant ? 'https://music-encoding.org/schema/5.0/mei-Neumes.rng' : 'https://music-encoding.org/schema/dev/mei-Neumes.rng';
  const header = `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<?xml-model href="${schemaUrl}" type="application/xml" schematypens="http://relaxng.org/ns/structure/1.0"?>\n` +
    `<?xml-model href="${schemaUrl}" type="application/xml" schematypens="http://purl.oclc.org/dsdl/schematron"?>\n`;
  
  return header + xmlString;
}

const MEI_NS = 'http://www.music-encoding.org/ns/mei';

/**
 * Conformant structure: the general comment of a chant (RootContainer.globalComment) as an annot in fileDesc/notesStmt.
 * Music examples inside it have no commentary mdiv to point at, so their ptr is left out; they stay in the notes file of the dataset.
 */
function appendGlobalComment(mei: Element, doc: Document, root: RootContainer) {
  if (!root.globalComment) return;
  const content = generateCommentTreeDOM(root.globalComment, doc, -1, { count: 0 }).element;
  if (!content) return;
  content.querySelectorAll('ptr').forEach(p => p.remove());
  if (!content.textContent?.trim()) return;
  const fileDesc = mei.getElementsByTagNameNS(MEI_NS, 'fileDesc')[0];
  if (!fileDesc) return;
  let notesStmt = Array.from(fileDesc.children).find(c => c.localName === 'notesStmt');
  if (!notesStmt) {
    notesStmt = doc.createElementNS(MEI_NS, 'notesStmt');
    fileDesc.insertBefore(notesStmt, Array.from(fileDesc.children).find(c => c.localName === 'sourceDesc') ?? null);
  }
  const annot = doc.createElementNS(MEI_NS, 'annot');
  annot.setAttribute('type', 'global-comment');
  annot.appendChild(content);
  notesStmt.appendChild(annot);
}

/**
 * Conformant structure: word position from the text. A trailing hyphen means the word continues in the next syllable. The Monodi flag
 * `endsWord` is not used: it disagrees with the hyphens in about half of the syllables of the edition (config/mei-body-mapping.yml in CM-hub).
 * Commentary copies are excerpts and get no word position; a text without letters (an ellipsis) or with spaces is not one syllable of a word.
 */
function applyWordPosition(syl: Element, text: string) {
  const t = text.trim();
  if (idPrefix !== 'm-' || !/\p{L}/u.test(t) || /\s/.test(t)) return;
  const continues = t.endsWith('-');
  syl.setAttribute('wordpos', wordOpen ? (continues ? 'm' : 't') : (continues ? 'i' : 's'));
  if (continues) syl.setAttribute('con', 'd');
  wordOpen = continues;
}

/**
 * The `scoreDef`. A Schematron rule of the MEI schema requires, for every `<staff n="1">`, a preceding `<staffDef n="1">` with
 * `@lines`; the conformant structure writes it with the lines and the G clef on the second line that the editor draws.
 */
function makeScoreDef(doc: Document, profile: MeiMappingProfileV2): Element {
  const scoreDef = doc.createElementNS('http://www.music-encoding.org/ns/mei', 'scoreDef');
  if (conformant) {
    const staff = profile.staff ?? DEFAULT_STAFF;
    const staffGrp = doc.createElementNS('http://www.music-encoding.org/ns/mei', 'staffGrp');
    const staffDef = doc.createElementNS('http://www.music-encoding.org/ns/mei', 'staffDef');
    staffDef.setAttribute('n', '1');
    // Without @notationtype="neume" Verovio (and MEI-Friend, which is built on it) reads the neumes as common music notation: it warns
    // "Parent note for <syl> was not found" for every syllable and draws the staff wrongly (checked 2026-11-03 with Verovio 6.4).
    staffDef.setAttribute('notationtype', 'neume');
    staffDef.setAttribute('lines', String(staff.lines));
    if (staff.clefShape) staffDef.setAttribute('clef.shape', staff.clefShape);
    if (staff.clefShape && staff.clefLine) staffDef.setAttribute('clef.line', String(staff.clefLine));
    staffGrp.appendChild(staffDef);
    scoreDef.appendChild(staffGrp);
  }
  return scoreDef;
}

/**
 * Two rules of the viewers that are built on Verovio (MEI-Friend, Verovio's own tools). Found on 2026-11-03 by loading the exported
 * chants of the edition into Verovio 6.4; both structures are valid MEI (checked against the MEI 5.0 neumes schema), the viewers
 * cannot show them:
 *
 * 1. Verovio lays out all `staff` children of ONE section as one system, on top of each other. A form part with several lines then
 *    shows its lines over each other (the texts overlap). A line after the first gets a section of its own, together with its `sb`.
 * 2. An `annot` that is a direct child of a section (paratext, Verweis, initium) crashes Verovio 6.4. It moves to the start of the layer of
 *    the next line of the same `mdiv`, or to the end of the layer of the previous line; a chant without any line gets a staff for it.
 *    The comments of the header (`notesStmt`) are not touched.
 */
function makeVerovioSafe(mei: Element, doc: Document): void {
  const NS = 'http://www.music-encoding.org/ns/mei';
  for (const section of Array.from(mei.getElementsByTagNameNS(NS, 'section'))) {
    let seenStaff = false;
    for (const child of Array.from(section.children)) {
      if (child.localName !== 'staff') continue;
      if (seenStaff) {
        const before = child.previousElementSibling;
        const anchor = before && before.localName === 'sb' ? before : child;
        const holder = doc.createElementNS(NS, 'section');
        const sbId = anchor !== child ? anchor.getAttribute('xml:id') : null;
        if (sbId) holder.setAttribute('xml:id', sbId + '-line');
        section.insertBefore(holder, anchor);
        holder.appendChild(anchor);
        if (anchor !== child) holder.appendChild(child);
      }
      seenStaff = true;
    }
  }

  const annots = Array.from(mei.getElementsByTagNameNS(NS, 'annot')).filter(a => a.parentElement?.localName === 'section');
  const layersOf = (el: Element): Element[] => Array.from((el.closest('mdiv') ?? mei).getElementsByTagNameNS(NS, 'layer'));
  for (const annot of annots.reverse()) {                       // reversed: inserting at the start keeps the order of annotations
    const layers = layersOf(annot);
    const next = layers.find(l => !!(annot.compareDocumentPosition(l) & Node.DOCUMENT_POSITION_FOLLOWING));
    if (next) {
      next.insertBefore(annot, next.firstChild);
      continue;
    }
    const previous = [...layers].reverse().find(l => !!(annot.compareDocumentPosition(l) & Node.DOCUMENT_POSITION_PRECEDING));
    if (previous) {
      previous.appendChild(annot);
      continue;
    }
    const staff = doc.createElementNS(NS, 'staff');
    staff.setAttribute('n', '1');
    const layer = doc.createElementNS(NS, 'layer');
    layer.setAttribute('n', '1');
    staff.appendChild(layer);
    annot.parentElement!.appendChild(staff);
    layer.appendChild(annot);
  }
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
    } else if (child.kind === ContainerKind.ParatextContainer) {
      walkLinePart(child, parentElement, doc, profile);
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
        } else if (child.kind === ContainerKind.ParatextContainer) {
          walkLinePart(child, parentElement, doc, profile);
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
      if ((d.name === 'Verweis' || d.name === 'LemmatisiertesTextInitium') && d.data) {
        const annot = doc.createElementNS('http://www.music-encoding.org/ns/mei', 'annot');
        annot.setAttribute('type', d.name === 'Verweis' ? 'verweis' : 'initium');
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
      } else if (child.kind === ContainerKind.ParatextContainer) {
        walkLinePart(child, section, doc, profile);
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

  contourLine = zeile.notation === 'adiastematic' && profile.adiastematic !== 'pitch';
  previousPitch = null;

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
      if (contourLine) staff.setAttribute('type', 'adiastematic');
    }
    for (const part of zeile.children ?? []) {
      walkLinePart(part, layer, doc, profile);
    }
    if (profile.voices !== false && layer.parentElement && layer.parentElement.localName === 'staff' && parentElement.localName !== 'layer') {
      walkAdditionalVoices(zeile, layer.parentElement, doc, profile);
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

/**
 * The additional melodies of the syllables of a line (second voice and so on) are written as `<layer n="2">` and so on of the same staff.
 * A syllable of such a layer has no text (the layer 1 syllable holds it), points to that syllable with `@corresp`, and has ids of its own.
 */
function walkAdditionalVoices(zeile: ZeileContainer, staff: Element, doc: Document, profile: MeiMappingProfileV2) {
  const parts = (zeile.children ?? []) as any[];
  const voiceCount = Math.max(0, ...parts.map(p => (p.kind === LinePartKind.Syllable ? (p.additionalMelodies ?? []).length : 0)));
  const savedPrefix = idPrefix;
  const savedContour = contourLine;
  for (let v = 1; v <= voiceCount; v++) {
    const layer = doc.createElementNS('http://www.music-encoding.org/ns/mei', 'layer');
    layer.setAttribute('n', String(v + 1));
    idPrefix = `${savedPrefix}v${v + 1}-`;
    previousPitch = null;
    for (const part of parts) {
      const melody: Spaced | undefined = part.kind === LinePartKind.Syllable ? part.additionalMelodies?.[v - 1] : undefined;
      if (!melody || allNotes(melody).length === 0) continue;
      const before = layer.children.length;
      walkLinePart({ ...part, text: '', notes: melody, additionalMelodies: undefined, syllableType: 'Normal', meiAttrs: undefined }, layer, doc, profile);
      const written = layer.children[before];
      if (written) written.setAttribute('corresp', '#' + savedPrefix + part.uuid);
    }
    if (layer.children.length > 0) staff.appendChild(layer);
  }
  idPrefix = savedPrefix;
  contourLine = savedContour;
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
    // The type of a syllable that is not a normal one (see MeiSyllableTypeRule).
    const typeRule = part.syllableType && part.syllableType !== 'Normal' ? syllableTypeRule(profile, part.syllableType) : undefined;
    let supplied: Element | null = null;
    if (typeRule && typeRule.form !== 'none') {
      if (typeRule.form === 'attribute') {
        if (typeRule.value) syllable.setAttribute('type', typeRule.value);
      } else if (typeRule.form === 'supplied') {
        supplied = doc.createElementNS('http://www.music-encoding.org/ns/mei', 'supplied');
        if (typeRule.value) supplied.setAttribute('type', typeRule.value);
        if (typeRule.reason) supplied.setAttribute('reason', typeRule.reason);
      } else if (typeRule.form === 'gap') {
        const gap = doc.createElementNS('http://www.music-encoding.org/ns/mei', 'gap');
        if (typeRule.value) gap.setAttribute('type', typeRule.value);
        if (typeRule.reason) gap.setAttribute('reason', typeRule.reason);
        syllable.appendChild(gap);
      }
    }
    applyAnnotationAttrs(syllable, mergedAttrs(annotations.syllable.get(part.uuid), part.meiAttrs));

    // syllableText inner tag
    const textRule = profile.entities.syllableText;
    if (textRule.enabled && part.text) {
      const syl = doc.createElementNS('http://www.music-encoding.org/ns/mei', textRule.tag);
      syl.textContent = part.text;
      applyAttributes(syl, textRule, { text: part.text, uuid: part.uuid });
      if (conformant) applyWordPosition(syl, part.text);
      syllable.appendChild(syl);
    }

    // Walk notes under the syllable element
    walkSyllableNotes(part, syllable, doc, profile);

    if (supplied) {
      supplied.appendChild(syllable);
      targetParent.appendChild(supplied);
    } else {
      targetParent.appendChild(syllable);
    }

  } else if (conformant && part.kind === LinePartKind.Box) {
    // A placeholder of the transcription (a place for notes that are not transcribed): an empty space, so comments on it have an anchor.
    const space = doc.createElementNS('http://www.music-encoding.org/ns/mei', 'space');
    space.setAttribute('xml:id', idPrefix + part.uuid);
    parentElement.appendChild(space);

  } else if (conformant && part.kind === LinePartKind.LineChange) {
    // A change of the manuscript's line inside a Monodi line: a line break in the layer at its place.
    if (profile.lineBreaks === false) return;
    const sb = doc.createElementNS('http://www.music-encoding.org/ns/mei', 'sb');
    // Like a page break, a line break can repeat its uuid in Monodi data.
    let sbId = idPrefix + part.uuid;
    for (let k = 2; pageBreakIds.has(sbId); k++) sbId = `${idPrefix}${part.uuid}-${k}`;
    pageBreakIds.add(sbId);
    sb.setAttribute('xml:id', sbId);
    sb.setAttribute('type', 'manuscriptLine');
    parentElement.appendChild(sb);

  } else if (conformant && part.kind === LinePartKind.FolioChange) {
    // A change of manuscript page inside a chant: a page break; the folio text of Monodi (FolioChange.text) is its @label.
    const pb = doc.createElementNS('http://www.music-encoding.org/ns/mei', 'pb');
    let pbId = idPrefix + part.uuid;
    for (let k = 2; pageBreakIds.has(pbId); k++) pbId = `${idPrefix}${part.uuid}-${k}`;
    pageBreakIds.add(pbId);
    pb.setAttribute('xml:id', pbId);
    // @n takes one token only (a folio like "f. 116" has a space), so the full text always goes to @label.
    if (part.text) pb.setAttribute('label', part.text);
    if (part.text && /^\S+$/.test(part.text)) pb.setAttribute('n', part.text);
    parentElement.appendChild(pb);

  } else if (part.kind === ContainerKind.ParatextContainer || (part.text !== undefined && part.paratextType !== undefined)) {
    // ParatextContainer
    const rule = profile.entities.paratext;
    if (!rule.enabled || !part.text) return;

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

/** MEI `accid/@accid` value of the Monodi accidental note types (f flat, n natural, s sharp). */
const ACCIDENTAL_VALUE: { [noteType: string]: string } = { Flat: 'f', Natural: 'n', Sharp: 's' };
/** Conformant structure: `nc/@tilt` (direction of the pen stroke) for the note heads with a stem, as drawn in Monodi-Zero (glyph-paths.ts). */
const STEM_TILT: { [noteType: string]: string } = { Ascending: 'n', Descending: 's' };

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
    let neumeEl: Element | null = null;
    // Accidentals are `accid` children of the syllable, in the sequence of its neumes (see config/mei-body-mapping.yml in CM-hub).
    const accidsBefore: Element[] = [];
    const accidsAfter: Element[] = [];

    if (neumeRule.enabled) {
      // Resolve wrappers outermost-first
      for (const w of neumeRule.wrappers) {
        targetParent = getOrCreateWrapper(targetParent, w, doc);
      }
      const neume = doc.createElementNS('http://www.music-encoding.org/ns/mei', neumeRule.tag);
      applyAttributes(neume, neumeRule, {});
      applyRuleAttributes(neume, patternRule?.neume);
      const firstNote = firstNoteOf(neumeData);
      if (firstNote) applyAnnotationAttrs(neume, mergedAttrs(annotations.neume.get(firstNote.uuid), firstNote.meiNeumeAttrs));
      targetParent.appendChild(neume);
      neumeEl = neume;
      targetParent = neume;
    }

    for (let gIndex = 0; gIndex < neumeData.nonSpaced.length; gIndex++) {
      const groupedData = neumeData.nonSpaced[gIndex];
      if (!groupedData.grouped || groupedData.grouped.length === 0) continue;

      for (let nIndex = 0; nIndex < groupedData.grouped.length; nIndex++) {
        const note = groupedData.grouped[nIndex];

        if (accidAsElement && ACCIDENTAL_VALUE[note.noteType]) {
          // An accidental is not a note of the melody. Monodi does not say which note it affects, and neither does the `accid`:
          // it stands in the syllable where it stands in the sequence, with the pitch position it was written at (ploc/oloc).
          const accid = doc.createElementNS('http://www.music-encoding.org/ns/mei', 'accid');
          accid.setAttribute('xml:id', idPrefix + note.uuid);
          accid.setAttribute('accid', ACCIDENTAL_VALUE[note.noteType]);
          if (note.base) accid.setAttribute('ploc', note.base.toLowerCase());
          if (note.octave !== undefined) accid.setAttribute('oloc', note.octave.toString());
          applyAnnotationAttrs(accid, mergedAttrs(annotations.nc.get(note.uuid), note.meiAttrs));
          (neumeEl && neumeEl.childNodes.length > 0 ? accidsAfter : accidsBefore).push(accid);
          continue;
        }

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

        const pitch = note.octave * 7 + (baseNoteIndexes[note.base] ?? 0);
        if (contourLine) {
          // The notes of an adiastematic line were typed as a contour; the stored pitches are not read from the manuscript.
          nc.removeAttribute('pname');
          nc.removeAttribute('oct');
          if (previousPitch !== null) nc.setAttribute('intm', pitch > previousPitch ? 'u' : pitch < previousPitch ? 'd' : 's');
        }
        previousPitch = pitch;

        for (const fd of flagDefs) applyRuleAttributes(nc, fd.mei);
        if (conformant && STEM_TILT[note.noteType]) nc.setAttribute('tilt', STEM_TILT[note.noteType]);

        // Pattern rule: the rule's nc entry for this note position (never pname/oct).
        applyRuleAttributes(nc, patternRule?.nc[flatIndex]);
        applyAnnotationAttrs(nc, mergedAttrs(annotations.nc.get(note.uuid), note.meiAttrs));
        flatIndex++;

        for (const key of ornaments) {
          const ornamentRule = profile.entities[key];
          if (ornamentRule.enabled) nc.appendChild(doc.createElementNS('http://www.music-encoding.org/ns/mei', ornamentRule.tag));
        }

        noteTargetParent.appendChild(nc);
      }
    }

    if (accidsBefore.length || accidsAfter.length) {
      const holder = neumeEl && neumeEl.parentNode ? neumeEl.parentNode : parentElement;
      for (const a of accidsBefore) holder.insertBefore(a, neumeEl && neumeEl.parentNode === holder ? neumeEl : null);
      const next = neumeEl && neumeEl.parentNode === holder ? neumeEl.nextSibling : null;
      for (const a of accidsAfter) holder.insertBefore(a, next);
    }
    // A unit that held only accidentals or no note at all is not a neume.
    if (neumeEl && neumeEl.childNodes.length === 0 && neumeEl.parentNode) neumeEl.parentNode.removeChild(neumeEl);
  }
}
