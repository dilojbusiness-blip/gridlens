import { Workbook } from 'exceljs';
import { inflateRawSync } from 'node:zlib';

export const MAX_XLSX = 10 * 1024 * 1024;
export function validateZip(data: Buffer): void {
  if (data.length > MAX_XLSX) throw new Error('XLSX exceeds the 10 MiB file limit.');
  let end = -1;
  for (let i = data.length - 22; i >= Math.max(0, data.length - 65557); i--) {
    if (data.readUInt32LE(i) === 0x06054b50 && i + 22 + data.readUInt16LE(i + 20) === data.length) { end = i; break; }
  }
  if (end < 0) throw new Error('Invalid XLSX ZIP directory. Encrypted workbooks are not supported.');
  const count = data.readUInt16LE(end + 10);
  let p = data.readUInt32LE(end + 16), total = 0;
  if (data.readUInt16LE(end + 4) || data.readUInt16LE(end + 6) || count > 2000 || count === 65535) throw new Error('Split or oversized ZIP archives are not supported.');
  const names = new Set<string>();
  for (let i = 0; i < count; i++) {
    if (p + 46 > end || data.readUInt32LE(p) !== 0x02014b50) throw new Error('Invalid ZIP entry.');
    const flags = data.readUInt16LE(p + 8), method = data.readUInt16LE(p + 10);
    const compressed = data.readUInt32LE(p + 20), unpacked = data.readUInt32LE(p + 24);
    const nameLength = data.readUInt16LE(p + 28), extra = data.readUInt16LE(p + 30), comment = data.readUInt16LE(p + 32);
    const local = data.readUInt32LE(p + 42);
    if (p + 46 + nameLength + extra + comment > end || local + 30 > p) throw new Error('Truncated ZIP entry.');
    const name = data.subarray(p + 46, p + 46 + nameLength).toString('utf8');
    if (names.has(name) || name.includes('..') || name.startsWith('/') || name.includes('\\')) throw new Error('Unsafe or duplicate ZIP path.');
    names.add(name);
    total += unpacked;
    if (total > 30 * 1024 * 1024 || unpacked > 10 * 1024 * 1024 || (flags & 1) || ![0, 8].includes(method)) throw new Error('Workbook is encrypted or exceeds unpacked limits.');
    if (data.readUInt32LE(local) !== 0x04034b50) throw new Error('Invalid ZIP local header.');
    const start = local + 30 + data.readUInt16LE(local + 26) + data.readUInt16LE(local + 28);
    if (start + compressed > p) throw new Error('Truncated ZIP data.');
    const part = data.subarray(start, start + compressed);
    const actual = method === 0 ? part : inflateRawSync(part, { maxOutputLength: Math.max(1, unpacked) });
    if (actual.length !== unpacked) throw new Error('ZIP entry size mismatch.');
    p += 46 + nameLength + extra + comment;
  }
  if (p !== end || !names.has('xl/workbook.xml')) throw new Error('Not a supported XLSX workbook.');
}

export interface SheetData { name: string; rows: string[][] }
export async function readWorkbook(data: Buffer): Promise<SheetData[]> {
  validateZip(data);
  const workbook = new Workbook();
  await workbook.xlsx.load(data as unknown as Parameters<Workbook['xlsx']['load']>[0]);
  let cells = 0;
  if (workbook.worksheets.length > 100) throw new Error('Workbook exceeds 100 sheets.');
  return workbook.worksheets.map(sheet => {
    if (sheet.rowCount > 100_001 || sheet.columnCount > 512) throw new Error('Sheet exceeds 100,001 rows or 512 columns.');
    const rows: string[][] = [];
    for (let r = 1; r <= sheet.rowCount; r++) {
      const row = sheet.getRow(r);
      cells += row.cellCount;
      if (cells > 1_000_000) throw new Error('Workbook exceeds 1 million cells.');
      rows.push(Array.from({ length: row.cellCount }, (_, c) => {
        const cell = row.getCell(c + 1);
        if (cell.value instanceof Date) return cell.value.toISOString();
        if (cell.formula && cell.result === undefined) return '=' + cell.formula;
        return cell.text;
      }));
    }
    return { name: sheet.name, rows };
  });
}