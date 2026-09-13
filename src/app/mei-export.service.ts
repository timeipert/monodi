import { Injectable } from '@angular/core';
import { RootContainer, ContainerKind, LinePartKind, ZeileContainer, Syllable, Clef, Note, FormteilContainer, MiscContainer } from './types/model';
import { ProjectSettings, MeiMappingSettings, Document as MonodiDocument } from './api.service';
import { emitMei } from './mei/mei-emitter';
import { defaultMeiProfile } from './mei/mei-mapping.model';
import { FileSystemService } from './file-system.service';

@Injectable({
  providedIn: 'root'
})
export class MeiExportService {
  constructor(private fsService: FileSystemService) {}

  exportToMei(root: RootContainer, settings: ProjectSettings | null, documentMeta?: MonodiDocument, sourceSiglum?: string): string {
    const profile = settings?.meiProfiles?.find(p => p.id === settings.activeMeiProfileId) || defaultMeiProfile();
    return emitMei(root, profile, documentMeta, sourceSiglum);
  }

  /**
   * Retained for reference until v2 has been in production for a release, but no longer called.
   */
  private legacyExport(root: RootContainer, settings: ProjectSettings | null, documentMeta?: MonodiDocument): string {
    const mappings: MeiMappingSettings = settings?.meiMappings || {
      formteilContainer: { tag: 'section' },
      zeileContainer: { tag: 'sb' },
      syllable: { tag: 'syllable', textTag: 'syl' },
      neume: { tag: 'neume' },
      note: {
        tag: 'nc',
        pitchAttr: 'pname',
        octaveAttr: 'oct',
        liquescentAttr: 'curve',
        liquescentValue: 'c',
        connectionAttr: 'con',
        connectionGapValue: 'g'
      },
      clef: {
        tag: 'clef',
        shapeAttr: 'shape',
        lineAttr: 'line',
        defaultLine: '1'
      },
      paratextContainer: { tag: 'dir' },
      oriscus: { tag: 'oriscus' },
      quilisma: { tag: 'quilisma' },
      strophicus: { tag: 'strophicus' },
      liquescentElement: { tag: 'liquescent' }
    };

    const doc = document.implementation.createDocument('http://www.music-encoding.org/ns/mei', 'mei', null);
    const mei = doc.documentElement;
    mei.setAttribute('meiversion', '5.0');
    
    // Add meiHead
    const meiHead = doc.createElementNS('http://www.music-encoding.org/ns/mei', 'meiHead');
    const fileDesc = doc.createElementNS('http://www.music-encoding.org/ns/mei', 'fileDesc');
    const titleStmt = doc.createElementNS('http://www.music-encoding.org/ns/mei', 'titleStmt');
    const title = doc.createElementNS('http://www.music-encoding.org/ns/mei', 'title');
    title.textContent = documentMeta?.dokumenten_id || 'Exported from Monodi+';
    titleStmt.appendChild(title);
    fileDesc.appendChild(titleStmt);
    
    const pubStmt = doc.createElementNS('http://www.music-encoding.org/ns/mei', 'pubStmt');
    fileDesc.appendChild(pubStmt);
    
    if (documentMeta && documentMeta.kommentar) {
        const notesStmt = doc.createElementNS('http://www.music-encoding.org/ns/mei', 'notesStmt');
        const annot = doc.createElementNS('http://www.music-encoding.org/ns/mei', 'annot');
        annot.textContent = documentMeta.kommentar;
        notesStmt.appendChild(annot);
        fileDesc.appendChild(notesStmt);
    } else if (root.comments && root.comments.length > 0) {
        // Create an empty notesStmt if we need it for comments but didn't have a document metadata kommentar
        const notesStmt = doc.createElementNS('http://www.music-encoding.org/ns/mei', 'notesStmt');
        fileDesc.appendChild(notesStmt);
    }
    
    // Inject the inline comments into notesStmt
    if (root.comments && root.comments.length > 0) {
        let notesStmt = fileDesc.getElementsByTagNameNS('http://www.music-encoding.org/ns/mei', 'notesStmt')[0];
        if (!notesStmt) {
            notesStmt = doc.createElementNS('http://www.music-encoding.org/ns/mei', 'notesStmt');
            fileDesc.appendChild(notesStmt);
        }
        for (let i = 0; i < root.comments.length; i++) {
            const comment = root.comments[i];
            const annot = doc.createElementNS('http://www.music-encoding.org/ns/mei', 'annot');
            annot.setAttribute('startid', '#m-' + comment.startUUID);
            annot.setAttribute('endid', '#m-' + comment.endUUID);
            if (comment.emendation) {
                annot.setAttribute('type', 'emendation');
            }
            let treeResult = { element: null as Element | null, zeilen: [] as { id: string, zeile: ZeileContainer }[] };
            if (comment.tree) {
                const noteCounter = { count: 0 };
                treeResult = this.generateCommentTreeDOM(comment.tree, doc, i, noteCounter);
            }
            
            // Tree is the source of truth when present; legacy `lines` are
            // only consulted for comments that were never migrated.
            const hasMusicalStructure = treeResult.zeilen.length > 0 || (!comment.tree && !!comment.lines && comment.lines.length > 0);
            if (hasMusicalStructure) {
                annot.setAttribute('corresp', '#m-comment-' + i);
            }

            if (treeResult.element) {
                annot.appendChild(treeResult.element);
            } else if (comment.text) {
                annot.textContent = comment.text;
            }
            
            notesStmt.appendChild(annot);
        }
    }
    
    meiHead.appendChild(fileDesc);
    
    // Add workList for textinitium and classification
    if (documentMeta && (documentMeta.textinitium || documentMeta.gattung1 || documentMeta.gattung2 || documentMeta.festtag || documentMeta.feier)) {
        const workList = doc.createElementNS('http://www.music-encoding.org/ns/mei', 'workList');
        const work = doc.createElementNS('http://www.music-encoding.org/ns/mei', 'work');
        
        if (documentMeta.textinitium) {
            const workTitle = doc.createElementNS('http://www.music-encoding.org/ns/mei', 'title');
            workTitle.textContent = documentMeta.textinitium;
            work.appendChild(workTitle);
        }
        
        if (documentMeta.gattung1 || documentMeta.gattung2 || documentMeta.festtag || documentMeta.feier) {
            const classification = doc.createElementNS('http://www.music-encoding.org/ns/mei', 'classification');
            const termList = doc.createElementNS('http://www.music-encoding.org/ns/mei', 'termList');
            
            const addTerm = (termText: string, type: string) => {
                if (termText) {
                    const term = doc.createElementNS('http://www.music-encoding.org/ns/mei', 'term');
                    term.setAttribute('type', type);
                    term.textContent = termText;
                    termList.appendChild(term);
                }
            };
            
            addTerm(documentMeta.gattung1, 'gattung1');
            addTerm(documentMeta.gattung2, 'gattung2');
            addTerm(documentMeta.festtag, 'festtag');
            addTerm(documentMeta.feier, 'feier');
            
            classification.appendChild(termList);
            work.appendChild(classification);
        }
        
        workList.appendChild(work);
        meiHead.appendChild(workList);
    }
    
    mei.appendChild(meiHead);

    // Add music -> body -> mdiv -> score -> section
    const music = doc.createElementNS('http://www.music-encoding.org/ns/mei', 'music');
    const body = doc.createElementNS('http://www.music-encoding.org/ns/mei', 'body');
    const mdiv = doc.createElementNS('http://www.music-encoding.org/ns/mei', 'mdiv');
    mdiv.setAttribute('type', 'main');
    const score = doc.createElementNS('http://www.music-encoding.org/ns/mei', 'score');
    
    const scoreDef = doc.createElementNS('http://www.music-encoding.org/ns/mei', 'scoreDef');
    score.appendChild(scoreDef);
    
    const section = doc.createElementNS('http://www.music-encoding.org/ns/mei', mappings.formteilContainer?.tag || 'section');
    section.setAttribute('xml:id', 'm-' + root.uuid);
    
    this.processRoot(root, section, doc, mappings);

    score.appendChild(section);
    mdiv.appendChild(score);
    body.appendChild(mdiv);
    
    // Process structural comments into appendixed mdivs
    if (root.comments && root.comments.length > 0) {
        for (let i = 0; i < root.comments.length; i++) {
            const comment = root.comments[i];
            let treeResult = { element: null as Element | null, zeilen: [] as { id: string, zeile: ZeileContainer }[] };
            if (comment.tree) {
                const noteCounter = { count: 0 };
                treeResult = this.generateCommentTreeDOM(comment.tree, doc, i, noteCounter);
            }
            
            const hasMusicalStructure = treeResult.zeilen.length > 0 || (!comment.tree && !!comment.lines && comment.lines.length > 0);

            if (hasMusicalStructure) {
                const commentMdiv = doc.createElementNS('http://www.music-encoding.org/ns/mei', 'mdiv');
                commentMdiv.setAttribute('type', 'commentary');
                commentMdiv.setAttribute('xml:id', 'm-comment-' + i);

                const commentScore = doc.createElementNS('http://www.music-encoding.org/ns/mei', 'score');
                const commentScoreDef = doc.createElementNS('http://www.music-encoding.org/ns/mei', 'scoreDef');
                commentScore.appendChild(commentScoreDef);

                if (!comment.tree && comment.lines && comment.lines.length > 0) {
                    const commentSection = doc.createElementNS('http://www.music-encoding.org/ns/mei', mappings.formteilContainer?.tag || 'section');
                    let currentStaff: Element | null = null;
                    let currentLayer: Element | null = null;
                    for (const child of comment.lines) {
                        if (child.kind === ContainerKind.FormteilContainer) {
                            this.processFormteil(child, commentSection, doc, mappings);
                        } else if (child.kind === ContainerKind.ZeileContainer) {
                            if (!currentStaff) {
                              currentStaff = doc.createElementNS('http://www.music-encoding.org/ns/mei', 'staff');
                              currentStaff.setAttribute('n', '1');
                              currentLayer = doc.createElementNS('http://www.music-encoding.org/ns/mei', 'layer');
                              currentLayer.setAttribute('n', '1');
                              currentStaff.appendChild(currentLayer);
                              commentSection.appendChild(currentStaff);
                            }
                            this.processZeile(child, currentLayer!, doc, mappings);
                        }
                    }
                    commentScore.appendChild(commentSection);
                }
                
                if (treeResult.zeilen.length > 0) {
                    for (const zItem of treeResult.zeilen) {
                        const ptrSection = doc.createElementNS('http://www.music-encoding.org/ns/mei', mappings.formteilContainer?.tag || 'section');
                        ptrSection.setAttribute('xml:id', zItem.id);
                        const currentStaff = doc.createElementNS('http://www.music-encoding.org/ns/mei', 'staff');
                        currentStaff.setAttribute('n', '1');
                        const currentLayer = doc.createElementNS('http://www.music-encoding.org/ns/mei', 'layer');
                        currentLayer.setAttribute('n', '1');
                        currentStaff.appendChild(currentLayer);
                        ptrSection.appendChild(currentStaff);
                        
                        this.processZeile(zItem.zeile, currentLayer, doc, mappings);
                        commentScore.appendChild(ptrSection);
                    }
                }
                
                commentMdiv.appendChild(commentScore);
                body.appendChild(commentMdiv);
            }
        }
    }
    music.appendChild(body);
    mei.appendChild(music);

    const serializer = new XMLSerializer();
    let xmlString = serializer.serializeToString(mei);
    // Remove the namespace from inner elements if it's redundant, but standard serialize keeps it cleaner if done right.
    // The user requested a specific header format:
    
    const header = `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<?xml-model href="https://music-encoding.org/schema/dev/mei-Neumes.rng" type="application/xml" schematypens="http://relaxng.org/ns/structure/1.0"?>\n` +
      `<?xml-model href="https://music-encoding.org/schema/dev/mei-Neumes.rng" type="application/xml" schematypens="http://purl.oclc.org/dsdl/schematron"?>\n`;
    
    return header + xmlString;
  }

  private processRoot(root: RootContainer, parent: Element, doc: Document, mappings: MeiMappingSettings) {
    if (!root.children) return;
    
    for (const child of root.children) {
      if (child.kind === ContainerKind.FormteilContainer) {
        this.processFormteil(child, parent, doc, mappings);
      } else if (child.kind === ContainerKind.MiscContainer) {
        this.processMisc(child, parent, doc, mappings);
      }
    }
  }

  private processMisc(misc: MiscContainer, parentSection: Element, doc: Document, mappings: MeiMappingSettings) {
    if (!misc.children) return;
    
    let currentStaff: Element | null = null;
    let currentLayer: Element | null = null;

    for (const child of misc.children) {
        if (child.kind === ContainerKind.ZeileContainer) {
            if (!currentStaff) {
              currentStaff = doc.createElementNS('http://www.music-encoding.org/ns/mei', 'staff');
              currentStaff.setAttribute('n', '1');
              currentLayer = doc.createElementNS('http://www.music-encoding.org/ns/mei', 'layer');
              currentLayer.setAttribute('n', '1');
              currentStaff.appendChild(currentLayer);
              parentSection.appendChild(currentStaff);
            }
            this.processZeile(child, currentLayer!, doc, mappings);
        }
    }
  }

  private processFormteil(formteil: FormteilContainer, parentSection: Element, doc: Document, mappings: MeiMappingSettings) {
    const section = doc.createElementNS('http://www.music-encoding.org/ns/mei', mappings.formteilContainer?.tag || 'section');
    section.setAttribute('xml:id', 'm-' + formteil.uuid);
    
    if (formteil.data) {
      for (const d of formteil.data) {
        if (d.name === 'Signatur' && d.data) {
          section.setAttribute('label', d.data);
        } else if (d.name === 'LemmatisiertesTextInitium' && d.data) {
          section.setAttribute('n', d.data);
        } else if (d.name === 'Status' && d.data) {
          section.setAttribute('type', d.data);
        } else if (d.name === 'Verweis' && d.data) {
          const annot = doc.createElementNS('http://www.music-encoding.org/ns/mei', 'annot');
          annot.setAttribute('type', 'verweis');
          annot.textContent = d.data;
          section.appendChild(annot);
        }
      }
    }

    if (!formteil.children) {
      parentSection.appendChild(section);
      return;
    }
    
    let currentStaff: Element | null = null;
    let currentLayer: Element | null = null;

    for (const child of formteil.children) {
      if (child.kind === ContainerKind.FormteilContainer) {
        this.processFormteil(child, section, doc, mappings);
      } else if (child.kind === ContainerKind.ZeileContainer) {
        if (!currentStaff) {
          currentStaff = doc.createElementNS('http://www.music-encoding.org/ns/mei', 'staff');
          currentStaff.setAttribute('n', '1');
          currentLayer = doc.createElementNS('http://www.music-encoding.org/ns/mei', 'layer');
          currentLayer.setAttribute('n', '1');
          currentStaff.appendChild(currentLayer);
          section.appendChild(currentStaff);
        }
        this.processZeile(child, currentLayer!, doc, mappings);
      }
    }
    
    parentSection.appendChild(section);
  }

  private processZeile(zeile: ZeileContainer, layer: Element, doc: Document, mappings: MeiMappingSettings) {
    const sb = doc.createElementNS('http://www.music-encoding.org/ns/mei', mappings.zeileContainer?.tag || 'sb');
    sb.setAttribute('xml:id', 'm-' + zeile.uuid);
    layer.appendChild(sb);

    if (!zeile.children) return;
    for (const part of zeile.children) {
      if (part.kind === LinePartKind.Clef) {
        const clefTag = mappings.clef?.tag || 'clef';
        const clef = doc.createElementNS('http://www.music-encoding.org/ns/mei', clefTag);
        clef.setAttribute('xml:id', 'm-' + part.uuid);
        
        const shapeAttr = mappings.clef?.shapeAttr || 'shape';
        if (shapeAttr) {
          if (part.shape) {
            clef.setAttribute(shapeAttr, part.shape.toUpperCase());
          } else {
            clef.setAttribute(shapeAttr, 'C');
          }
        }
        
        const lineAttr = mappings.clef?.lineAttr || 'line';
        if (lineAttr) {
          clef.setAttribute(lineAttr, mappings.clef?.defaultLine || '1');
        }
        
        layer.appendChild(clef);
      } else if (part.kind === LinePartKind.Syllable) {
        this.processSyllable(part, layer, doc, mappings);
      }
    }
  }

  private processSyllable(syllable: Syllable, layer: Element, doc: Document, mappings: MeiMappingSettings) {
    const meiSyllable = doc.createElementNS('http://www.music-encoding.org/ns/mei', mappings.syllable?.tag || 'syllable');
    meiSyllable.setAttribute('xml:id', 'm-' + syllable.uuid);
    
    if (syllable.text) {
      const sylTag = mappings.syllable?.textTag || 'syl';
      const syl = doc.createElementNS('http://www.music-encoding.org/ns/mei', sylTag);
      syl.textContent = syllable.text;
      meiSyllable.appendChild(syl);
    }

    if (syllable.notes && syllable.notes.spaced) {
      // syllable.notes.spaced is an array of NonSpaced.
      // Each NonSpaced corresponds to exactly one <neume> element!
      const spacedArrL = syllable.notes.spaced;
      // A graphical gap (space) is the boundary BETWEEN spaced units, so con="g"
      // ("gapped") belongs on the last note of a spaced unit that is followed by
      // another non-empty unit — e.g. "a bc" → the 'a' nc gets con="g".
      let lastNonEmptySpacedL = -1;
      for (let s = spacedArrL.length - 1; s >= 0; s--) {
        if (spacedArrL[s].nonSpaced && spacedArrL[s].nonSpaced.some((ns: any) => ns.grouped && ns.grouped.length > 0)) { lastNonEmptySpacedL = s; break; }
      }
      for (let sIndex = 0; sIndex < spacedArrL.length; sIndex++) {
        const neumeData = spacedArrL[sIndex];
        if (!neumeData.nonSpaced || neumeData.nonSpaced.length === 0) continue;

        let lastGroupIdxL = -1;
        for (let g = neumeData.nonSpaced.length - 1; g >= 0; g--) {
          if (neumeData.nonSpaced[g].grouped && neumeData.nonSpaced[g].grouped.length > 0) { lastGroupIdxL = g; break; }
        }

        const neumeTag = mappings.neume?.tag || 'neume';
        const neume = doc.createElementNS('http://www.music-encoding.org/ns/mei', neumeTag);
        
        // neumeData.nonSpaced is an array of Grouped.
        // Different Grouped arrays inside the same NonSpaced are separated by ONE space (con="g").
        for (let gIndex = 0; gIndex < neumeData.nonSpaced.length; gIndex++) {
          const groupedData = neumeData.nonSpaced[gIndex];
          
          if (!groupedData.grouped || groupedData.grouped.length === 0) continue;
          
          for (let nIndex = 0; nIndex < groupedData.grouped.length; nIndex++) {
            const note = groupedData.grouped[nIndex];
            
            let ncTag = mappings.note?.tag || 'nc';
            
            // Handle special signs based on NoteType
            if (note.noteType === 'Oriscus') {
                ncTag = mappings.oriscus?.tag || 'oriscus';
            } else if (note.noteType === 'Quilisma') {
                ncTag = mappings.quilisma?.tag || 'quilisma';
            } else if (note.noteType === 'Strophicus') {
                ncTag = mappings.strophicus?.tag || 'strophicus';
            } else if (note.noteType === 'Liquescent' || note.liquescent) {
                ncTag = mappings.liquescentElement?.tag || 'liquescent';
            }
            
            const nc = doc.createElementNS('http://www.music-encoding.org/ns/mei', ncTag);
            nc.setAttribute('xml:id', 'm-' + note.uuid);
            
            const pitchAttr = mappings.note?.pitchAttr || 'pname';
            if (pitchAttr && note.base) {
              nc.setAttribute(pitchAttr, note.base.toLowerCase());
            }
            
            const octaveAttr = mappings.note?.octaveAttr || 'oct';
            if (octaveAttr && note.octave !== undefined) {
              nc.setAttribute(octaveAttr, note.octave.toString());
            }
            
            const liquescentAttr = mappings.note?.liquescentAttr || 'curve';
            if (liquescentAttr && note.liquescent && ncTag !== mappings.liquescentElement?.tag) {
               const liquescentValue = mappings.note?.liquescentValue || 'c';
               nc.setAttribute(liquescentAttr, liquescentValue);
            }
            
            // Graphical connection ("gapped"): the last note of a spaced unit
            // that is followed by another unit gets con="g".
            if ((gIndex === lastGroupIdxL && nIndex === groupedData.grouped.length - 1) && sIndex < lastNonEmptySpacedL) {
                const connectionAttr = mappings.note?.connectionAttr || 'con';
                const gapValue = mappings.note?.connectionGapValue || 'g';
                if (connectionAttr) {
                    nc.setAttribute(connectionAttr, gapValue);
                }
            }
            
            neume.appendChild(nc);
          }
        }
        
        meiSyllable.appendChild(neume);
      }
    }

    layer.appendChild(meiSyllable);
  }

  async exportAndDownload(root: RootContainer, filename: string = 'export.mei', settings: ProjectSettings | null = null, documentMeta?: MonodiDocument, sourceSiglum?: string) {
    const xml = this.exportToMei(root, settings, documentMeta, sourceSiglum);
    await this.fsService.saveFile(xml, {
      suggestedName: filename,
      types: [{
        description: 'MEI XML File',
        accept: { 'application/xml': ['.mei', '.xml'] }
      }],
      fallbackMimeType: 'application/xml;charset=utf-8'
    });
  }

  private generateCommentTreeDOM(
    tree: any, 
    doc: Document, 
    commentIndex: number, 
    noteCounter: { count: number }
  ): { element: Element | null, zeilen: { id: string, zeile: ZeileContainer }[] } {
    if (!tree) return { element: null, zeilen: [] };
    if (tree.kind === "CommentTreeUndecided") return { element: null, zeilen: [] };
    
    if (tree.kind === "CommentTreeGrid") {
      const table = doc.createElementNS('http://www.music-encoding.org/ns/mei', 'table');
      let zeilen: { id: string, zeile: ZeileContainer }[] = [];
      if (tree.items) {
        for (const row of tree.items) {
          const tr = doc.createElementNS('http://www.music-encoding.org/ns/mei', 'tr');
          for (const cell of row) {
            const td = doc.createElementNS('http://www.music-encoding.org/ns/mei', 'td');
            const cellResult = this.generateCommentTreeDOM(cell, doc, commentIndex, noteCounter);
            if (cellResult.element) {
              td.appendChild(cellResult.element);
            }
            tr.appendChild(td);
            zeilen.push(...cellResult.zeilen);
          }
          table.appendChild(tr);
        }
      }
      return { element: table, zeilen };
    }
    
    if (tree.kind === "CommentTreeLeaf") {
      if (tree.content) {
        if (tree.content.kind === "Text") {
          // td can contain text directly, so we just return a temporary span which MEI can't use directly, 
          // wait! Actually we can just create a text node.
          // Since Element | null is expected, we can create a generic text wrapper or just return text node
          // Wait, typescript Element doesn't include TextNode. I'll return a <rend> element since mei allows <rend> in td.
          const rend = doc.createElementNS('http://www.music-encoding.org/ns/mei', 'rend');
          rend.textContent = tree.content.content;
          return { element: rend, zeilen: [] };
        } else if (tree.content.kind === "Bracket") {
          const rend = doc.createElementNS('http://www.music-encoding.org/ns/mei', 'rend');
          rend.textContent = ']';
          return { element: rend, zeilen: [] };
        } else if (tree.content.kind === "Notes") {
          const id = `m-comment-${commentIndex}-notes-${noteCounter.count++}`;
          const ptr = doc.createElementNS('http://www.music-encoding.org/ns/mei', 'ptr');
          ptr.setAttribute('target', '#' + id);
          return { 
            element: ptr, 
            zeilen: [{ id, zeile: tree.content.content }] 
          };
        }
      }
    }
    return { element: null, zeilen: [] };
  }
}
