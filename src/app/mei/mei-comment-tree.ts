import { RootContainer, ZeileContainer } from '../types/model';

/** Renders the content tree of a critical comment (grid, text, bracket, notes) as MEI elements. Shared by the header and the body of the MEI export. */
export function generateCommentTreeDOM(
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
          const cellResult = generateCommentTreeDOM(cell, doc, commentIndex, noteCounter);
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

/** Appends one <annot> per critical comment (readings, emendations, certainty) to the given <notesStmt>. */
export function appendCommentAnnots(doc: Document, notesStmt: Element, root: RootContainer): void {
        for (let i = 0; i < root.comments.length; i++) {
            const comment = root.comments[i];
            const annot = doc.createElementNS('http://www.music-encoding.org/ns/mei', 'annot');
            annot.setAttribute('startid', '#m-' + comment.startUUID);
            annot.setAttribute('endid', '#m-' + comment.endUUID);
            
            const typeParts: string[] = [];
            if (comment.emendation) {
                typeParts.push('emendation');
            }
            if (comment.intervention) {
                typeParts.push(comment.intervention);
            }
            if (comment.category) {
                typeParts.push('cat:' + comment.category);
            }
            if (typeParts.length > 0) {
                annot.setAttribute('type', typeParts.join(' '));
            }

            if (comment.certainty) {
                annot.setAttribute('cert', comment.certainty);
            }

            let treeResult = { element: null as Element | null, zeilen: [] as { id: string, zeile: ZeileContainer }[] };
            if (comment.tree) {
                const noteCounter = { count: 0 };
                treeResult = generateCommentTreeDOM(comment.tree, doc, i, noteCounter);
            }
            
            // A comment's content is a CommentTree when present; legacy
            // `lines`/`text` are only consulted for truly-legacy comments that
            // have never been migrated (no `tree`).
            const hasMusicalStructure = treeResult.zeilen.length > 0 || (!comment.tree && !!comment.lines && comment.lines.length > 0);
            if (hasMusicalStructure) {
                annot.setAttribute('corresp', '#m-comment-' + i);
            }

            const hasWitnessLabels = comment.readingWitnesses && comment.readingWitnesses.some(w => !!w);
            if (!comment.tree && comment.lines && comment.lines.length > 0 && hasWitnessLabels) {
                for (let j = 0; j < comment.lines.length; j++) {
                    const sig = comment.readingWitnesses?.[j];
                    const ptr = doc.createElementNS('http://www.music-encoding.org/ns/mei', 'ptr');
                    ptr.setAttribute('target', `#m-comment-${i}-reading-${j}`);
                    
                    if (sig) {
                        const slug = sig.toLowerCase().replace(/[^a-z0-9]+/g, '-');
                        const childAnnot = doc.createElementNS('http://www.music-encoding.org/ns/mei', 'annot');
                        childAnnot.setAttribute('source', '#wit-' + slug);
                        childAnnot.appendChild(ptr);
                        annot.appendChild(childAnnot);
                    } else {
                        annot.appendChild(ptr);
                    }
                }
            } else {
                if (treeResult.element) {
                    annot.appendChild(treeResult.element);
                } else if (comment.text) {
                    annot.textContent = comment.text;
                }
            }
            
            notesStmt.appendChild(annot);
        }
}
