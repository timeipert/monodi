import { NoteType } from '../types/model';
import {
  BUILTIN_GUIDO_TEMPLATE, BUILTIN_TEMPLATE_ID, allGuidoTemplates, fillPattern, matchPattern,
  parseGuidoTemplate, sanitizeGuidoTemplates,
} from './guido-template';

describe('guido-template', () => {
  it('fills a typed template with the built-in values', () => {
    const { template, errors } = parseGuidoTemplate({ id: 'mine', name: 'Mine' });
    expect(errors).toEqual([]);
    expect(template!.mapping.shapes.virga).toEqual({ flag: 'V' });
    expect(template!.notAttestedColor).toBe('BFBFBF');
    expect(template!.ensureFlags.map(f => f.key)).toEqual(['V', 'P', 'T', 'F', 'H', 'U']);
  });

  it('takes what the user changed', () => {
    const { template, errors } = parseGuidoTemplate({
      id: 'x', name: 'X', layout: { siglumColumn: 2, firstCodeColumn: 3 }, notAttestedColor: '#c0c0c0',
      mapping: { shapes: { virga: { noteType: 'Descending' } }, plicaFlag: '' },
      symbols: { phrasingMarks: 'text' },
    });
    expect(errors).toEqual([]);
    expect(template!.layout).toEqual({ siglumColumn: 2, firstCodeColumn: 3 });
    expect(template!.notAttestedColor).toBe('C0C0C0');
    expect(template!.mapping.shapes.virga).toEqual({ noteType: NoteType.Descending });
    expect(template!.mapping.plicaFlag).toBe('');
    expect(template!.symbols.phrasingMarks).toBe('text');
  });

  it('lists what is wrong and falls back to the built-in value', () => {
    const { template, errors } = parseGuidoTemplate({
      id: 'x', name: 'X', glyphTable: 'nope', notAttestedColor: 'red',
      mapping: { shapes: { virga: { flag: 'vv', noteType: 'Wavy' } }, clef: 'both' },
      symbols: { phrasingMarks: 'sometimes' },
    });
    expect(errors.length).toBe(6);
    expect(template!.mapping.shapes.virga).toEqual({});
    expect(template!.notAttestedColor).toBe('BFBFBF');
  });

  it('refuses the built-in id and objects without id or name', () => {
    expect(parseGuidoTemplate({ id: BUILTIN_TEMPLATE_ID, name: 'x' }).errors.length).toBe(1);
    expect(parseGuidoTemplate({ name: 'x' }).template).toBeUndefined();
    expect(parseGuidoTemplate('nope').template).toBeUndefined();
  });

  it('keeps valid stored templates once and drops the rest', () => {
    const list = sanitizeGuidoTemplates([
      { id: 'a', name: 'A' }, { id: 'a', name: 'again' }, { id: 'b' }, { id: BUILTIN_TEMPLATE_ID, name: 'x' }, 7,
    ]);
    expect(list.map(t => t.id)).toEqual(['a']);
    expect(sanitizeGuidoTemplates(undefined)).toEqual([]);
    expect(allGuidoTemplates(list).map(t => t.id)).toEqual([BUILTIN_TEMPLATE_ID, 'a']);
  });

  it('fills and reads patterns', () => {
    expect(fillPattern('{siglum}-{id}', { siglum: 'Str-1', id: 'R 1001' })).toBe('Str-1-R 1001');
    expect(fillPattern('{x}{y}', { x: 'a' })).toBe('a');
    expect(matchPattern('{id}_{incipit}', 'R 1001_Dum staret')).toEqual({ id: 'R 1001', incipit: 'Dum staret' });
    expect(matchPattern('{id}_{incipit}', 'Dum staret')).toBeNull();
    expect(matchPattern('No. {n} (a.b)', 'No. 5 (a.b)')).toEqual({ n: '5' });
  });

  it('is the layout of the Budapest table', () => {
    expect(BUILTIN_GUIDO_TEMPLATE.layout).toEqual({ siglumColumn: 0, firstCodeColumn: 1 });
    expect(BUILTIN_GUIDO_TEMPLATE.codeFont).toBe('guido6+');
  });
});
