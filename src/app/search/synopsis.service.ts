import { Injectable } from '@angular/core';
import { Subject, forkJoin, Subscription } from 'rxjs';
import { ToastrService } from 'ngx-toastr';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { APIService, Document, ProjectSettings } from '../api.service';
import { UserService, User } from '../user.service';
import { textWidth } from '../../utils';
import * as VM from '../types/model';

export interface AlignedLineElement {
  kind: 'clef' | 'syllable' | 'placeholder';
  element: VM.Syllable | VM.Clef | null;
}

export interface AlignedNode {
  kind: 'container' | 'leaf';
  level: number;
  signature: string;
  /** Structural index path of this node, e.g. "1-1-2" (1-based). */
  path?: string;
  containers: (VM.FormteilContainer | null)[];
  children: AlignedNode[];
  items: (VM.FormteilChildren | null)[];
  alignedLineElements?: AlignedLineElement[][];
}

function extractFlatElements(root: VM.RootContainer): (VM.Clef | VM.Syllable)[] {
  const result: (VM.Clef | VM.Syllable)[] = [];
  
  const walk = (node: any) => {
    if (!node) return;
    if (node.kind === 'Clef' || node.kind === 'Syllable') {
      result.push(node);
    } else if (Array.isArray(node)) {
      node.forEach(walk);
    } else if (node.children && Array.isArray(node.children)) {
      walk(node.children);
      for (const key of Object.keys(node)) {
        if (key !== 'children' && typeof node[key] === 'object') {
          walk(node[key]);
        }
      }
    } else if (typeof node === 'object') {
      if (node.children && Array.isArray(node.children)) {
        walk(node.children);
      } else {
        for (const key of Object.keys(node)) {
          if (typeof node[key] === 'object') {
            walk(node[key]);
          }
        }
      }
    }
  };
  
  walk(root.children);
  return result;
}

function needlemanWunschProfile(
  alignedCols: AlignedLineElement[][],
  seq2: (VM.Clef | VM.Syllable)[],
  docLimit: number,
  mode: 'melody' | 'text' = 'melody'
): { aligned1: (AlignedLineElement[] | null)[]; aligned2: (VM.Clef | VM.Syllable | null)[] } {
  const M = alignedCols.length;
  const N = seq2.length;
  const GAP_PENALTY = -1;

  const scoreFnSingle = (el1: VM.Clef | VM.Syllable, el2: VM.Clef | VM.Syllable): number => {
    if (el1.kind !== el2.kind) return -3;
    if (el1.kind === 'Clef') {
      const c1 = el1 as VM.Clef;
      const c2 = el2 as VM.Clef;
      return c1.shape === c2.shape ? 2 : 0;
    } else {
      const s1 = el1 as VM.Syllable;
      const s2 = el2 as VM.Syllable;
      const t1 = (s1.text || '').trim().toLowerCase();
      const t2 = (s2.text || '').trim().toLowerCase();

      const spaced1 = s1.notes?.spaced ?? [];
      const pitches1: string[] = [];
      spaced1.forEach(ns => (ns.nonSpaced ?? []).forEach(g => (g.grouped ?? []).forEach(n => pitches1.push(n.base))));
      
      const spaced2 = s2.notes?.spaced ?? [];
      const pitches2: string[] = [];
      spaced2.forEach(ns => (ns.nonSpaced ?? []).forEach(g => (g.grouped ?? []).forEach(n => pitches2.push(n.base))));
      
      const pitchString1 = pitches1.join(',');
      const pitchString2 = pitches2.join(',');

      if (mode === 'text') {
        if (t1 && t2) {
          if (t1 === t2) return 4;
          if (t1.length > 1 && t2.length > 1 && (t1.includes(t2) || t2.includes(t1))) return 3;
          let d = 0;
          let p1 = 0, p2 = 0;
          while (p1 < t1.length && p2 < t2.length) {
            if (t1[p1] !== t2[p2]) {
              d++;
              if (t1.length > t2.length) p1++;
              else if (t2.length > t1.length) p2++;
              else { p1++; p2++; }
            } else {
              p1++; p2++;
            }
          }
          d += (t1.length - p1) + (t2.length - p2);
          if (d <= 1) return 3;
        }
        if (pitchString1 && pitchString2 && pitchString1 === pitchString2) {
          return 1;
        }
        return 0;
      } else {
        if (pitchString1 && pitchString2 && pitchString1 === pitchString2) {
          return 4;
        }
        if (pitches1.length > 0 && pitches2.length > 0 && Math.abs(pitches1.length - pitches2.length) <= 1) {
          let matches = 0;
          for (const p of pitches1) {
            if (pitches2.includes(p)) matches++;
          }
          if (matches >= Math.max(pitches1.length, pitches2.length) - 1) {
            return 2;
          }
        }
        if (t1 && t2 && t1 === t2) {
          return 1;
        }
        return 0;
      }
    }
  };

  const scoreFnProfile = (col: AlignedLineElement[], el2: VM.Clef | VM.Syllable): number => {
    let maxScore = -999;
    let hasComparison = false;
    for (let d = 0; d < docLimit; d++) {
      const el1 = col[d]?.element;
      if (el1) {
        const s = scoreFnSingle(el1, el2);
        if (s > maxScore) {
          maxScore = s;
        }
        hasComparison = true;
      }
    }
    return hasComparison ? maxScore : GAP_PENALTY;
  };

  const dp: number[][] = Array.from({ length: M + 1 }, () => Array(N + 1).fill(0));
  for (let i = 0; i <= M; i++) dp[i][0] = i * GAP_PENALTY;
  for (let j = 0; j <= N; j++) dp[0][j] = j * GAP_PENALTY;

  for (let i = 1; i <= M; i++) {
    for (let j = 1; j <= N; j++) {
      const match = dp[i - 1][j - 1] + scoreFnProfile(alignedCols[i - 1], seq2[j - 1]);
      const deleteScore = dp[i - 1][j] + GAP_PENALTY;
      const insertScore = dp[i][j - 1] + GAP_PENALTY;
      dp[i][j] = Math.max(match, deleteScore, insertScore);
    }
  }

  const aligned1: (AlignedLineElement[] | null)[] = [];
  const aligned2: (VM.Clef | VM.Syllable | null)[] = [];
  let i = M;
  let j = N;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0) {
      const score = scoreFnProfile(alignedCols[i - 1], seq2[j - 1]);
      if (dp[i][j] === dp[i - 1][j - 1] + score) {
        aligned1.unshift(alignedCols[i - 1]);
        aligned2.unshift(seq2[j - 1]);
        i--;
        j--;
        continue;
      }
    }
    if (i > 0 && (j === 0 || dp[i][j] === dp[i - 1][j] + GAP_PENALTY)) {
      aligned1.unshift(alignedCols[i - 1]);
      aligned2.unshift(null);
      i--;
    } else {
      aligned1.unshift(null);
      aligned2.unshift(seq2[j - 1]);
      j--;
    }
  }

  return { aligned1, aligned2 };
}

@Injectable({
  providedIn: 'root'
})
export class SynopsisService {
  alignedTree: AlignedNode[] = [];
  docSigles: { [docId: string]: string } = {};
  alignmentMode: 'signature' | 'structure' | 'sequential' | 'melody' | 'text' = 'signature';
  showConsensusText = false;
  showSingleLineSynopsis = true;
  chunkedMelodyRows: AlignedLineElement[][][] = [];
  /** Within-segment alignment basis for structure/sequential modes. */
  segmentAlignBy: 'melody' | 'text' = 'melody';
  cachedRootContainers: VM.RootContainer[] = [];
  cachedDocIds: string[] = [];

  user: User | null = null;
  private subs: Subscription[] = [];

  constructor(
    private api: APIService,
    private userService: UserService,
    private toastr: ToastrService
  ) {
    this.subs.push(this.userService.user.subscribe(user => {
      this.user = user;
    }));
  }

  alignNodeChildren(parentNodes: (VM.FormteilContainer | VM.RootContainer | null)[], depth: number, pathPrefix: number[] = []): AlignedNode[] {
    const K = parentNodes.length;

    const childLists: VM.FormteilChildren[][] = parentNodes.map(node => {
      if (!node) return [];
      const result: VM.FormteilChildren[] = [];
      const rawChildren = node.children || [];
      for (const child of rawChildren) {
        if (!child) continue;
        if (child.kind === 'MiscContainer') {
          result.push(...(child.children || []).filter(c => c !== null && c !== undefined));
        } else {
          result.push(child as VM.FormteilChildren);
        }
      }
      return result;
    });

    const leafs: VM.FormteilChildren[][] = childLists.map(list => 
      list.filter(c => c && (c.kind === 'ZeileContainer' || c.kind === 'ParatextContainer'))
    );
    const containers: VM.FormteilContainer[][] = childLists.map(list => 
      list.filter(c => c && c.kind === 'FormteilContainer') as VM.FormteilContainer[]
    );

    const alignedNodes: AlignedNode[] = [];

    const maxLeafCount = Math.max(...leafs.map(l => l.length));
    for (let idx = 0; idx < maxLeafCount; idx++) {
      const items = leafs.map(list => list[idx] || null);
      
      const leafNode: AlignedNode = {
        kind: 'leaf',
        level: depth,
        signature: '',
        path: [...pathPrefix, alignedNodes.length + 1].join('-'),
        containers: [],
        children: [],
        items: items
      };

      const lineElements: (VM.Syllable | VM.Clef)[][] = items.map(item => {
        if (item && item.kind === 'ZeileContainer') {
          return (item.children || []).filter(c => c && (c.kind === 'Syllable' || c.kind === 'Clef')) as (VM.Syllable | VM.Clef)[];
        }
        return [];
      });

      const maxLineElCount = Math.max(...lineElements.map(el => el.length));
      if (maxLineElCount > 0) {
        // Align the segment's syllables/clefs across witnesses with the same
        // Needleman–Wunsch aligner used by the flat melody/text synopsis.
        leafNode.alignedLineElements = this.alignElementSequences(lineElements, this.segmentAlignBy);
      }

      alignedNodes.push(leafNode);
    }

    while (containers.some(list => list.length > 0)) {
      let sig = '';
      for (let docIdx = 0; docIdx < K; docIdx++) {
        if (containers[docIdx].length > 0) {
          const firstContainer = containers[docIdx][0];
          sig = (firstContainer && firstContainer.data || []).find((d: any) => d && d.name === 'Signatur')?.data || '';
          break;
        }
      }

      const matchedContainers: (VM.FormteilContainer | null)[] = [];
      for (let docIdx = 0; docIdx < K; docIdx++) {
        const list = containers[docIdx];
        const idx = list.findIndex(c => {
          const s = (c && c.data || []).find((d: any) => d && d.name === 'Signatur')?.data || '';
          return s === sig;
        });
        if (idx > -1) {
          matchedContainers.push(list[idx]);
          list.splice(idx, 1);
        } else {
          matchedContainers.push(null);
        }
      }

      const childPrefix = [...pathPrefix, alignedNodes.length + 1];
      const subChildren = this.alignNodeChildren(matchedContainers, depth + 1, childPrefix);

      alignedNodes.push({
        kind: 'container',
        level: depth,
        signature: sig,
        path: childPrefix.join('-'),
        containers: matchedContainers,
        children: subChildren,
        items: []
      });
    }

    return alignedNodes;
  }

  /**
   * Signature reference of a container's `Signatur` data field, or ''.
   */
  private signatureOf(c: any): string {
    return String((c && c.data || []).find((d: any) => d && d.name === 'Signatur')?.data ?? '').trim();
  }

  /**
   * Flatten a witness into segments keyed by their *composed* signature
   * reference. A container signed "I" whose signed children are 1, 2, 3 yields
   * references "I-1", "I-2", "I-3" (and deeper). Where a level has no signature,
   * its 1-based position is used so references stay unique. Consecutive lines
   * (ZeileContainers) directly under a container form that container's segment.
   */
  private collectSignatureSegments(root: VM.RootContainer): { ref: string; elements: (VM.Clef | VM.Syllable)[] }[] {
    const out: { ref: string; elements: (VM.Clef | VM.Syllable)[] }[] = [];

    const walk = (node: any, stack: string[]) => {
      if (!node || !node.children) return;
      let pending: (VM.Clef | VM.Syllable)[] = [];
      let idx = 0;
      const flush = () => {
        if (pending.length) {
          out.push({ ref: stack.length ? stack.join('-') : '—', elements: pending });
          pending = [];
        }
      };
      const addLine = (zeile: any) => {
        for (const el of (zeile.children || [])) {
          if (el && (el.kind === 'Syllable' || el.kind === 'Clef')) pending.push(el);
        }
      };
      const handle = (ch: any) => {
        if (!ch) return;
        if (ch.kind === 'ZeileContainer') {
          addLine(ch);
        } else if (ch.kind === 'FormteilContainer') {
          flush();
          idx++;
          walk(ch, [...stack, this.signatureOf(ch) || String(idx)]);
        } else if (ch.kind === 'MiscContainer') {
          (ch.children || []).forEach(handle);
        }
      };
      node.children.forEach(handle);
      flush();
    };

    walk(root, []);
    return out;
  }

  /**
   * Align witnesses by composed signature reference: each segment is matched
   * across pieces by its exact reference (I-1, I-2, …) rather than by tree
   * position, and its lines are aligned within with the melody/text aligner.
   */
  alignBySignature(rootContainers: VM.RootContainer[]): AlignedNode[] {
    const perDoc = rootContainers.map(r => this.collectSignatureSegments(r));

    // Union of references in first-appearance order across all witnesses.
    const order: string[] = [];
    const seen = new Set<string>();
    for (const segs of perDoc) {
      for (const s of segs) {
        if (!seen.has(s.ref)) { seen.add(s.ref); order.push(s.ref); }
      }
    }

    const nodes: AlignedNode[] = [];
    for (const ref of order) {
      const seqs: (VM.Clef | VM.Syllable)[][] = perDoc.map(segs =>
        segs.filter(s => s.ref === ref).reduce((acc, s) => acc.concat(s.elements), [] as (VM.Clef | VM.Syllable)[])
      );
      const node: AlignedNode = {
        kind: 'leaf',
        level: 1,
        signature: ref,
        path: ref,
        containers: [],
        children: [],
        items: [],
      };
      if (Math.max(...seqs.map(s => s.length)) > 0) {
        node.alignedLineElements = this.alignElementSequences(seqs, this.segmentAlignBy);
      }
      nodes.push(node);
    }
    return nodes;
  }

  alignSequential(rootContainers: VM.RootContainer[]): AlignedNode[] {
    const K = rootContainers.length;
    
    const leafs: VM.FormteilChildren[][] = rootContainers.map(root => {
      const result: VM.FormteilChildren[] = [];
      const traverse = (node: any) => {
        if (!node) return;
        if (node.kind === 'ZeileContainer' || node.kind === 'ParatextContainer') {
          result.push(node);
        } else if (node.kind === 'MiscContainer') {
          (node.children || []).forEach((c: any) => traverse(c));
        } else if (node.children) {
          node.children.forEach((c: any) => traverse(c));
        }
      };
      traverse(root);
      return result;
    });

    const alignedNodes: AlignedNode[] = [];
    const maxLeafCount = Math.max(...leafs.map(l => l.length));

    for (let idx = 0; idx < maxLeafCount; idx++) {
      const items = leafs.map(list => list[idx] || null);
      
      const leafNode: AlignedNode = {
        kind: 'leaf',
        level: 1,
        signature: '',
        path: String(idx + 1),
        containers: [],
        children: [],
        items: items
      };

      const lineElements: (VM.Syllable | VM.Clef)[][] = items.map(item => {
        if (item && item.kind === 'ZeileContainer') {
          return (item.children || []).filter(c => c && (c.kind === 'Syllable' || c.kind === 'Clef')) as (VM.Syllable | VM.Clef)[];
        }
        return [];
      });

      const maxLineElCount = Math.max(...lineElements.map(el => el.length));
      if (maxLineElCount > 0) {
        leafNode.alignedLineElements = this.alignElementSequences(lineElements, this.segmentAlignBy);
      }

      alignedNodes.push(leafNode);
    }

    return alignedNodes;
  }

  alignMelody(rootContainers: VM.RootContainer[], mode: 'melody' | 'text' = 'melody'): AlignedLineElement[][] {
    return this.alignElementSequences(rootContainers.map(r => extractFlatElements(r)), mode);
  }

  /**
   * Progressive Needleman–Wunsch alignment of per-document element sequences into
   * aligned columns. Shared by the flat melody/text synopsis and by the
   * within-segment alignment of structure/sequential leaves.
   */
  alignElementSequences(seqs: (VM.Clef | VM.Syllable)[][], mode: 'melody' | 'text' = 'melody'): AlignedLineElement[][] {
    const K = seqs.length;
    if (K === 0) return [];

    const flatSeqs = seqs;
    const seq0 = flatSeqs[0];

    let alignedCols: AlignedLineElement[][] = seq0.map(el => {
      const col: AlignedLineElement[] = Array(K).fill(null).map(() => ({ kind: 'placeholder', element: null }));
      col[0] = { kind: el.kind === 'Clef' ? 'clef' as const : 'syllable' as const, element: el };
      return col;
    });

    for (let docIdx = 1; docIdx < K; docIdx++) {
      const seqi = flatSeqs[docIdx];
      const { aligned1, aligned2 } = needlemanWunschProfile(alignedCols, seqi, docIdx, mode);

      const nextAlignedCols: AlignedLineElement[][] = [];
      for (let idx = 0; idx < aligned1.length; idx++) {
        const existingCol = aligned1[idx];
        const eli = aligned2[idx];

        if (existingCol !== null) {
          if (eli) {
            existingCol[docIdx] = {
              kind: eli.kind === 'Clef' ? 'clef' as const : 'syllable' as const,
              element: eli
            };
          } else {
            existingCol[docIdx] = { kind: 'placeholder', element: null };
          }
          nextAlignedCols.push(existingCol);
        } else {
          const newCol: AlignedLineElement[] = Array(K).fill(null).map(() => ({ kind: 'placeholder', element: null }));
          if (eli) {
            newCol[docIdx] = {
              kind: eli.kind === 'Clef' ? 'clef' as const : 'syllable' as const,
              element: eli
            };
          }
          nextAlignedCols.push(newCol);
        }
      }
      alignedCols = nextAlignedCols;
    }

    return alignedCols;
  }

  enterSynopsis(
    selectedDocs: Document[],
    onShow: (show: boolean) => void,
    onLoading: (loading: boolean) => void,
    onComplete: () => void
  ) {
    if (!this.user || selectedDocs.length < 2) return;

    const token = this.user.token;
    const currentDocIds = selectedDocs.map(d => d.id);
    
    const isCached = currentDocIds.length === this.cachedDocIds.length && 
                     currentDocIds.every((id, idx) => id === this.cachedDocIds[idx]) &&
                     this.cachedRootContainers.length === selectedDocs.length;

    if (isCached) {
      this.deferAlignment(this.cachedRootContainers, onShow, onLoading, onComplete);
      return;
    }

    const notesObservables = selectedDocs.map(d => this.api.getDocumentNotes(token, d.id));
    const sigleObservables = selectedDocs.map(d => this.api.getSigle(token, d.quelle_id));

    forkJoin({
      notes: forkJoin(notesObservables),
      sigles: forkJoin(sigleObservables)
    }).subscribe({
      next: (res: any) => {
        const rootContainers: VM.RootContainer[] = [];
        this.docSigles = {};
        
        for (let i = 0; i < selectedDocs.length; i++) {
          const doc = selectedDocs[i];
          const sigleRes = res.sigles[i];
          this.docSigles[doc.id] = (sigleRes.kind === 'SigleRetrieved') ? sigleRes.sigle : doc.dokumenten_id;
          
          const notesRes = res.notes[i];
          if (notesRes.kind === 'NotesRetrieved') {
            rootContainers.push(notesRes.data);
          } else {
            rootContainers.push({
              kind: VM.ContainerKind.RootContainer,
              uuid: doc.id,
              children: [],
              comments: [],
              documentType: VM.DocumentType.Level1
            });
          }
        }

        this.cachedRootContainers = rootContainers;
        this.cachedDocIds = currentDocIds;

        this.deferAlignment(rootContainers, onShow, onLoading, onComplete);
      },
      error: (err) => {
        console.error('Error entering synopsis:', err);
        onLoading(false);
      }
    });
  }

  exitSynopsis() {
    this.cachedRootContainers = [];
    this.cachedDocIds = [];
    this.alignedTree = [];
    this.chunkedMelodyRows = [];
  }

  /**
   * Run the (potentially heavy) alignment after yielding to the browser, so the
   * loading spinner paints and the click does not appear to freeze the app.
   */
  private deferAlignment(
    rootContainers: VM.RootContainer[],
    onShow: (show: boolean) => void,
    onLoading: (loading: boolean) => void,
    onComplete: () => void
  ): void {
    setTimeout(() => {
      try {
        this.runAlignment(rootContainers);
        onShow(true);
        onComplete();
      } finally {
        onLoading(false);
      }
    }, 0);
  }

  runAlignment(rootContainers: VM.RootContainer[]) {
    if (this.alignmentMode === 'signature') {
      this.alignedTree = this.alignBySignature(rootContainers);
    } else if (this.alignmentMode === 'structure') {
      this.alignedTree = this.alignNodeChildren(rootContainers, 1);
    } else if (this.alignmentMode === 'sequential') {
      this.alignedTree = this.alignSequential(rootContainers);
    } else if (this.alignmentMode === 'melody' || this.alignmentMode === 'text') {
      const melodyCols = this.alignMelody(rootContainers, this.alignmentMode);
      this.chunkedMelodyRows = [];
      if (this.showSingleLineSynopsis) {
        this.chunkedMelodyRows.push(melodyCols);
      } else {
        const chunkSize = 8;
        for (let i = 0; i < melodyCols.length; i += chunkSize) {
          this.chunkedMelodyRows.push(melodyCols.slice(i, i + chunkSize));
        }
      }
    }
  }

  getElementWidth(item: AlignedLineElement): number {
    if (!item || item.kind === 'placeholder' || !item.element) {
      return 0;
    }
    if (item.kind === 'clef') {
      return 35;
    }
    const syl = item.element as VM.Syllable;
    const text = (syl.text || '').trim();
    const textW = this.showConsensusText ? 0 : textWidth(text, 'Times', '15px');
    
    let noteCount = 0;
    const spaced = syl.notes?.spaced || [];
    spaced.forEach(ns => (ns.nonSpaced || []).forEach(g => (g.grouped || []).forEach(() => noteCount++)));
    const notesW = noteCount > 0 ? (noteCount * 14 + 10) : 0;
    
    const minW = this.showConsensusText ? 12 : 30;
    return Math.max(minW, textW, notesW) + 8;
  }

  getColumnWidth(col: AlignedLineElement[], settings: ProjectSettings | null): number {
    if (!col) return 0;
    const scale = settings?.pdfSynopsisScale || 1.0;
    let maxWidth = 0;
    let hasClef = false;
    for (const item of col) {
      if (!item) continue;
      if (item.kind === 'clef') {
        hasClef = true;
      }
      const w = this.getElementWidth(item);
      if (w > maxWidth) {
        maxWidth = w;
      }
    }

    if (this.showConsensusText) {
      const consensusTexts = this.getConsensusSyllableTexts(col);
      let maxConsensusTextW = 0;
      consensusTexts.forEach(txt => {
        const w = textWidth(txt.trim(), 'Times', '15px');
        if (w > maxConsensusTextW) maxConsensusTextW = w;
      });
      maxWidth = Math.max(maxWidth, maxConsensusTextW + 8);
    }

    if (hasClef) {
      return Math.max(35, maxWidth) * scale;
    }
    const minColW = this.showConsensusText ? 12 : 40;
    return Math.max(minColW, maxWidth) * scale;
  }

  hasParatext(items: any[]): boolean {
    return items && items.some(item => item && item.kind === 'ParatextContainer');
  }

  getParatextColumnWidth(node: AlignedNode, settings: ProjectSettings | null): number {
    const scale = settings?.pdfSynopsisScale || 1.0;
    if (!node || !node.items) return 100 * scale;
    let maxWidth = 80;
    for (const item of node.items) {
      if (item && item.kind === 'ParatextContainer' && 'text' in item) {
        const typeStr = item.paratextType || 'Text';
        const textStr = item.text || '';
        const text = `[${typeStr}: ${textStr}]`;
        const w = textWidth(text.trim(), 'Times', '12px') + 20;
        if (w > maxWidth) maxWidth = w;
      }
    }
    return Math.min(400, maxWidth) * scale;
  }

  getPrintDate(): string {
    return new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  }

  getProjectTitle(settings: ProjectSettings | null): string {
    if (settings) {
      if (settings.bibliothek && settings.bibliothek.length > 0) {
        return settings.bibliothek[0];
      }
      if (settings.bibliothekssignatur && settings.bibliothekssignatur.length > 0) {
        return settings.bibliothekssignatur[0];
      }
    }
    return 'Monodi Light Archive';
  }

  hasLineElements(node: AlignedNode, docIdx: number): boolean {
    if (!node.alignedLineElements) return false;
    return node.alignedLineElements.some(col => col[docIdx] && col[docIdx].kind !== 'placeholder' && col[docIdx].element !== null);
  }

  getConsensusSyllableTexts(col: AlignedLineElement[]): string[] {
    if (!col) return [];
    const texts: string[] = [];
    for (const item of col) {
      if (item && item.kind === 'syllable' && item.element && 'text' in item.element) {
        texts.push(item.element.text || '');
      } else {
        texts.push('');
      }
    }

    const nonEmptyTexts = texts.filter(t => t.trim() !== '');
    if (nonEmptyTexts.length === 0) return [''];

    const allIdentical = nonEmptyTexts.every(t => t === nonEmptyTexts[0]);
    if (allIdentical) {
      return [nonEmptyTexts[0]];
    }

    return Array.from(new Set(nonEmptyTexts));
  }

  onSingleLineToggle() {
    // Only melody/text need re-chunking; structural modes just switch layout in
    // the template over the same aligned tree, so no re-alignment is needed.
    if (this.alignmentMode === 'melody' || this.alignmentMode === 'text') {
      this.runAlignment(this.cachedRootContainers);
    }
  }

  async exportSynopsisPDF(selectedDocs: Document[], settings: ProjectSettings | null, visibleSynopsisCols: any[]) {
    this.toastr.info('Generating PDF\u2026', 'Export');
    const root = document.querySelector('.synopsis-view') as HTMLElement;
    if (!root) {
      this.toastr.error('Synopsis element not found');
      return;
    }

    try {
      const showHeader    = !settings || settings.pdfSynopsisShowHeader !== false;
      const showFooter    = !settings || settings.pdfSynopsisShowFooter !== false;
      const showFooterIds = !settings || settings.pdfSynopsisShowFooterIds !== false;
      const showDate      = !settings || settings.pdfSynopsisShowDate !== false;
      const showMeta      = !settings || settings.pdfSynopsisShowHeaderMetadata !== false;

      const PXMM = 25.4 / 96;

      root.querySelectorAll<HTMLElement>('.synopsis-scroll-wrapper').forEach(w => w.scrollLeft = 0);

      let maxRowPx = 0;
      root.querySelectorAll<HTMLElement>('.synopsis-stave-row, .synopsis-consensus-text-row')
        .forEach(row => { maxRowPx = Math.max(maxRowPx, row.scrollWidth); });

      const singleLine = this.showSingleLineSynopsis;
      const margin = 12;

      let pageW: number, pageH: number;
      if (singleLine) {
        pageW = Math.max(297, maxRowPx * PXMM + margin * 2 + 4);
        let rowsMm = 0;
        root.querySelectorAll<HTMLElement>('.synopsis-stave-row, .synopsis-consensus-text-row')
          .forEach(row => { rowsMm += row.offsetHeight * PXMM; });
        const tableMm = showMeta ? (selectedDocs.length + 1) * 5 + 14 : 0;
        pageH = Math.max(120, (showHeader ? 22 : 4) + tableMm + rowsMm + margin * 2 + 20);
      } else {
        pageW = 210; pageH = 297;
      }

      const doc = new jsPDF({
        unit: 'mm',
        format: singleLine ? [pageW, pageH] : 'a4',
        orientation: singleLine ? 'landscape' : 'portrait'
      });
      pageW = doc.internal.pageSize.getWidth();
      pageH = doc.internal.pageSize.getHeight();

      const contentX = margin;
      const contentW = pageW - margin * 2;
      const topY = margin + 5;
      const bottomLimit = pageH - margin - 5;

      const scale = singleLine ? PXMM : Math.min(PXMM, contentW / Math.max(1, maxRowPx));
      const ptOf = (px: number) => Math.max(4, px * scale * (72 / 25.4));

      let y = topY;
      const ensureSpace = (needed: number) => {
        if (y + needed > bottomLimit && y > topY) { doc.addPage(); y = topY; }
      };

      if (showHeader) {
        doc.setFont('times', 'bold');
        doc.setFontSize(16);
        doc.setTextColor(15, 23, 42);
        doc.text('Synoptic Comparison', pageW / 2, y + 2, { align: 'center' });
        doc.setFont('times', 'italic');
        doc.setFontSize(9);
        doc.setTextColor(80, 80, 80);
        const modeLabel = this.alignmentMode.charAt(0).toUpperCase() + this.alignmentMode.slice(1);
        const subParts = [
          `${modeLabel} alignment`,
          `${selectedDocs.length} witness${selectedDocs.length === 1 ? '' : 'es'}`
        ];
        if (showDate) subParts.push(this.getPrintDate());
        doc.text(subParts.join('   \u00b7   '), pageW / 2, y + 7, { align: 'center' });
        doc.setDrawColor(15, 23, 42);
        doc.setLineWidth(0.5);
        doc.line(contentX, y + 10, contentX + contentW, y + 10);
        doc.setLineWidth(0.2);
        doc.line(contentX, y + 11.2, contentX + contentW, y + 11.2);
        y += 17;
      }

      if (showMeta && visibleSynopsisCols.length && selectedDocs.length) {
        doc.setFont('times', 'bold');
        doc.setFontSize(7.5);
        doc.setTextColor(80, 80, 80);
        doc.text('WITNESSES', contentX, y);
        y += 1.5;
        autoTable(doc, {
          head: [visibleSynopsisCols.map(c => c.label)],
          body: selectedDocs.map(d => visibleSynopsisCols.map(c => {
            const val = c.key === 'dokumenten_id'
              ? (this.docSigles[d.id] || d.dokumenten_id || '')
              : ((d as any)[c.key] || '');
            return val;
          })),
          startY: y,
          margin: { left: contentX, right: margin },
          theme: 'plain',
          tableWidth: Math.min(contentW, 190),
          styles: {
            font: 'times', fontSize: 9, textColor: [15, 23, 42],
            cellPadding: { top: 1, bottom: 1, left: 0, right: 3 },
            lineColor: [226, 232, 240], lineWidth: 0
          },
          headStyles: {
            fontStyle: 'bold', fontSize: 7, textColor: [51, 65, 85],
            lineColor: [15, 23, 42], lineWidth: { top: 0.4, bottom: 0.25 }
          },
          bodyStyles: { lineWidth: { bottom: 0.1 } },
          didParseCell: data => {
            if (data.section === 'body') {
              const key = visibleSynopsisCols[data.column.index]?.key;
              if (key === 'dokumenten_id') data.cell.styles.fontStyle = 'bold';
              if (key === 'textinitium') data.cell.styles.fontStyle = 'italic';
            }
          }
        });
        y = (doc as any).lastAutoTable.finalY + 7;
      }

      const indentOf = (el: HTMLElement): number =>
        el.closest('.syn-sec-3') ? 6 : el.closest('.syn-sec-2') ? 3 : 0;

      const renderRow = async (row: HTMLElement, x0: number) => {
        const rowRect = row.getBoundingClientRect();

        for (const svg of Array.from(row.querySelectorAll('svg'))) {
          const r = svg.getBoundingClientRect();
          if (r.width < 1 || r.height < 1) continue;
          const hadViewBox = svg.getAttribute('viewBox');
          if (!hadViewBox) svg.setAttribute('viewBox', `0 0 ${r.width} ${r.height}`);
          await doc.svg(svg as unknown as SVGElement, {
            x: x0 + (r.left - rowRect.left) * scale,
            y: y + (r.top - rowRect.top) * scale,
            width: r.width * scale,
            height: r.height * scale
          });
          if (!hadViewBox) svg.removeAttribute('viewBox');
        }

        const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT, {
          acceptNode: n => {
            if (!(n.textContent || '').trim()) return NodeFilter.FILTER_REJECT;
            const p = n.parentElement;
            if (!p || p.closest('svg') || p.closest('.d-print-none')) return NodeFilter.FILTER_REJECT;
            return NodeFilter.FILTER_ACCEPT;
          }
        });
        let node: Node | null;
        while ((node = walker.nextNode())) {
          const parent = node.parentElement as HTMLElement;
          const range = document.createRange();
          range.selectNodeContents(node);
          const r = range.getBoundingClientRect();
          if (r.width < 0.5 || r.height < 0.5) continue;

          const cs = getComputedStyle(parent);
          const fontPx = parseFloat(cs.fontSize) || 15;
          const italic = cs.fontStyle === 'italic';
          const bold = (parseInt(cs.fontWeight, 10) || 400) >= 600;
          doc.setFont('times', bold && italic ? 'bolditalic' : bold ? 'bold' : italic ? 'italic' : 'normal');
          doc.setFontSize(ptOf(fontPx));
          const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(cs.color);
          if (m) doc.setTextColor(+m[1], +m[2], +m[3]); else doc.setTextColor(0, 0, 0);

          let text = (node.textContent || '').replace(/\s+/g, ' ').trim();
          const maxWmm = r.width * scale + 1.5;
          while (text.length > 1 && doc.getTextWidth(text) > maxWmm) {
            text = text.slice(0, -1);
          }
          doc.text(text,
            x0 + (r.left - rowRect.left) * scale,
            y + (r.top - rowRect.top + r.height * 0.78) * scale);
        }
        y += row.offsetHeight * scale;
      };

      const blocks = Array.from(root.querySelectorAll<HTMLElement>('.syn-sec-head, .synopsis-leaf-container'));
      for (const block of blocks) {
        if (block.classList.contains('syn-sec-head')) {
          const indent = indentOf(block);
          const level = indent === 6 ? 3 : indent === 3 ? 2 : 1;
          const name = (block.querySelector('.syn-sec-name')?.textContent || '').trim();
          const match = (block.querySelector('.syn-sec-match')?.textContent || '').trim();
          ensureSpace(22);
          y += level === 1 ? 4 : 2.5;
          doc.setFont('times', level === 3 ? 'italic' : 'bold');
          // Structural labels are secondary — keep them small.
          doc.setFontSize(level === 1 ? 8 : level === 2 ? 7.5 : 7);
          doc.setTextColor(30, 41, 59);
          const nameX = contentX + indent;
          const shownName = level === 1 ? name.toUpperCase() : name;
          doc.text(shownName, nameX, y);
          const nameW = doc.getTextWidth(shownName);
          doc.setFont('times', 'normal');
          doc.setFontSize(7);
          doc.setTextColor(100, 116, 139);
          const matchW = doc.getTextWidth(match);
          doc.text(match, contentX + contentW - matchW, y);
          doc.setDrawColor(148, 163, 184);
          doc.setLineWidth(0.15);
          doc.line(nameX + nameW + 2, y - 1, contentX + contentW - matchW - 2, y - 1);
          y += 4;
        } else {
          const rows = Array.from(block.querySelectorAll<HTMLElement>('.synopsis-stave-row, .synopsis-consensus-text-row'));
          if (!rows.length) continue;
          const x0 = contentX + indentOf(block);
          const totalH = rows.reduce((a, r) => a + r.offsetHeight * scale, 0);
          if (totalH <= bottomLimit - topY) ensureSpace(totalH + 1);
          for (const row of rows) {
            ensureSpace(row.offsetHeight * scale + 0.5);
            await renderRow(row, x0);
          }
          y += 3.5;
        }
      }

      const total = doc.getNumberOfPages();
      const dateStr = this.getPrintDate();
      const modeLbl = this.alignmentMode.charAt(0).toUpperCase() + this.alignmentMode.slice(1);
      const sigla = selectedDocs.map(d => this.docSigles[d.id] || d.dokumenten_id).join(' \u00b7 ');

      for (let i = 1; i <= total; i++) {
        doc.setPage(i);
        if (showHeader && i > 1) {
          doc.setFont('times', 'italic');
          doc.setFontSize(9);
          doc.setTextColor(80, 80, 80);
          doc.text(`Synoptic Comparison \u2014 ${modeLbl} alignment`, contentX, margin - 3);
          if (showDate) doc.text(dateStr, pageW - margin, margin - 3, { align: 'right' });
          doc.setDrawColor(90, 90, 90);
          doc.setLineWidth(0.2);
          doc.line(contentX, margin - 1, pageW - margin, margin - 1);
        }
        if (showFooter) {
          doc.setDrawColor(90, 90, 90);
          doc.setLineWidth(0.2);
          doc.line(contentX, pageH - margin + 1, pageW - margin, pageH - margin + 1);
          doc.setFont('times', 'normal');
          doc.setFontSize(8);
          doc.setTextColor(80, 80, 80);
          if (showFooterIds && sigla) {
            const maxW = contentW - 30;
            const firstLine = (doc.splitTextToSize(sigla, maxW) as string[])[0] || '';
            doc.text(firstLine, contentX, pageH - margin + 4.5);
          }
          doc.text(`Page ${i} of ${total}`, pageW - margin, pageH - margin + 4.5, { align: 'right' });
        }
      }

      const suffix = singleLine ? 'single-line-' : '';
      doc.save(`synopsis-${suffix}${new Date().toISOString().slice(0, 10)}.pdf`);
      this.toastr.success('Synopsis PDF exported successfully!');
    } catch (err) {
      console.error('Error generating PDF:', err);
      this.toastr.error('Failed to export PDF');
    }
  }
}
