import * as JSZip from 'jszip';
import { parseDocxXml, readDocx } from './guido-docx-reader';

const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const doc = (body: string) => `<?xml version="1.0" encoding="UTF-8"?><w:document ${NS}><w:body>${body}</w:body></w:document>`;
const styles = `<w:styles ${NS}>
  <w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri"/></w:rPr></w:rPrDefault></w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Norml"><w:rPr><w:rFonts w:ascii="guido6+"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Text"><w:basedOn w:val="Base"/></w:style>
  <w:style w:type="paragraph" w:styleId="Base"><w:rPr><w:rFonts w:ascii="Times New Roman"/></w:rPr></w:style>
</w:styles>`;
const run = (text: string, rPr = '') => `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}<w:t>${text}</w:t></w:r>`;
const p = (runs: string, style = '') => `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}${runs}</w:p>`;
const tc = (inner: string, pr = '') => `<w:tc>${pr ? `<w:tcPr>${pr}</w:tcPr>` : ''}${inner}</w:tc>`;

describe('guido-docx-reader', () => {
  it('reads paragraphs outside tables and tables apart', () => {
    const c = parseDocxXml(doc(
      p(run('R ') + run('1001') + run('_Dum staret')) +
      `<w:tbl><w:tr>${tc(p(run('Str-1')))}${tc(p(run('1')))}</w:tr></w:tbl>`), styles);
    expect(c.paragraphs).toEqual(['R 1001_Dum staret']);
    expect(c.tables.length).toBe(1);
    expect(c.tables[0].rows[0].map(cell => cell.runs.map(r => r.text).join(''))).toEqual(['Str-1', '1']);
  });

  it('resolves the font: run, paragraph style (with basedOn), default style, document default', () => {
    const c = parseDocxXml(doc(`<w:tbl><w:tr>${
      tc(p(run('a', '<w:rFonts w:ascii="Arial"/>')))}${
      tc(p(run('b'), 'Text'))}${
      tc(p(run('c')))}</w:tr></w:tbl>`), styles);
    const fonts = c.tables[0].rows[0].map(cell => cell.runs[0].font);
    expect(fonts).toEqual(['Arial', 'Times New Roman', 'guido6+']);
    const bare = parseDocxXml(doc(p(run('x'))), null);
    expect(bare.paragraphs).toEqual(['x']);
  });

  it('reads the colour of a run in capitals and ignores auto', () => {
    const c = parseDocxXml(doc(`<w:tbl><w:tr>${
      tc(p(run('1', '<w:color w:val="bfbfbf"/>') + run('2', '<w:color w:val="auto"/>') + run('3')))}</w:tr></w:tbl>`), styles);
    expect(c.tables[0].rows[0][0].runs.map(r => r.color)).toEqual(['BFBFBF', null, null]);
  });

  it('repeats a cell across the grid columns it spans', () => {
    const c = parseDocxXml(doc(`<w:tbl><w:tr>${
      tc(p(run('wide')), '<w:gridSpan w:val="2"/>')}${tc(p(run('x')))}</w:tr></w:tbl>`), styles);
    const row = c.tables[0].rows[0];
    expect(row.length).toBe(3);
    expect(row[0]).toBe(row[1]);
  });

  it('continues a vertically merged cell from the one above', () => {
    const c = parseDocxXml(doc(`<w:tbl>
      <w:tr>${tc(p(run('top')), '<w:vMerge w:val="restart"/>')}</w:tr>
      <w:tr>${tc(p(''), '<w:vMerge/>')}</w:tr></w:tbl>`), styles);
    expect(c.tables[0].rows[1][0].runs[0].text).toBe('top');
  });

  it('keeps tabs and line breaks of a run', () => {
    const c = parseDocxXml(doc(`<w:p><w:r><w:t>a</w:t><w:tab/><w:t>b</w:t><w:br/></w:r></w:p>`), null);
    expect(c.paragraphs).toEqual(['a\tb\n']);
  });

  it('rejects broken XML and files that are not a docx', async () => {
    expect(() => parseDocxXml('<w:document', null)).toThrowError(/not valid XML/);
    await expectAsync(readDocx(new Uint8Array([1, 2, 3]))).toBeRejectedWithError('This is not a .docx file.');
    const empty = await new JSZip().file('x.txt', 'x').generateAsync({ type: 'uint8array' });
    await expectAsync(readDocx(empty)).toBeRejectedWithError(/no word\/document.xml/);
  });

  it('reads a real zipped docx', async () => {
    const zip = new JSZip();
    zip.file('word/document.xml', doc(p(run('Title')) + `<w:tbl><w:tr>${tc(p(run('S')))}</w:tr></w:tbl>`));
    zip.file('word/styles.xml', styles);
    const c = await readDocx(await zip.generateAsync({ type: 'uint8array' }));
    expect(c.paragraphs).toEqual(['Title']);
    expect(c.tables[0].rows[0][0].runs[0].font).toBe('guido6+');
  });
});
