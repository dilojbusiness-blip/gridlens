import { parse } from './csv/csv';
import { inspectTable } from './pro/preflight';
import { reconcileRows } from './pro/reconcile';

export function compareDemo(input: { left: string; right: string; header: boolean; leftKey: number; rightKey: number }) {
  if (!input || typeof input.left !== 'string' || typeof input.right !== 'string' || typeof input.header !== 'boolean') throw new Error('Invalid comparison input.');
  const tables = [input.left, input.right].map(text => {
    if (text.length > 1_048_576 || new TextEncoder().encode(text).length > 1_048_576) throw new Error('Demo limit: 1 MiB per input. Use the VS Code extension for larger files.');
    const rows = parse(text).rows.map(row => row.cells.map(cell => cell.text));
    if (rows.length > 10_000 || rows.some(row => row.length > 100) || rows.reduce((n, row) => n + row.length, 0) > 100_000) throw new Error('Demo limit: 10,000 rows, 100 columns and 100,000 cells per input.');
    return rows;
  });
  const structure = tables.map((rows, index) => ({ side: index === 0 ? 'Left' : 'Right', ...inspectTable(rows, { header: input.header, maxIssues: 20 }) }));
  if (structure.some(table => table.blocked)) return { kind: 'structure', tables: structure };
  const report = reconcileRows(tables[0], tables[1], { leftKeyColumn: input.leftKey - 1, rightKeyColumn: input.rightKey - 1, header: input.header, maxChanges: 100 });
  // Retain exact issue totals but bound identifiers and duplicate-row samples.
  for (const side of ['left', 'right'] as const) {
    const issues = report.issues[side];
    Object.assign(issues, { blankTotal: issues.blankKeyRows.length, duplicateTotal: issues.duplicateKeys.length });
    issues.blankKeyRows = issues.blankKeyRows.slice(0, 20);
    issues.duplicateKeys = issues.duplicateKeys.slice(0, 20).map(issue => ({ key: issue.key.slice(0, 200), rowIndices: issue.rowIndices.slice(0, 20) }));
  }
  for (const change of report.changes) {
    change.key = change.key.slice(0, 200);
    if (change.type === 'changed') change.deltas = change.deltas.map(delta => ({ ...delta, leftValue: delta.leftValue.slice(0, 200), rightValue: delta.rightValue.slice(0, 200) }));
  }
  return { kind: 'comparison', report };
}

const worker = globalThis as typeof globalThis & { postMessage?: (value: unknown) => void; onmessage?: (event: { data: unknown }) => void };
if (typeof worker.postMessage === 'function' && !('document' in globalThis)) {
  worker.onmessage = event => {
    try { worker.postMessage!({ ok: true, result: compareDemo(event.data as Parameters<typeof compareDemo>[0]) }); }
    catch (error) { worker.postMessage!({ ok: false, message: error instanceof Error ? error.message : 'Comparison failed.' }); }
  };
}