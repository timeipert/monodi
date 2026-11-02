import { checkAttribute, attributesOf, subsetCatalog, withExtensions, MeiSchemaCatalog } from './mei-schema-catalog';
import { rngTextToCatalog } from './rng-to-catalog';

/** A miniature of the MEI neume schema: same constructs as mei-all.rng (att classes, model classes, data types, unions). */
const MINI_RNG = `<?xml version="1.0" encoding="utf-8"?>
<grammar xmlns="http://relaxng.org/ns/structure/1.0" xmlns:a="http://relaxng.org/ns/compatibility/annotations/1.0"
         datatypeLibrary="http://www.w3.org/2001/XMLSchema-datatypes" ns="http://www.music-encoding.org/ns/mei">
  <define name="mei_data.BOOLEAN"><choice>
    <value>true</value><a:documentation>True.</a:documentation>
    <value>false</value><a:documentation>False.</a:documentation>
  </choice></define>
  <define name="mei_att.ncForm.attributes">
    <ref name="mei_att.ncForm.attribute.con"/>
    <ref name="mei_att.ncForm.attribute.ligated"/>
  </define>
  <define name="mei_att.ncForm.attribute.con"><optional><attribute name="con">
    <a:documentation>Connection to the previous component.</a:documentation>
    <choice><value>g</value><a:documentation>Gapped.</a:documentation><value>l</value><value>e</value></choice>
  </attribute></optional></define>
  <define name="mei_att.ncForm.attribute.ligated"><optional><attribute name="ligated">
    <ref name="mei_data.BOOLEAN"/></attribute></optional></define>
  <define name="mei_att.nc.attribute.oct"><optional><attribute name="oct">
    <choice><data type="nonNegativeInteger"><param name="maxInclusive">9</param></data>
            <data type="token"><param name="pattern">unknown</param></data></choice>
  </attribute></optional></define>
  <define name="mei_att.nc.attribute.pname"><optional><attribute name="pname">
    <data type="token"><param name="pattern">[a-g]</param></data></attribute></optional></define>
  <define name="mei_model.neumeComponentModifierLike"><choice><ref name="mei_oriscus"/><ref name="mei_liquescent"/></choice></define>
  <define name="mei_oriscus"><element name="oriscus"><empty/></element></define>
  <define name="mei_liquescent"><element name="liquescent"><empty/></element></define>
  <define name="mei_nc"><element name="nc">
    <a:documentation>Neume component.</a:documentation>
    <zeroOrMore><ref name="mei_model.neumeComponentModifierLike"/></zeroOrMore>
    <ref name="mei_att.ncForm.attributes"/>
    <ref name="mei_att.nc.attribute.oct"/>
    <ref name="mei_att.nc.attribute.pname"/>
    <optional><attribute name="xml:id"><data type="ID"/></attribute></optional>
  </element></define>
  <define name="mei_neume"><element name="neume"><zeroOrMore><ref name="mei_nc"/></zeroOrMore></element></define>
  <define name="mei_syl"><element name="syl"><text/></element></define>
  <define name="mei_syllable"><element name="syllable">
    <zeroOrMore><choice><ref name="mei_syl"/><ref name="mei_neume"/></choice></zeroOrMore>
  </element></define>
  <define name="mei_unrelated"><element name="unrelated"><empty/></element></define>
</grammar>`;

describe('rngTextToCatalog', () => {
  let cat: MeiSchemaCatalog;
  beforeAll(() => {
    cat = rngTextToCatalog(MINI_RNG, { id: 'mini', label: 'Mini', schemaVersion: '5.0' });
  });

  it('reads elements, their children through model classes and character content', () => {
    expect(Object.keys(cat.elements).sort()).toEqual(['liquescent', 'nc', 'neume', 'oriscus', 'syl', 'syllable', 'unrelated']);
    expect(cat.elements['nc'].children).toEqual(['liquescent', 'oriscus']);
    expect(cat.elements['syllable'].children).toEqual(['neume', 'syl']);
    expect(cat.elements['syl'].text).toBeTrue();
    expect(cat.elements['nc'].doc).toBe('Neume component.');
  });

  it('collects attributes through attribute classes and inline attributes', () => {
    expect(attributesOf(cat, 'nc').map(a => a.name)).toEqual(['con', 'ligated', 'oct', 'pname', 'xml:id']);
    expect(attributesOf(cat, 'neume')).toEqual([]);
  });

  it('reads value lists with their descriptions, and booleans', () => {
    const con = attributesOf(cat, 'nc').find(a => a.name === 'con')!;
    expect(con.type).toBe('enum');
    expect(con.values!.map(v => v.value)).toEqual(['g', 'l', 'e']);
    expect(con.values![0].doc).toBe('Gapped.');
    expect(attributesOf(cat, 'nc').find(a => a.name === 'ligated')!.type).toBe('boolean');
  });

  it('keeps a union as alternatives so that each alternative is checked on its own', () => {
    expect(checkAttribute(cat, 'nc', 'oct', '4')).toBeNull();
    expect(checkAttribute(cat, 'nc', 'oct', 'unknown')).toBeNull();
    expect(checkAttribute(cat, 'nc', 'oct', '12')?.level).toBe('error');
    expect(checkAttribute(cat, 'nc', 'oct', 'high')?.level).toBe('error');
  });

  it('rejects wrong values and accepts right ones', () => {
    expect(checkAttribute(cat, 'nc', 'con', 'g')).toBeNull();
    expect(checkAttribute(cat, 'nc', 'con', 'x')?.message).toContain('not one of: g, l, e');
    expect(checkAttribute(cat, 'nc', 'pname', 'c')).toBeNull();
    expect(checkAttribute(cat, 'nc', 'pname', 'h')?.level).toBe('error');
    expect(checkAttribute(cat, 'nc', 'ligated', 'maybe')?.level).toBe('error');
  });

  it('treats an attribute or element unknown to the schema as a warning, or an error when strict', () => {
    expect(checkAttribute(cat, 'nc', 'tilt', 'n')?.level).toBe('warning');
    expect(checkAttribute(cat, 'nc', 'tilt', 'n', 'strict')?.level).toBe('error');
    expect(checkAttribute(cat, 'virga', 'x', '1')?.message).toContain('<virga> is not in the schema');
  });

  it('never allows xml:id or an invalid attribute name', () => {
    expect(checkAttribute(cat, 'nc', 'xml:id', 'a')?.level).toBe('error');
    expect(checkAttribute(cat, 'nc', '1bad', 'a')?.level).toBe('error');
    expect(checkAttribute(undefined, 'nc', 'anything', 'a')).toBeNull();
  });

  it('subsetCatalog keeps what is reachable from the roots', () => {
    const sub = subsetCatalog(cat, { id: 'sub', label: 'Sub', roots: ['syllable'] });
    expect(Object.keys(sub.elements).sort()).toEqual(['liquescent', 'nc', 'neume', 'oriscus', 'syl', 'syllable']);
    expect(sub.origin).toBe('derived');
    expect(checkAttribute(sub, 'unrelated', 'x', '1')?.level).toBe('warning');
  });

  it('withExtensions adds project attributes, with their own values, to one element or to all', () => {
    const ext = withExtensions(cat, [
      { element: 'nc', name: 'monodi:shape', values: ['virga', 'punctum'] },
      { element: '*', name: 'cert' }
    ]);
    expect(checkAttribute(ext, 'nc', 'monodi:shape', 'virga')).toBeNull();
    expect(checkAttribute(ext, 'nc', 'monodi:shape', 'clivis')?.level).toBe('error');
    expect(checkAttribute(ext, 'syl', 'cert', 'high')).toBeNull();
    expect(checkAttribute(cat, 'nc', 'monodi:shape', 'virga')?.level).toBe('warning');
  });

  it('rejects a file that is not a RelaxNG grammar', () => {
    expect(() => rngTextToCatalog('<root/>', { id: 'x', label: 'x', schemaVersion: '5.0' })).toThrowError(/RelaxNG/);
  });
});
