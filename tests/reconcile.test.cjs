const { test } = require('node:test');
const assert = require('node:assert/strict');
const { reconcileRows } = require('../dist/pro/reconcile');

const options = overrides => ({ leftKeyColumn: 0, rightKeyColumn: 0, ...overrides });

test('Identifiers and values compare as exact strings without numeric coercion', () => {
  const report = reconcileRows([['001', 'same'], ['1', 'old'], ['雪\nkey', 'x']], [['1', 'new'], ['雪\nkey', 'x'], ['001', 'same']], options());
  assert.deepEqual(report.counts, { same: 2, changed: 1, added: 0, removed: 0 });
  assert.deepEqual(report.changes, [{
    type: 'changed', key: '1', leftRowIndex: 1, rightRowIndex: 0,
    deltas: [{ column: 1, leftColumnIndex: 1, rightColumnIndex: 1, leftValue: 'old', rightValue: 'new' }],
  }]);
});

test('Pure row reordering does not produce changes', () => {
  const report = reconcileRows([['a', '1'], ['b', '2']], [['b', '2'], ['a', '1']], options());
  assert.deepEqual(report.counts, { same: 2, changed: 0, added: 0, removed: 0 });
  assert.deepEqual(report.changes, []);
  assert.equal(report.truncated, false);
});

test('Removed and changed rows follow left order, then additions follow right order', () => {
  const report = reconcileRows(
    [['remove-1', 'a'], ['change', 'old'], ['remove-2', 'b'], ['same', 'x']],
    [['add-1', 'c'], ['same', 'x'], ['change', 'new'], ['add-2', 'd']],
    options(),
  );
  assert.deepEqual(report.counts, { same: 1, changed: 1, added: 2, removed: 2 });
  assert.deepEqual(report.changes.map(change => [change.type, change.key]), [
    ['removed', 'remove-1'], ['changed', 'change'], ['removed', 'remove-2'], ['added', 'add-1'], ['added', 'add-2'],
  ]);
});

test('Header schemas compare by exact name when columns are reordered', () => {
  const left = [['id', 'name', 'note'], ['001', 'Ada', 'line 1\nline 2']];
  const right = [['note', 'id', 'name'], ['line 1\nline 2', '001', 'ADA']];
  const report = reconcileRows(left, right, options({ rightKeyColumn: 1, header: true }));
  assert.deepEqual(report.counts, { same: 0, changed: 1, added: 0, removed: 0 });
  assert.deepEqual(report.changes[0].deltas, [{
    column: 'name', leftColumnIndex: 1, rightColumnIndex: 2, leftValue: 'Ada', rightValue: 'ADA',
  }]);
  assert.equal(report.changes[0].leftRowIndex, 1);
  assert.equal(report.changes[0].rightRowIndex, 1);
});

test('Duplicate keys block reconciliation and identify every duplicate row', () => {
  const report = reconcileRows([['dup', '1'], ['dup', '2']], [['dup', '1']], options());
  assert.equal(report.blocked, true);
  assert.equal(report.counts, null);
  assert.deepEqual(report.issues.left.duplicateKeys, [{ key: 'dup', rowIndices: [0, 1] }]);
  assert.deepEqual(report.changes, []);
});

test('Empty and whitespace-only keys block reconciliation on either side', () => {
  const report = reconcileRows([['', '1'], ['ok', '2']], [['ok', '2'], [' \t\n', '3']], options());
  assert.equal(report.blocked, true);
  assert.deepEqual(report.issues.left.blankKeyRows, [0]);
  assert.deepEqual(report.issues.right.blankKeyRows, [1]);
  assert.equal(report.truncated, false);
});

test('Header mode rejects missing, different, duplicate and blank schemas', () => {
  assert.throws(() => reconcileRows([], [['id']], options({ header: true })), /missing.*header/i);
  assert.throws(() => reconcileRows([['id', 'name']], [['id', 'value']], options({ header: true })), /missing/i);
  assert.throws(() => reconcileRows([['id', 'id']], [['id', 'name']], options({ header: true })), /duplicate header/i);
  assert.throws(() => reconcileRows([['id', '  ']], [['id', 'name']], options({ header: true })), /blank header/i);
  assert.throws(() => reconcileRows([['ID']], [['id']], options({ header: true })), /missing/i);
});

test('Headerless mode rejects ragged and different-width schemas', () => {
  assert.throws(() => reconcileRows([['a'], ['b', 'x']], [['a']], options()), /ragged/i);
  assert.throws(() => reconcileRows([['a']], [['a', 'x']], options()), /different column counts/i);
  assert.throws(() => reconcileRows([], [], options()), /determine a schema/i);
});

test('Options require valid schema-bound indices and bounded sample limits', () => {
  for (const leftKeyColumn of [-1, 0.5, 512, NaN]) {
    assert.throws(() => reconcileRows([['a']], [['a']], options({ leftKeyColumn })));
  }
  assert.throws(() => reconcileRows([['a']], [['a']], options({ rightKeyColumn: 1 })), /outside/i);
  for (const maxChanges of [-1, 0.5, 10001, Infinity]) {
    assert.throws(() => reconcileRows([['a']], [['a']], options({ maxChanges })));
  }
  assert.throws(() => reconcileRows([['a']], [['a']], options({ header: 'yes' })), /boolean/i);
});

test('Input validation enforces rows, columns, cells and string-only cells per side', () => {
  assert.throws(() => reconcileRows(Array(100002).fill(['x']), [['x']], options()), /row limit/i);
  assert.throws(() => reconcileRows([Array(513).fill('x')], [['x']], options()), /column limit/i);
  assert.throws(() => reconcileRows(Array.from({ length: 1954 }, () => Array(512).fill('x')), [['x']], options()), /cell limit/i);
  assert.throws(() => reconcileRows([['x', 1]], [['x', '1']], options()), /must be a string/i);
});

test('Reconciliation does not mutate rows, cells or options', () => {
  const left = [['id', 'value'], ['001', 'before']];
  const right = [['value', 'id'], ['after', '001']];
  const settings = options({ rightKeyColumn: 1, header: true, maxChanges: 5 });
  const before = JSON.stringify({ left, right, settings });
  reconcileRows(left, right, settings);
  assert.equal(JSON.stringify({ left, right, settings }), before);
});

test('Capped samples retain exact totals and never split a changed row', () => {
  const left = [['a', 'old', 'same'], ['b', 'old', 'left'], ['remove', 'x', 'x'], ['same', 'z', 'z']];
  const right = [['a', 'new', 'same'], ['b', 'new', 'right'], ['same', 'z', 'z'], ['add', 'y', 'y']];
  const report = reconcileRows(left, right, options({ maxChanges: 2 }));
  assert.deepEqual(report.counts, { same: 1, changed: 2, added: 1, removed: 1 });
  assert.equal(report.changes.length, 2);
  assert.deepEqual(report.changes.map(change => change.key), ['a', 'b']);
  assert.deepEqual(report.changes[1].deltas.map(delta => delta.column), [1, 2]);
  assert.equal(report.truncated, true);
  assert.equal(reconcileRows(left, right, options({ maxChanges: 0 })).changes.length, 0);
});

test('The default sample cap is 1000 and totals remain exact beyond it', () => {
  const left = Array.from({ length: 1005 }, (_, index) => [String(index), 'left']);
  const right = Array.from({ length: 1005 }, (_, index) => [String(index), 'right']);
  const report = reconcileRows(left, right, options());
  assert.equal(report.counts.changed, 1005);
  assert.equal(report.changes.length, 1000);
  assert.equal(report.truncated, true);
});

test('An empty side uses the other side schema for exact adds or removals', () => {
  assert.deepEqual(reconcileRows([], [['a'], ['b']], options()).counts, { same: 0, changed: 0, added: 2, removed: 0 });
  assert.deepEqual(reconcileRows([['a'], ['b']], [], options()).counts, { same: 0, changed: 0, added: 0, removed: 2 });
});

test('100,000 rows reconcile within practical bounded input limits', t => {
  const left = Array.from({ length: 100000 }, (_, index) => [String(index), `value ${index}`]);
  const right = Array.from({ length: 100000 }, (_, index) => [String(99999 - index), `value ${99999 - index}`]);
  const start = performance.now();
  const report = reconcileRows(left, right, options());
  assert.deepEqual(report.counts, { same: 100000, changed: 0, added: 0, removed: 0 });
  assert.equal(report.changes.length, 0);
  t.diagnostic(`100k rows reconciled in ${Math.round(performance.now() - start)} ms`);
});