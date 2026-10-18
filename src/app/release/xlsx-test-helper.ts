import * as JSZip from 'jszip';

/**
 * Builds a small .xlsx for tests, written the way Excel writes it: strings in a shared table, sparse cells with
 * references, numbers, a boolean and an inline string. Not used by the app.
 */
export async function buildXlsx(sheets: { name: string; rows: (string | number | boolean | null)[][] }[]): Promise<Uint8Array> {
  const zip = new JSZip();
  const shared: string[] = [];
  const known = new Map<string, number>();
  const sharedIndex = (s: string): number => {
    let i = known.get(s);
    if (i === undefined) { i = shared.length; shared.push(s); known.set(s, i); }
    return i;
  };
  const colName = (i: number): string => {
    let n = i + 1, out = '';
    while (n > 0) { const m = (n - 1) % 26; out = String.fromCharCode(65 + m) + out; n = Math.floor((n - 1) / 26); }
    return out;
  };
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  sheets.forEach((sheet, k) => {
    const rowsXml = sheet.rows.map((row, r) => {
      const cells = row.map((v, c) => {
        if (v === null || v === '') return '';
        const ref = `${colName(c)}${r + 1}`;
        if (typeof v === 'number') return `<c r="${ref}"><v>${v}</v></c>`;
        if (typeof v === 'boolean') return `<c r="${ref}" t="b"><v>${v ? 1 : 0}</v></c>`;
        if (v.startsWith('inline:')) return `<c r="${ref}" t="inlineStr"><is><t>${esc(v.slice(7))}</t></is></c>`;
        return `<c r="${ref}" t="s"><v>${sharedIndex(v)}</v></c>`;
      }).join('');
      return `<row r="${r + 1}">${cells}</row>`;
    }).join('');
    zip.file(`xl/worksheets/sheet${k + 1}.xml`, `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rowsXml}</sheetData></worksheet>`);
  });

  zip.file('xl/sharedStrings.xml', `<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${shared.map((s) => `<si><t xml:space="preserve">${esc(s)}</t></si>`).join('')}</sst>`);
  zip.file('xl/workbook.xml', `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, k) => `<sheet name="${esc(s.name)}" sheetId="${k + 1}" r:id="rId${k + 1}"/>`).join('')}</sheets></workbook>`);
  zip.file('xl/_rels/workbook.xml.rels', `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_s, k) => `<Relationship Id="rId${k + 1}" Type="x" Target="worksheets/sheet${k + 1}.xml"/>`).join('')}</Relationships>`);
  return zip.generateAsync({ type: 'uint8array' });
}
