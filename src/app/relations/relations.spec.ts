import type { Document } from '../api.service';
import { checkRelations, DEFAULT_RELATION_TYPES, FindingKind, RELATION_FIELDS, relationTypes, withRelationFields } from './relations';

function doc(id: string, quelle: string, custom: Record<string, string> = {}): Document {
  return { id: 'u-' + id + quelle, dokumenten_id: id, quelle_id: quelle, custom } as unknown as Document;
}

const kinds = (docs: Document[], settings = {}): FindingKind[] => checkRelations(docs, settings).findings.map((f) => f.kind).sort();

describe('relations: fields and types', () => {
  it('adds the five fields once and keeps the ones the user has', () => {
    const next = withRelationFields({ customDocumentFields: [{ key: 'mine', label: 'Mine' }] })!;
    expect(next.customDocumentFields!.map((f) => f.key)).toEqual(['mine', ...RELATION_FIELDS.map((f) => f.key)]);
    expect(withRelationFields(next)).toBeNull();
  });

  it('has the primary chant with suffix P until the user lists own types', () => {
    expect(relationTypes({})).toEqual(DEFAULT_RELATION_TYPES);
    expect(relationTypes({ relationTypes: [{ name: ' ', suffix: 'X' }] })).toEqual(DEFAULT_RELATION_TYPES);
    expect(relationTypes({ relationTypes: [{ name: 'Verse', suffix: 'V' }] })).toEqual([{ name: 'Verse', suffix: 'V' }]);
  });
});

describe('relations: check of relations', () => {
  it('finds nothing wrong with a trope that refers to the antiphon of its manuscript', () => {
    const r = checkRelations([doc('T1', 'A', { relation_target: 'AN1' }), doc('AN1', 'A')], {});
    expect(r.findings).toEqual([]);
    expect(r.relations).toBe(1);
  });

  it('prefers the document of the same manuscript when the ID exists in several', () => {
    expect(kinds([doc('T1', 'A', { relation_target: 'AN1' }), doc('AN1', 'A'), doc('AN1', 'B')])).toEqual([]);
  });

  it('reports a missing target, a self reference and a target in another manuscript', () => {
    expect(kinds([doc('T1', 'A', { relation_target: 'nope' })])).toEqual(['target-missing']);
    expect(kinds([doc('T1', 'A', { relation_target: 'T1' })])).toEqual(['target-self']);
    expect(kinds([doc('T1', 'A', { relation_target: 'AN1' }), doc('AN1', 'B')])).toEqual(['target-other-source']);
  });

  it('reports an ID that belongs to two documents of the manuscript, because the print could not tell which one is meant', () => {
    expect(kinds([doc('T1', 'A', { relation_target: 'AN1' }), doc('AN1', 'A'), doc('AN1', 'A')])).toEqual(['target-ambiguous']);
  });

  it('lets two trope complexes refer to the same antiphon', () => {
    expect(kinds([doc('T1', 'A', { relation_target: 'AN1' }), doc('T2', 'A', { relation_target: 'AN1' }), doc('AN1', 'A')])).toEqual([]);
  });

  it('finds a circle and names each of its documents once, not the document that merely leads into it', () => {
    const docs = [doc('A', 'S', { relation_target: 'B' }), doc('B', 'S', { relation_target: 'C' }), doc('C', 'S', { relation_target: 'B' }), doc('D', 'S', { relation_target: 'A' })];
    const circle = checkRelations(docs, {}).findings.filter((f) => f.kind === 'relation-cycle').map((f) => f.dokumentenId).sort();
    expect(circle).toEqual(['B', 'C']);
  });

  it('knows the relation types of the settings, the default one included', () => {
    const base = { relation_target: 'B' };
    expect(kinds([doc('A', 'S', { ...base, relation_type: 'primary chant' }), doc('B', 'S')])).toEqual([]);
    expect(kinds([doc('A', 'S', { ...base, relation_type: 'Verse' }), doc('B', 'S')])).toEqual(['type-unknown']);
    expect(kinds([doc('A', 'S', { ...base, relation_type: 'Verse' }), doc('B', 'S')], { relationTypes: [{ name: 'Verse', suffix: 'V' }] })).toEqual([]);
    expect(kinds([doc('A', 'S', { relation_type: 'Primary chant' })])).toEqual(['type-without-target']);
  });
});

describe('relations: check of units', () => {
  const play = (id: string, extra: Record<string, string> = {}) => doc(id, 'S', { unit_id: 'play-1', unit_type: 'Play', ...extra });

  it('accepts a unit with unique positions, in any order, with a decimal comma', () => {
    expect(kinds([play('P1', { unit_position: '2' }), play('P2', { unit_position: '1,5' }), play('P3')])).toEqual([]);
  });

  it('reports a unit of one document', () => {
    expect(kinds([play('P1')])).toEqual(['unit-single']);
  });

  it('reports a position that is no number and a position used twice', () => {
    expect(kinds([play('P1', { unit_position: 'two' }), play('P2')])).toEqual(['unit-position-invalid']);
    expect(kinds([play('P1', { unit_position: '1' }), play('P2', { unit_position: '1.0' })])).toEqual(['unit-position-duplicate']);
  });

  it('reports one unit with two unit types once', () => {
    expect(kinds([play('P1'), play('P2', { unit_type: 'Office' }), play('P3', { unit_type: 'Office' })])).toEqual(['unit-type-mixed']);
  });

  it('counts the units', () => {
    expect(checkRelations([play('P1'), play('P2'), doc('X', 'S', { unit_id: 'other' })], {}).units).toBe(2);
  });
});
