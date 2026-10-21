import type { Document } from '../api.service';
import type { FieldJob } from './fields';
import { NO_RULE_LABEL, groupByRules, parseRuleValues, usableRules, VolumeRule } from './volume-rules';

interface D { id: string; g1?: string; g2?: string; unit?: string; source?: string }
const job = (d: D): FieldJob => ({
  document: { dokumenten_id: d.id, gattung1: d.g1 ?? '', gattung2: d.g2 ?? '', quelle_id: d.source ?? 's', custom: d.unit ? { unit_id: d.unit } : {} } as unknown as Document,
  source: null,
  sigle: d.source ?? 's',
});
const group = (docs: D[], rules: VolumeRule[]) => groupByRules(docs, job, rules);
const ids = (g: { items: D[] }) => g.items.map((d) => d.id);

const ordinary: VolumeRule = { name: 'Ordinary', field: 'genre', op: 'in', values: ['Kyrie', 'Gloria', 'Sanctus', 'Agnus'] };
const tropes: VolumeRule = { name: 'Tropes and antiphons', field: 'genre', op: 'in', values: ['Tropus', 'Antiphon'] };

describe('volume rules', () => {
  it('puts several genres into one volume, in the order of the rules, the rest last', () => {
    const g = group([{ id: 'a', g1: 'Tropus' }, { id: 'b', g1: 'Gloria' }, { id: 'c', g1: 'Hymnus' }, { id: 'd', g1: 'Antiphon' }, { id: 'e', g1: 'Kyrie' }], [ordinary, tropes]);
    expect(g.map((x) => x.label)).toEqual(['Ordinary', 'Tropes and antiphons', NO_RULE_LABEL]);
    expect(g.map(ids)).toEqual([['e', 'b'], ['a', 'd'], ['c']]);
  });

  it('puts the genres of a volume in the order the rule lists them, and keeps the input order inside a genre', () => {
    const g = group([{ id: 'g2', g1: 'Gloria' }, { id: 'k2', g1: 'Kyrie' }, { id: 'g1', g1: 'Gloria' }, { id: 'k1', g1: 'Kyrie' }], [ordinary]);
    expect(ids(g[0])).toEqual(['k2', 'k1', 'g2', 'g1']);
  });

  it('lets the first rule win: a play comes before the genre, so its antiphon is not printed twice', () => {
    const plays: VolumeRule = { name: 'Plays', field: 'unit_id', op: 'set', values: [] };
    const g = group([{ id: 'p', g1: 'Antiphon', unit: 'play-1' }, { id: 'x', g1: 'Antiphon' }], [plays, tropes]);
    expect(g.map((x) => x.label)).toEqual(['Plays', 'Tropes and antiphons']);
    expect(g.map(ids)).toEqual([['p'], ['x']]);
  });

  it('makes a volume per value with "each", in order of appearance', () => {
    const plays: VolumeRule = { name: 'Play', field: 'unit_id', op: 'set', values: [], each: true };
    const g = group([{ id: 'a', unit: 'play-2' }, { id: 'b', unit: 'play-1' }, { id: 'c', unit: 'play-2' }, { id: 'd', g1: 'Hymnus' }], [plays]);
    expect(g.map((x) => x.label)).toEqual(['Play · play-2', 'Play · play-1', NO_RULE_LABEL]);
    expect(g.map(ids)).toEqual([['a', 'c'], ['b'], ['d']]);
  });

  it('matches either genre, any case, and also the empty value', () => {
    expect(group([{ id: 'a', g1: 'Responsorium', g2: 'GLORIA ' }], [ordinary])[0].label).toBe('Ordinary');
    const none: VolumeRule = { name: 'Without genre', field: 'genre', op: 'empty', values: [] };
    expect(group([{ id: 'a' }, { id: 'b', g1: 'Kyrie' }], [none]).map(ids)).toEqual([['a'], ['b']]);
  });

  it('loses nothing: every document lands in exactly one volume', () => {
    const docs: D[] = Array.from({ length: 60 }, (_, i) => ({ id: 'd' + i, g1: ['Kyrie', 'Tropus', 'Hymnus', 'Gloria', ''][i % 5], unit: i % 7 === 0 ? 'u' + (i % 3) : undefined }));
    const g = group(docs, [{ name: 'U', field: 'unit_id', op: 'set', values: [], each: true }, ordinary, tropes]);
    expect(g.flatMap(ids).sort()).toEqual(docs.map((d) => d.id).sort());
  });

  it('ignores rules that cannot work: no name, or "is one of" without values', () => {
    const bad: VolumeRule[] = [{ name: ' ', field: 'genre', op: 'set', values: [] }, { name: 'X', field: 'genre', op: 'in', values: [' '] }, ordinary];
    expect(usableRules(bad)).toEqual([ordinary]);
    expect(group([{ id: 'a', g1: 'Kyrie' }], bad).map((x) => x.label)).toEqual(['Ordinary']);
    expect(group([{ id: 'a', g1: 'Kyrie' }], []).map((x) => x.label)).toEqual([NO_RULE_LABEL]);
  });

  it('reads values separated by commas or semicolons', () => {
    expect(parseRuleValues('Kyrie, Gloria;Sanctus ;; ')).toEqual(['Kyrie', 'Gloria', 'Sanctus']);
  });
});
