import { RootContainer } from '../types/model';
import { Document as MonodiDocument, Source, PublicationSettings } from '../api.service';
import { appendCommentAnnots } from './mei-comment-tree';
import { buildMappedHead } from './mei-header-mapped';
import { HeaderLevel } from './metadata-mapping.model';

/**
 * Metadata header (<meiHead>) of the MEI export.
 *
 * - Level 1 (Minimal) is the baseline header of Monodi-Zero 0.9.1 and must stay byte-identical.
 * - Levels 2 (Standard) and 3 (Extended) are driven by the shared mapping
 *   (CM-hub/config/metadata-mapping.yml, generated into metadata-mapping.generated.ts); see mei-header-mapped.ts.
 *
 * Explanation for newcomers: CM-hub/docs/METADATA-STANDARDS.md.
 */
export interface MeiHeaderContext {
  root: RootContainer;
  documentMeta?: MonodiDocument;
  /** The source the document belongs to, if known. */
  sourceMeta?: Source;
  sourceSiglum?: string;
  publication?: PublicationSettings;
  level: HeaderLevel;
  /** Export time; injectable so tests are deterministic. */
  now?: Date;
  appVersion?: string;
}

export function buildMeiHead(doc: Document, ctx: MeiHeaderContext): Element {
  return ctx.level <= 1 ? buildBaselineHead(doc, ctx) : buildMappedHead(doc, ctx);
}

/** Baseline header (level 1): exactly what Monodi-Zero 0.9.1 wrote. Do not change its output; see docs/METADATA-STANDARDS.md, rule 9. */
function buildBaselineHead(doc: Document, ctx: MeiHeaderContext): Element {
  const { root, documentMeta, sourceSiglum } = ctx;
    const meiHead = doc.createElementNS('http://www.music-encoding.org/ns/mei', 'meiHead');
    const fileDesc = doc.createElementNS('http://www.music-encoding.org/ns/mei', 'fileDesc');
    const titleStmt = doc.createElementNS('http://www.music-encoding.org/ns/mei', 'titleStmt');
    const title = doc.createElementNS('http://www.music-encoding.org/ns/mei', 'title');
    title.textContent = documentMeta?.dokumenten_id || 'Exported from Monodi+';
    titleStmt.appendChild(title);
    fileDesc.appendChild(titleStmt);
    
    const pubStmt = doc.createElementNS('http://www.music-encoding.org/ns/mei', 'pubStmt');
    fileDesc.appendChild(pubStmt);

    // Collect all distinct sigla
    const siglaSet = new Set<string>();
    if (sourceSiglum) {
        siglaSet.add(sourceSiglum);
    }
    if (root.comments) {
        root.comments.forEach(c => {
            if (c && c.readingWitnesses) {
                c.readingWitnesses.forEach(sig => {
                    if (sig) siglaSet.add(sig);
                });
            }
        });
    }

    if (siglaSet.size > 0) {
        const sourceDesc = doc.createElementNS('http://www.music-encoding.org/ns/mei', 'sourceDesc');
        Array.from(siglaSet).sort().forEach(sig => {
            const slug = sig.toLowerCase().replace(/[^a-z0-9]+/g, '-');
            const sourceEl = doc.createElementNS('http://www.music-encoding.org/ns/mei', 'source');
            sourceEl.setAttribute('xml:id', 'wit-' + slug);
            const identifier = doc.createElementNS('http://www.music-encoding.org/ns/mei', 'identifier');
            identifier.textContent = sig;
            sourceEl.appendChild(identifier);
            sourceDesc.appendChild(sourceEl);
        });
        fileDesc.appendChild(sourceDesc);
    }
    
    if (documentMeta && documentMeta.kommentar) {
        const notesStmt = doc.createElementNS('http://www.music-encoding.org/ns/mei', 'notesStmt');
        const annot = doc.createElementNS('http://www.music-encoding.org/ns/mei', 'annot');
        annot.textContent = documentMeta.kommentar;
        notesStmt.appendChild(annot);
        fileDesc.appendChild(notesStmt);
    } else if (root.comments && root.comments.length > 0) {
        const notesStmt = doc.createElementNS('http://www.music-encoding.org/ns/mei', 'notesStmt');
        fileDesc.appendChild(notesStmt);
    }
    
    if (root.comments && root.comments.length > 0) {
        let notesStmt = fileDesc.getElementsByTagNameNS('http://www.music-encoding.org/ns/mei', 'notesStmt')[0];
        if (!notesStmt) {
            notesStmt = doc.createElementNS('http://www.music-encoding.org/ns/mei', 'notesStmt');
            fileDesc.appendChild(notesStmt);
        }
        appendCommentAnnots(doc, notesStmt, root);
    }
    
    meiHead.appendChild(fileDesc);
    
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
  return meiHead;
}
