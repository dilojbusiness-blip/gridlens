export interface ColumnSummary {
  rows: number;
  present: number;
  blank: number;
  distinct: number;
  numeric: number;
  sum: number | null;
  min: number | null;
  max: number | null;
  mean: number | null;
}

const NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
function numericValue(value: string): number | null {
  const text = value.trim();
  if (!NUMBER.test(text)) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

function validate(rows: string[][], columns: number[]): void {
  if (!Array.isArray(rows) || rows.length > 100_001) throw new Error('Summary exceeds the row limit.');
  if (columns.some(c => !Number.isInteger(c) || c < 0 || c >= 512)) throw new Error('Invalid summary column.');
  let count = 0;
  for (const row of rows) {
    if (!Array.isArray(row) || row.length > 512 || row.some(c => typeof c !== 'string')) throw new Error('Invalid summary data.');
    count += row.length;
    if (count > 1_000_000) throw new Error('Summary exceeds the cell limit.');
  }
}

export function summarizeColumn(rows: string[][], column: number): ColumnSummary {
  validate(rows, [column]);
  const distinct = new Set<string>();
  let blank = 0, numeric = 0, sum = 0, compensation = 0;
  let min: number | null = null, max: number | null = null;
  for (const row of rows) {
    const value = row[column] ?? '';
    if (value.trim() === '') { blank++; continue; }
    distinct.add(value);
    const n = numericValue(value);
    if (n === null) continue;
    numeric++;
    min = min === null ? n : Math.min(min, n);
    max = max === null ? n : Math.max(max, n);
    const adjusted = n - compensation;
    const next = sum + adjusted;
    compensation = next - sum - adjusted;
    sum = next;
  }
  const finiteSum = numeric && Number.isFinite(sum) ? sum : null;
  return { rows: rows.length, present: rows.length - blank, blank, distinct: distinct.size, numeric, sum: finiteSum, min, max, mean: finiteSum === null ? null : finiteSum / numeric };
}

export interface GroupSummary { group: string; rows: number; numeric: number; sum: number | null }
export function summarizeGroups(rows: string[][], groupColumn: number, valueColumn: number): GroupSummary[] {
  validate(rows, [groupColumn, valueColumn]);
  const groups = new Map<string, GroupSummary>();
  const compensation = new Map<string, number>();
  for (const row of rows) {
    const key = row[groupColumn] ?? '';
    if (!groups.has(key)) {
      if (groups.size >= 10_000) throw new Error('Grouped summary exceeds 10,000 groups.');
      groups.set(key, { group: key, rows: 0, numeric: 0, sum: null });
    }
    const group = groups.get(key)!;
    group.rows++;
    const value = numericValue(row[valueColumn] ?? '');
    if (value !== null) {
      group.numeric++;
      const previous = group.sum ?? 0;
      const adjusted = value - (compensation.get(key) ?? 0);
      const sum = previous + adjusted;
      if (!Number.isFinite(sum)) throw new Error('Grouped total exceeds numeric limits.');
      compensation.set(key, sum - previous - adjusted);
      group.sum = sum;
    }
  }
  return [...groups.values()];
}