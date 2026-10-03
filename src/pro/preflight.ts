export type PreflightIssueCode =
  | 'ragged-row'
  | 'blank-header'
  | 'duplicate-header'
  | 'missing-header';

export interface PreflightIssue {
  code: PreflightIssueCode;
  rowIndex: number;
  columnIndex?: number;
  expectedColumns?: number;
  actualColumns?: number;
}

export interface PreflightOptions {
  header?: boolean;
  maxIssues?: number;
}

export interface PreflightReport {
  blocked: boolean;
  rows: number;
  columns: number;
  totalIssues: number;
  issues: PreflightIssue[];
  truncated: boolean;
}

const MAX_ROWS = 100_001;
const MAX_COLUMNS = 512;
const MAX_CELLS = 1_000_000;
const MAX_ISSUES = 1_000;

export function inspectTable(rows: string[][], options: PreflightOptions = {}): PreflightReport {
  if (!Array.isArray(rows)) throw new TypeError('rows must be an array.');
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('options must be an object.');
  }
  if (options.header !== undefined && typeof options.header !== 'boolean') {
    throw new TypeError('header must be a boolean.');
  }
  const maxIssues = options.maxIssues ?? 100;
  if (!Number.isInteger(maxIssues) || maxIssues < 0 || maxIssues > MAX_ISSUES) {
    throw new RangeError(`maxIssues must be an integer from 0 to ${MAX_ISSUES}.`);
  }
  if (rows.length > MAX_ROWS) throw new RangeError(`Table exceeds the ${MAX_ROWS}-row limit.`);

  let cells = 0;
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex];
    if (!Array.isArray(row)) throw new TypeError(`Row ${rowIndex} must be an array.`);
    if (row.length > MAX_COLUMNS) {
      throw new RangeError(`Row ${rowIndex} exceeds the ${MAX_COLUMNS}-column limit.`);
    }
    cells += row.length;
    if (cells > MAX_CELLS) throw new RangeError(`Table exceeds the ${MAX_CELLS}-cell limit.`);
    for (let columnIndex = 0; columnIndex < row.length; columnIndex++) {
      if (typeof row[columnIndex] !== 'string') {
        throw new TypeError(`Cell at row ${rowIndex}, column ${columnIndex} must be a string.`);
      }
    }
  }

  const issues: PreflightIssue[] = [];
  let totalIssues = 0;
  const record = (issue: PreflightIssue): void => {
    totalIssues++;
    if (issues.length < maxIssues) issues.push(issue);
  };
  const columns = rows[0]?.length ?? 0;

  if (options.header && (rows.length === 0 || columns === 0)) {
    record({ code: 'missing-header', rowIndex: 0 });
  } else if (options.header) {
    const seen = new Set<string>();
    for (let columnIndex = 0; columnIndex < rows[0].length; columnIndex++) {
      const name = rows[0][columnIndex];
      if (name.trim() === '') record({ code: 'blank-header', rowIndex: 0, columnIndex });
      if (seen.has(name)) record({ code: 'duplicate-header', rowIndex: 0, columnIndex });
      else seen.add(name);
    }
  }

  for (let rowIndex = 1; rowIndex < rows.length; rowIndex++) {
    if (rows[rowIndex].length !== columns) {
      record({
        code: 'ragged-row',
        rowIndex,
        expectedColumns: columns,
        actualColumns: rows[rowIndex].length,
      });
    }
  }

  return {
    blocked: totalIssues > 0,
    rows: rows.length,
    columns,
    totalIssues,
    issues,
    truncated: totalIssues > issues.length,
  };
}