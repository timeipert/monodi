/**
 * LaTeX code of a result table, to copy into a paper: a `table` environment with `booktabs` rules (needs
 * `\usepackage{booktabs}`), one column per column of the result, numbers right-aligned, text left-aligned.
 */
import { cellText } from './result';
import type { TableView } from './result';
import { latexEscape } from './algorithms';

/** The most rows written; a longer table is cut and says so in a comment, so that nothing is left out unnoticed. */
export const LATEX_MAX_ROWS = 100;

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'table';
}

/** A number as text: a minus sign is set as a mathematical minus; other text is escaped. */
function cell(text: string, numeric: boolean): string {
  if (numeric && /^-\d/.test(text)) return `$-$${latexEscape(text.slice(1))}`;
  return latexEscape(text);
}

export interface LatexOptions {
  /** The caption; default: the title of the table without a leading “Table 3:”. */
  caption?: string;
  /** The label of the table; default: `tab:` and the title. */
  label?: string;
  maxRows?: number;
}

/** LaTeX for the rows given (the caller passes the rows that pass its filters, in the order shown). */
export function tableToLatex(table: Pick<TableView, 'title' | 'columns' | 'rows'>, opt: LatexOptions = {}): string {
  const max = Math.max(1, opt.maxRows ?? LATEX_MAX_ROWS);
  const rows = table.rows.slice(0, max);
  const spec = table.columns.map((c) => (c.numeric ? 'r' : 'l')).join('');
  const caption = opt.caption ?? table.title.replace(/^Table\s+\d+\s*[:.]\s*/i, '');
  const lines: string[] = ['% requires \\usepackage{booktabs}'];
  if (table.rows.length > rows.length) lines.push(`% the first ${rows.length} of ${table.rows.length} rows; the whole table is in the CSV`);
  lines.push(
    '\\begin{table}[htbp]',
    '  \\centering',
    '  \\small',
    `  \\caption{${latexEscape(caption)}}`,
    `  \\label{${opt.label ?? `tab:${slug(table.title)}`}}`,
    `  \\begin{tabular}{${spec}}`,
    '    \\toprule',
    `    ${table.columns.map((c) => latexEscape(c.label)).join(' & ')} \\\\`,
    '    \\midrule',
  );
  for (const r of rows) lines.push(`    ${r.map((c, i) => cell(cellText(c), !!table.columns[i]?.numeric)).join(' & ')} \\\\`);
  lines.push('    \\bottomrule', '  \\end{tabular}', '\\end{table}');
  return lines.join('\n') + '\n';
}
