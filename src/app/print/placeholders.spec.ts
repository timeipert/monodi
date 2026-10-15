import { placeholderNames, resolveBlock, resolvePlaceholders } from './placeholders';

const values: { [k: string]: string } = { gattung1: 'Antiphon', quelle: 'Aachen, Domarchiv, Hs. G 13', leer: '', jahr: '2026' };
const lookup = (n: string) => values[n];

describe('placeholders', () => {
  it('replaces $name$ with its value, text around it stays', () => {
    expect(resolvePlaceholders('$gattung1$en aus $quelle$', lookup).text).toBe('Antiphonen aus Aachen, Domarchiv, Hs. G 13');
  });

  it('ignores the case of the name', () => {
    expect(resolvePlaceholders('$Gattung1$ / $JAHR$', lookup).text).toBe('Antiphon / 2026');
  });

  it('reports unknown and empty names and prints nothing for them', () => {
    const r = resolvePlaceholders('a $nichts$ b $leer$ c', lookup);
    expect(r.text).toBe('a  b  c');
    expect(r.unknown).toEqual(['nichts']);
    expect(r.empty).toEqual(['leer']);
    expect(r.count).toBe(2);
  });

  it('$$ is a dollar sign and a lone dollar sign is text', () => {
    expect(resolvePlaceholders('5 $$ and $jahr$', lookup).text).toBe('5 $ and 2026');
    expect(resolvePlaceholders('costs 5$ or 6$ today', lookup).text).toBe('costs 5$ or 6$ today');
    expect(resolvePlaceholders('open $jahr', lookup).text).toBe('open $jahr');
  });

  it('a value that looks like a placeholder is not resolved again', () => {
    expect(resolvePlaceholders('$a$', (n) => (n === 'a' ? '$jahr$' : undefined)).text).toBe('$jahr$');
  });

  it('lists the names of a text once, in order', () => {
    expect(placeholderNames('$B$ x $a$ $b$ $$')).toEqual(['b', 'a']);
  });

  it('a block with an empty placeholder is hidden when asked to', () => {
    expect(resolveBlock('herausgegeben von\n\n$leer$', lookup, true)).toBeNull();
    expect(resolveBlock('herausgegeben von\n\n$leer$', lookup, false)).toEqual(['herausgegeben von']);
    expect(resolveBlock('x $nichts$', lookup, true)).toBeNull();
  });

  it('keeps blank lines inside a block as spacing and trims those at the ends', () => {
    expect(resolveBlock('\nherausgegeben von\n\n$jahr$\n\n', lookup, true)).toEqual(['herausgegeben von', '', '2026']);
  });

  it('a block without text is not printed', () => {
    expect(resolveBlock('  \n ', lookup, false)).toBeNull();
  });
});
