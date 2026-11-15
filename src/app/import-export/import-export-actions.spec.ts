import { IO_GOALS, IO_SECTIONS, describeAgo, findAction, sectionsOf, tabOfAction } from './import-export-actions';

describe('import-export-actions', () => {
  const all = IO_SECTIONS.flatMap((s) => s.actions);

  it('offers every action once per tab, with a unique id within the tab', () => {
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

  it('gives every card a title, a hint, a format and a line on what it keeps', () => {
    for (const a of all) {
      expect(a.title && a.hint && a.format && a.keeps).toBeTruthy();
    }
  });

  it('marks the workspace backup as complete and recommended, and no other export', () => {
    expect(all.filter((a) => a.recommended).map((a) => a.id)).toEqual(['export-workspace']);
    expect(all.filter((a) => a.complete).map((a) => a.id).sort()).toEqual(['export-workspace', 'import-workspace']);
  });

  it('points every goal at an action that exists', () => {
    for (const goal of IO_GOALS) {
      expect(findAction(goal.actionId)).toBeTruthy(goal.goal);
      expect(tabOfAction(goal.actionId)).toBeTruthy();
    }
  });

  it('says how long ago something was', () => {
    const now = Date.UTC(2026, 10, 15, 12);
    const day = 86_400_000;
    expect(describeAgo(now - 3_600_000, now)).toBe('today');
    expect(describeAgo(now - day, now)).toBe('yesterday');
    expect(describeAgo(now - 5 * day, now)).toBe('5 days ago');
    expect(describeAgo(now - 21 * day, now)).toBe('3 weeks ago');
    expect(describeAgo(now - 100 * day, now)).toBe('3 months ago');
  });
});
