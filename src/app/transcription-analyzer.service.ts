import { Injectable } from '@angular/core';
import * as VM from './types/model';
import type { AnalyzedPattern } from '@monodi/core/document';
import { extractPattern, analyzeDocument, extractDocumentFolios } from '@monodi/core/document';

// Re-export so existing consumers of this service don't need to change their imports
export type { AnalyzedPattern };
export { extractDocumentFolios };

@Injectable({ providedIn: 'root' })
export class TranscriptionAnalyzerService {
  constructor() {}

  extractPattern(nonSpaced: VM.NonSpaced): string {
    return extractPattern(nonSpaced);
  }

  analyzeDocument(
    root: VM.RootContainer,
    sourceId: string = 'Unknown',
    documentId: string = 'Unknown'
  ): AnalyzedPattern[] {
    return analyzeDocument(root, sourceId, documentId);
  }

  extractDocumentFolios(root: VM.RootContainer, foliostart?: string): string[] {
    return extractDocumentFolios(root, foliostart);
  }
}
