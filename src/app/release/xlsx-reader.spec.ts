import * as JSZip from 'jszip';
import { readXlsx } from './xlsx-reader';
import { buildXlsx } from './xlsx-test-helper';

describe('readXlsx', () => {
  it('reads shared strings, numbers, booleans and inline strings, and keeps the gaps empty', async () => {
    const data = await buildXlsx([{ name: 'Sheet1', rows: [['A', null, 'C'], [null, 'B2', 12.5, true, 'inline:In & Out']]}]);
    const [sheet] = await readXlsx(data);
    expect(sheet.name).toBe('Sheet1');
    expect(sheet.rows[0]).toEqual(['A', '', 'C']);
    expect(sheet.rows[1]).toEqual(['', 'B2', '12.5', 'TRUE', 'In & Out']);
  });

  it('decodes entities and keeps text with markup characters', async () => {
    const [sheet] = await readXlsx(await buildXlsx([{ name: 'S', rows: [["Doc-Id' (intern)", 'a < b & "c"']] }]));
    expect(sheet.rows[0]).toEqual(["Doc-Id' (intern)", 'a < b & "c"']);
  });

  it('puts rows where their row number says, also when empty rows are left out', async () => {
    const zip = new JSZip();
    zip.file('xl/workbook.xml', '<workbook><sheets><sheet name="S" r:id="rId1"/></sheets></workbook>');
    zip.file('xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>');
    zip.file('xl/worksheets/sheet1.xml', '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>h</t></is></c></row><row r="4"><c r="C4" t="inlineStr"><is><t>x</t></is></c></row></sheetData></worksheet>');
    const [sheet] = await readXlsx(await zip.generateAsync({ type: 'uint8array' }));
    expect(sheet.rows.length).toBe(4);
    expect(sheet.rows[0]).toEqual(['h']);
    expect(sheet.rows[1]).toEqual([]);
    expect(sheet.rows[3]).toEqual(['', '', 'x']);
  });

  it('reads every sheet in the order of the workbook, and rich text as one string', async () => {
    const zip = new JSZip();
    zip.file('xl/workbook.xml', '<workbook><sheets><sheet name="One" r:id="rId2"/><sheet name="Two" r:id="rId1"/></sheets></workbook>');
    zip.file('xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="/xl/worksheets/sheet2.xml"/></Relationships>');
    zip.file('xl/sharedStrings.xml', '<sst><si><r><t>Aa </t></r><r><t>13</t></r><rPh><t>ignored</t></rPh></si></sst>');
    zip.file('xl/worksheets/sheet1.xml', '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row></sheetData></worksheet>');
    zip.file('xl/worksheets/sheet2.xml', '<worksheet><sheetData><row r="1"><c r="A1"><v>7</v></c></row></sheetData></worksheet>');
    const sheets = await readXlsx(await zip.generateAsync({ type: 'uint8array' }));
    expect(sheets.map((s) => s.name)).toEqual(['One', 'Two']);
    expect(sheets[0].rows).toEqual([['7']]);
    expect(sheets[1].rows).toEqual([['Aa 13']]);
  });

  it('refuses a file that is not an .xlsx', async () => {
    await expectAsync(readXlsx(new TextEncoder().encode('Dokumenten_ID;dontpublish'))).toBeRejectedWithError(/not an \.xlsx/);
  });

  it('reads a sheet of the size of the real export in a few seconds', async () => {
    const header = Array.from({ length: 146 }, (_, i) => 'H' + i);
    const rows: (string | null)[][] = [header];
    for (let r = 0; r < 10500; r++) rows.push(header.map((_, c) => (c % 3 === 0 ? (c === 3 ? `v${r}-${c}` : `value ${c} ${r % 40}`) : null)));
    const data = await buildXlsx([{ name: 'Sheet1', rows }]);
    const t0 = performance.now();
    const [sheet] = await readXlsx(data);
    expect(sheet.rows.length).toBe(10501);
    expect(sheet.rows[10500][3]).toBe('v10499-3');
    expect(performance.now() - t0).toBeLessThan(8000);
  });
});
