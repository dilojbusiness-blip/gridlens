export interface ReconcileOptions {
  leftKeyColumn: number;
  rightKeyColumn: number;
  header?: boolean;
  maxChanges?: number;
}

export interface ReconcileCounts {
  same: number;
  changed: number;
  added: number;
  removed: number;
}

export interface DuplicateKeyIssue {
  key: string;
  rowIndices: number[];
}

export interface SideKeyIssues {
  blankKeyRows: number[];
  duplicateKeys: DuplicateKeyIssue[];
}

export interface ReconcileIssues {
  left: SideKeyIssues;
  right: SideKeyIssues;
}

export interface ColumnDelta {
  column: number | string;
  leftColumnIndex: number;
  rightColumnIndex: number;
  leftValue: string;
  rightValue: string;
}

export interface ChangedRow {
  type: 'changed';
  key: string;
  leftRowIndex: number;
  rightRowIndex: number;
  deltas: ColumnDelta[];
}

export interface RemovedRow {
  type: 'removed';
  key: string;
  leftRowIndex: number;
}

export interface AddedRow {
  type: 'added';
  key: string;
  rightRowIndex: number;
}

export type ReconcileChange = ChangedRow | RemovedRow | AddedRow;

export interface ReconcileReport {
  blocked: boolean;
  counts: ReconcileCounts | null;
  issues: ReconcileIssues;
  changes: ReconcileChange[];
  truncated: boolean;
}

const MAX_ROWS = 100_001;
const MAX_COLUMNS = 512;
const MAX_CELLS = 1_000_000;
const MAX_CHANGES = 10_000;

interface ValidatedTable {
  width: number | null;
  headers: string[] | null;
}

interface ColumnPair {
  left: number;
  right: number;
  label: number | string;
}

function validateColumnIndex(value: unknown, name: string): number {
  if (!Number.isInteger(value) || (value as number) < 0 || (value as number) >= MAX_COLUMNS) {
    throw new RangeError(`${name} must be an integer from 0 to ${MAX_COLUMNS - 1}.`);
  }
  return value as number;
}

function validateTable(rows: string[][], header: boolean, side: string): ValidatedTable {
  if (!Array.isArray(rows)) throw new TypeError(`${side} rows must be an array.`);
  if (rows.length > MAX_ROWS) throw new RangeError(`${side} exceeds the ${MAX_ROWS}-row limit.`);

  let width: number | null = null;
  let cells = 0;
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex];
    if (!Array.isArray(row)) throw new TypeError(`${side} row ${rowIndex} must be an array.`);
    if (row.length > MAX_COLUMNS) throw new RangeError(`${side} row ${rowIndex} exceeds the ${MAX_COLUMNS}-column limit.`);
    if (width === null) width = row.length;
    else if (row.length !== width) throw new Error(`${side} has a ragged row at index ${rowIndex}.`);
    cells += row.length;
    if (cells > MAX_CELLS) throw new RangeError(`${side} exceeds the ${MAX_CELLS}-cell limit.`);
    for (let columnIndex = 0; columnIndex < row.length; columnIndex++) {
      if (typeof row[columnIndex] !== 'string') {
        throw new TypeError(`${side} cell at row ${rowIndex}, column ${columnIndex} must be a string.`);
      }
    }
  }

  if (!header) return { width, headers: null };
  if (rows.length === 0) throw new Error(`${side} is missing its header row.`);
  if (width === 0) throw new Error(`${side} header row is blank.`);

  const headers = rows[0];
  const seen = new Set<string>();
  for (const name of headers) {
    if (name.trim() === '') throw new Error(`${side} contains a blank header.`);
    if (seen.has(name)) throw new Error(`${side} contains duplicate header ${JSON.stringify(name)}.`);
    seen.add(name);
  }
  return { width, headers };
}

function emptyIssues(): SideKeyIssues {
  return { blankKeyRows: [], duplicateKeys: [] };
}

function indexKeys(rows: string[][], keyColumn: number, firstDataRow: number): { rowsByKey: Map<string, number>; issues: SideKeyIssues } {
  const rowsByKey = new Map<string, number>();
  const allRowsByKey = new Map<string, number[]>();
  const issues = emptyIssues();
  for (let rowIndex = firstDataRow; rowIndex < rows.length; rowIndex++) {
    const key = rows[rowIndex][keyColumn];
    if (key.trim() === '') {
      issues.blankKeyRows.push(rowIndex);
      continue;
    }
    const indices = allRowsByKey.get(key);
    if (indices) indices.push(rowIndex);
    else {
      allRowsByKey.set(key, [rowIndex]);
      rowsByKey.set(key, rowIndex);
    }
  }
  for (const [key, rowIndices] of allRowsByKey) {
    if (rowIndices.length > 1) issues.duplicateKeys.push({ key, rowIndices });
  }
  return { rowsByKey, issues };
}

function hasKeyIssues(issues: SideKeyIssues): boolean {
  return issues.blankKeyRows.length > 0 || issues.duplicateKeys.length > 0;
}

/**
 * Reconciles two rectangular string tables without coercing or modifying values.
 * Row indices in the report are zero-based indices into the original inputs.
 */
export function reconcileRows(left: string[][], right: string[][], options: ReconcileOptions): ReconcileReport {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new TypeError('Reconciliation options are required.');
  const leftKeyColumn = validateColumnIndex(options.leftKeyColumn, 'leftKeyColumn');
  const rightKeyColumn = validateColumnIndex(options.rightKeyColumn, 'rightKeyColumn');
  if (options.header !== undefined && typeof options.header !== 'boolean') throw new TypeError('header must be a boolean.');
  const header = options.header ?? false;
  const maxChanges = options.maxChanges ?? 1000;
  if (!Number.isInteger(maxChanges) || maxChanges < 0 || maxChanges > MAX_CHANGES) {
    throw new RangeError(`maxChanges must be an integer from 0 to ${MAX_CHANGES}.`);
  }

  const leftTable = validateTable(left, header, 'Left');
  const rightTable = validateTable(right, header, 'Right');
  let columnPairs: ColumnPair[];
  let width: number;

  if (header) {
    const leftHeaders = leftTable.headers!;
    const rightHeaders = rightTable.headers!;
    if (leftHeaders.length !== rightHeaders.length) throw new Error('Header schemas have different column counts.');
    const rightColumns = new Map(rightHeaders.map((name, index) => [name, index]));
    for (const name of leftHeaders) {
      if (!rightColumns.has(name)) throw new Error(`Right header schema is missing ${JSON.stringify(name)}.`);
    }
    columnPairs = leftHeaders.map((name, leftIndex) => ({ left: leftIndex, right: rightColumns.get(name)!, label: name }));
    width = leftHeaders.length;
  } else {
    if (leftTable.width !== null && rightTable.width !== null && leftTable.width !== rightTable.width) {
      throw new Error('Tables have different column counts.');
    }
    const resolvedWidth = leftTable.width ?? rightTable.width;
    if (resolvedWidth === null) throw new Error('Cannot determine a schema from two empty tables.');
    width = resolvedWidth;
    columnPairs = Array.from({ length: width }, (_, index) => ({ left: index, right: index, label: index }));
  }

  if (leftKeyColumn >= width) throw new RangeError('leftKeyColumn is outside the left schema.');
  if (rightKeyColumn >= width) throw new RangeError('rightKeyColumn is outside the right schema.');

  const firstDataRow = header ? 1 : 0;
  const leftIndex = indexKeys(left, leftKeyColumn, firstDataRow);
  const rightIndex = indexKeys(right, rightKeyColumn, firstDataRow);
  const issues: ReconcileIssues = { left: leftIndex.issues, right: rightIndex.issues };
  if (hasKeyIssues(issues.left) || hasKeyIssues(issues.right)) {
    return { blocked: true, counts: null, issues, changes: [], truncated: false };
  }

  const counts: ReconcileCounts = { same: 0, changed: 0, added: 0, removed: 0 };
  const changes: ReconcileChange[] = [];
  const append = (change: ReconcileChange): void => {
    if (changes.length < maxChanges) changes.push(change);
  };

  for (let leftRowIndex = firstDataRow; leftRowIndex < left.length; leftRowIndex++) {
    const key = left[leftRowIndex][leftKeyColumn];
    const rightRowIndex = rightIndex.rowsByKey.get(key);
    if (rightRowIndex === undefined) {
      counts.removed++;
      append({ type: 'removed', key, leftRowIndex });
      continue;
    }

    const deltas: ColumnDelta[] = [];
    for (const pair of columnPairs) {
      const leftValue = left[leftRowIndex][pair.left];
      const rightValue = right[rightRowIndex][pair.right];
      if (leftValue !== rightValue) {
        deltas.push({
          column: pair.label,
          leftColumnIndex: pair.left,
          rightColumnIndex: pair.right,
          leftValue,
          rightValue,
        });
      }
    }
    if (deltas.length === 0) counts.same++;
    else {
      counts.changed++;
      append({ type: 'changed', key, leftRowIndex, rightRowIndex, deltas });
    }
  }

  for (let rightRowIndex = firstDataRow; rightRowIndex < right.length; rightRowIndex++) {
    const key = right[rightRowIndex][rightKeyColumn];
    if (!leftIndex.rowsByKey.has(key)) {
      counts.added++;
      append({ type: 'added', key, rightRowIndex });
    }
  }

  const differenceCount = counts.changed + counts.added + counts.removed;
  return { blocked: false, counts, issues, changes, truncated: changes.length < differenceCount };
}