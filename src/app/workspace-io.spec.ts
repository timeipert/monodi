import { buildWorkspaceExport, parseWorkspaceImport } from './workspace-io';
import { WORKSPACE_SCHEMA_VERSION } from './schema';

describe('WorkspaceIO Tests', () => {
  const dummySources = [{ id: 'S1', name: 'Source 1' }];
  const dummyDocuments = [{ id: 'D1', title: 'Document 1' }];
  const dummyNotes = { 'D1': { notes: 'notes' } };
  const dummySettings = { theme: 'dark' };

  it('export -> parse round-trip preserves all data', () => {
    const exported = buildWorkspaceExport(
      dummySources,
      dummyDocuments,
      dummyNotes,
      dummySettings
    );

    expect(exported.schemaVersion).toBe(WORKSPACE_SCHEMA_VERSION);
    expect(exported.sources).toEqual(dummySources);
    expect(exported.documents).toEqual(dummyDocuments);
    expect(exported.notes).toEqual(dummyNotes);
    expect(exported.settings).toEqual(dummySettings);

    const parsed = parseWorkspaceImport(exported);
    expect(parsed.schemaVersion).toBe(WORKSPACE_SCHEMA_VERSION);
    expect(parsed.sources).toEqual(dummySources);
    expect(parsed.documents).toEqual(dummyDocuments);
    expect(parsed.notesDict).toEqual(dummyNotes);
    expect(parsed.settings).toEqual(dummySettings);
  });

  it('parse of an object missing schemaVersion defaults it to 1', () => {
    const incompleteJson = {
      sources: dummySources,
      documents: dummyDocuments,
      notes: dummyNotes,
      settings: dummySettings
    };

    const parsed = parseWorkspaceImport(incompleteJson);
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.sources).toEqual(dummySources);
    expect(parsed.documents).toEqual(dummyDocuments);
    expect(parsed.notesDict).toEqual(dummyNotes);
    expect(parsed.settings).toEqual(dummySettings);
  });

  it('parse rejects null and non-object inputs by throwing an error', () => {
    expect(() => parseWorkspaceImport(null)).toThrowError(/JSON is not an object/);
    expect(() => parseWorkspaceImport(undefined)).toThrowError(/JSON is not an object/);
    expect(() => parseWorkspaceImport("string")).toThrowError(/JSON is not an object/);
  });
});
