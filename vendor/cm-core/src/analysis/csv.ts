/**
 * CSV text of a result table, for download. Comma separated, `"` quoted where needed, a header row, `\n` line ends.
 */
import { cellText } from './result';
import type { Cell, TableView } from './result';

function esc(cell: Cell): string {
  const s = cellText(cell);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function tableToCsv(table: Pick<TableView, 'columns' | 'rows'>): string {
  const lines = [table.columns.map((c) => esc(c.label)).join(',')];
  for (const row of table.rows) lines.push(row.map(esc).join(','));
  return lines.join('\n') + '\n';
}
