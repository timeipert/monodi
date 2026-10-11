import { WORKSPACE_SCHEMA_VERSION } from './schema';
import { 
  convertToBackwardsCompatibleComment, 
  convertToBackwardsCompatibleConsecutiveLines, 
  convertToBackwardsCompatibleSplitDocuments,
  normalizeDocumentComments,
  RootContainer 
} from './types/model';
import {
  importPlaceholderCommentsEnabled, placeholderCommentsToSyllables, placeholderConfigFromSettings, syllableCommentsToPlaceholders
} from './placeholder-comments';

export interface WorkspaceImportResult {
  sources: any;
  documents: any;
  notesDict: any;
  settings: any;
  schemaVersion: number;
}

export type BackwardsCompatMode = 'none' | 'comment' | 'consecutive_lines' | 'split_documents';

export function buildWorkspaceExport(
  sources: any,
  documents: any,
  notesDict: any,
  settings: any,
  backwardsCompatMode: BackwardsCompatMode | boolean = 'none',
  placeholderNotes = false
): any {
  const mode: BackwardsCompatMode = typeof backwardsCompatMode === 'boolean'
    ? (backwardsCompatMode ? 'comment' : 'none')
    : backwardsCompatMode;

  let processedNotes = notesDict;
  let processedDocuments = documents;

  if (mode !== 'none' && notesDict && typeof notesDict === 'object') {
    processedNotes = {};
    if (mode === 'split_documents') {
      processedDocuments = [];
      const docList = Array.isArray(documents) ? documents : [];
      for (const d of docList) {
        const root = notesDict[d.id];
        if (root && typeof root === 'object' && (root as any).kind === 'RootContainer') {
          const split = convertToBackwardsCompatibleSplitDocuments(root as RootContainer, d.id);
          const d1 = JSON.parse(JSON.stringify(d));
          const d2 = JSON.parse(JSON.stringify(d));
          d1.id = `${d.id}-v1`;
          d1.titel = (d.titel || d.id) + ' (Voice 1)';
          d2.id = `${d.id}-v2`;
          d2.titel = (d.titel || d.id) + ' (Voice 2)';

          processedDocuments.push(d1, d2);
          processedNotes[`${d.id}-v1`] = split.v1;
          processedNotes[`${d.id}-v2`] = split.v2;
        } else {
          processedDocuments.push(d);
          processedNotes[d.id] = root;
        }
      }
    } else {
      for (const [docId, root] of Object.entries(notesDict)) {
        if (root && typeof root === 'object' && (root as any).kind === 'RootContainer') {
          if (mode === 'consecutive_lines') {
            processedNotes[docId] = convertToBackwardsCompatibleConsecutiveLines(root as RootContainer);
          } else {
            processedNotes[docId] = convertToBackwardsCompatibleComment(root as RootContainer);
          }
        } else {
          processedNotes[docId] = root;
        }
      }
    }
  }

  if (placeholderNotes && processedNotes && typeof processedNotes === 'object') {
    const cfg = placeholderConfigFromSettings(settings);
    const next: any = {};
    for (const [docId, root] of Object.entries(processedNotes)) {
      next[docId] = root && (root as any).kind === 'RootContainer' ? syllableCommentsToPlaceholders(root as RootContainer, cfg) : root;
    }
    processedNotes = next;
  }

  return {
    schemaVersion: WORKSPACE_SCHEMA_VERSION,
    sources,
    documents: processedDocuments,
    notes: processedNotes,
    settings
  };
}

export function parseWorkspaceImport(json: any): WorkspaceImportResult {
  if (!json || typeof json !== 'object') {
    throw new Error('Invalid workspace format: JSON is not an object.');
  }
  const schemaVersion = json.schemaVersion !== undefined ? json.schemaVersion : 1;
  const notesDict = json.notes;
  if (notesDict && typeof notesDict === 'object') {
    for (const root of Object.values(notesDict)) {
      if (root && typeof root === 'object' && (root as any).kind === 'RootContainer') {
        normalizeDocumentComments(root as RootContainer);
        if (importPlaceholderCommentsEnabled(json.settings)) placeholderCommentsToSyllables(root as RootContainer, placeholderConfigFromSettings(json.settings));
      }
    }
  }

  return {
    sources: json.sources,
    documents: json.documents,
    notesDict,
    settings: json.settings,
    schemaVersion
  };
}
