import { Workbook } from 'exceljs';
import { validateZip } from '../xlsx';

export async function exportValues(rows: string[][], sheetName = 'GridLens'): Promise<Buffer> {
  if (!Array.isArray(rows) || rows.length > 100_001) throw new Error('Export exceeds the row limit.');
  if (typeof sheetName !== 'string' || !sheetName || sheetName.length > 31 || /[\[\]*?:/\\\x00-\x1f]/.test(sheetName) || /^'|'$/.test(sheetName)) throw new Error('Invalid worksheet name.');
  let cells = 0, bytes = 0;
  for (const row of rows) {
    if (!Array.isArray(row) || row.length > 512) throw new Error('Export exceeds the column limit.');
    for (const value of row) {
      if (typeof value !== 'string' || value.length > 32767 || /[\x00-\x08\x0b\x0c\x0e-\x1f\ufffe\uffff]/.test(value)) throw new Error('A cell contains unsupported text or exceeds Excel limits.');
      if (++cells > 1_000_000) throw new Error('Export exceeds the cell limit.');
      bytes += Buffer.byteLength(value, 'utf8');
      if (bytes > 10 * 1024 * 1024) throw new Error('Export text exceeds the 10 MiB limit.');
    }
  }
  const book = new Workbook();
  const sheet = book.addWorksheet(sheetName);
  // String values keep leading zeros and formula-like input literal in Excel.
  for (const row of rows) sheet.addRow(row);
  const output = Buffer.from(await book.xlsx.writeBuffer());
  validateZip(output);
  return output;
}