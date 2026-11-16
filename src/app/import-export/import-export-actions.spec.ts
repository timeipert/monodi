import { IO_SECTIONS, sectionsOf } from './import-export-actions';

describe('import-export-actions', () => {
  const all = IO_SECTIONS.flatMap((s) => s.actions);

  it('offers every action once per column, with a unique id within the column', () => {
    for (const tab of ['import', 'export'] as const) {
      const ids = sectionsOf(tab).flatMap((s) => s.actions.map((a) => a.id));
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids.length).toBeGreaterThan(2);
    }
  });

  it('keeps the actions that the Sources page runs, under the ids it knows', () => {
    const ws = all.filter((a) => a.ws).map((a) => a.ws).sort();
    expect(ws).toEqual([
      'export-csv', 'export-html', 'export-pdf', 'export-workspace', 'export-zip',
      'import-annotations', 'import-csv', 'import-guido', 'import-mei', 'import-workspace', 'import-zip',
    ]);
    for (const a of all.filter((x) => x.ws)) expect(a.id).toBe(a.ws!);
  });

  it('has the two dialogs of the page without a ws', () => {
    expect(all.filter((a) => !a.ws).map((a) => a.id).sort()).toEqual(['cantus', 'repository']);
  });

  it('gives every row a title, a format, and a tooltip text (hint and what it keeps)', () => {
    for (const a of all) {
      expect(a.title && a.hint && a.format && a.keeps).toBeTruthy();
    }
  });
});
