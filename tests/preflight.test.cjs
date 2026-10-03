const { test } = require('node:test');
const assert = require('node:assert/strict');
const { inspectTable } = require('../dist/pro/preflight');

test('Rectangular headerless tables pass and report dimensions including all rows', () => {
  assert.deepEqual(inspectTable([['001', '雪'], ['', '=1+1']]), {
    blocked: false, rows: 2, columns: 2, totalIssues: 0, issues: [], truncated: false,
  });
  assert.deepEqual(inspectTable([], {}), {
    blocked: false, rows: 0, columns: 0, totalIssues: 0, issues: [], truncated: false,
  });
});

test('Blank headers use trimmed checks and duplicate headers use exact strings', () => {
  const report = inspectTable([['id', ' ', 'id', ' id '], ['1', 'x', '2', '3']], { header: true });
  assert.deepEqual(report.issues, [
    { code: 'blank-header', rowIndex: 0, columnIndex: 1 },
    { code: 'duplicate-header', rowIndex: 0, columnIndex: 2 },
  ]);
  assert.equal(report.totalIssues, 2);
  assert.equal(report.blocked, true);
});

test('Every duplicate header after the first is identified', () => {
  const report = inspectTable([['name', 'name', 'name']], { header: true });
  assert.deepEqual(report.issues, [
    { code: 'duplicate-header', rowIndex: 0, columnIndex: 1 },
    { code: 'duplicate-header', rowIndex: 0, columnIndex: 2 },
  ]);
});

test('An empty table is blocked only when a header is required', () => {
  assert.deepEqual(inspectTable([], { header: true }), {
    blocked: true,
    rows: 0,
    columns: 0,
    totalIssues: 1,
    issues: [{ code: 'missing-header', rowIndex: 0 }],
    truncated: false,
  });
  assert.equal(inspectTable([], { header: false }).blocked, false);
  assert.equal(inspectTable([[]], { header: true }).blocked, true);
});

test('Ragged diagnostics retain zero-based source row numbers and first-row width', () => {
  const report = inspectTable([['a', 'b'], ['1'], ['2', '3'], ['4', '5', '6']], { header: true });
  assert.deepEqual(report.issues, [
    { code: 'ragged-row', rowIndex: 1, expectedColumns: 2, actualColumns: 1 },
    { code: 'ragged-row', rowIndex: 3, expectedColumns: 2, actualColumns: 3 },
  ]);
  assert.equal(report.rows, 4);
  assert.equal(report.columns, 2);
});

test('A zero-column first row remains the rectangular expectation', () => {
  const report = inspectTable([[], ['x'], []]);
  assert.deepEqual(report.issues, [
    { code: 'ragged-row', rowIndex: 1, expectedColumns: 0, actualColumns: 1 },
  ]);
});

test('Issue samples are capped while exact totals continue counting', () => {
  const rows = [[], ...Array.from({ length: 105 }, () => ['x'])];
  const report = inspectTable(rows, { maxIssues: 3 });
  assert.equal(report.totalIssues, 105);
  assert.equal(report.issues.length, 3);
  assert.equal(report.truncated, true);
  const none = inspectTable(rows, { maxIssues: 0 });
  assert.equal(none.totalIssues, 105);
  assert.deepEqual(none.issues, []);
  assert.equal(none.truncated, true);
});

test('String values and options are not normalized or mutated', () => {
  const rows = [[' id ', ''], ['001', '=1+1']];
  const options = { header: true, maxIssues: 10 };
  const before = JSON.stringify({ rows, options });
  const report = inspectTable(rows, options);
  assert.equal(JSON.stringify({ rows, options }), before);
  assert.deepEqual(report.issues, [{ code: 'blank-header', rowIndex: 0, columnIndex: 1 }]);
  assert.equal(JSON.stringify(report).includes('001'), false);
  assert.equal(JSON.stringify(report).includes('=1+1'), false);
});

test('Malformed rows, cells and options are rejected', () => {
  assert.throws(() => inspectTable(null), /rows must be an array/i);
  assert.throws(() => inspectTable([['x'], 'bad']), /row 1 must be an array/i);
  assert.throws(() => inspectTable([['x', 1]]), /must be a string/i);
  assert.throws(() => inspectTable([['x']], null), /options must be an object/i);
  assert.throws(() => inspectTable([['x']], { header: 'yes' }), /header must be a boolean/i);
  for (const maxIssues of [-1, 0.5, 1001, Infinity]) {
    assert.throws(() => inspectTable([['x']], { maxIssues }), /maxIssues/i);
  }
});

test('Row, column and total-cell limits are enforced', () => {
  assert.throws(() => inspectTable(Array(100_002).fill(['x'])), /row limit/i);
  assert.throws(() => inspectTable([Array(513).fill('x')]), /column limit/i);
  const wideRow = Array(512).fill('x');
  assert.throws(() => inspectTable(Array(1_954).fill(wideRow)), /cell limit/i);
});