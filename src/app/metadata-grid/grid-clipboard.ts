/** Cells as the clipboard holds them when copied from or pasted into Excel, Numbers or LibreOffice: tab-separated. */

/** A cell with a tab, a line break or a quote in it is quoted, and quotes in it are doubled (what Excel does). */
export function toTsv(rows: string[][]): string {
  return rows
    .map((row) => row.map((cell) => (/[\t\r\n"]/.test(cell) ? '"' + cell.replace(/"/g, '""') + '"' : cell)).join('\t'))
    .join('\n');
}

/**
 * The inverse of `toTsv`, for text from any spreadsheet. Rows end at a line break outside quotes, cells at a tab.
 * One trailing line break (Excel adds it) is not an empty row. A cell that starts with a quote is quoted; a quote
 * in the middle of an unquoted cell is just a quote.
 */
export function parseTsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let i = 0;
  const n = text.length;
  let atCellStart = true;
  while (i < n) {
    const ch = text[i];
    if (atCellStart && ch === '"') {
      // quoted cell: up to the closing quote; "" is a quote
      i++;
      for (; i < n; i++) {
        if (text[i] === '"') {
          if (text[i + 1] === '"') { cell += '"'; i++; } else { i++; break; }
        } else {
          cell += text[i];
        }
      }
      atCellStart = false;
      continue;
    }
    if (ch === '\t') {
      row.push(cell); cell = ''; atCellStart = true; i++;
    } else if (ch === '\n' || ch === '\r') {
      row.push(cell); rows.push(row); row = []; cell = ''; atCellStart = true;
      i += ch === '\r' && text[i + 1] === '\n' ? 2 : 1;
    } else {
      cell += ch; atCellStart = false; i++;
    }
  }
  // the last row, unless the text ended on a line break
  if (!atCellStart || row.length > 0 || cell !== '') { row.push(cell); rows.push(row); }
  return rows;
}
