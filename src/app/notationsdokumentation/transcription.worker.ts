/// <reference lib="webworker" />

// Import directly from the Angular-free core — NOT from TranscriptionAnalyzerService.
// Importing the service would pull @angular/core → zone.js into the worker bundle,
// which crashes (zone.js patches browser globals absent in worker scope) and causes
// webpack to fall back to a file:// URL for the worker chunk.
import { analyzeDocument } from '@monodi/core/document';

addEventListener('message', ({ data }) => {
  const { documentsData } = data;

  let allPatterns: any[] = [];

  for (const docData of documentsData) {
    const patterns = analyzeDocument(
      docData.root,
      docData.quelle_id || 'Unknown',
      docData.id        || 'Unknown'
    );
    allPatterns = allPatterns.concat(patterns);
  }

  postMessage({ allPatterns });
});
