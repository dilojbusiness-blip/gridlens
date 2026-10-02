const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Workbook } = require('exceljs');
const { readWorkbook, validateZip } = require('../dist/xlsx');

test('Read multiple sheets, sparse cells, Unicode, cached formula and dates', async () => {
  const book = new Workbook(); const one = book.addWorksheet('Data');
  one.addRow(['Name', 'Amount']); one.addRow(['雪', 42]); one.getCell('D4').value = { formula: 'B2+1', result: 43 };
  book.addWorksheet('Dates').addRow([new Date('2026-10-02T00:00:00Z'), true]);
  const rows = await readWorkbook(Buffer.from(await book.xlsx.writeBuffer()));
  assert.equal(rows.length, 2); assert.equal(rows[0].rows[1][0], '雪'); assert.equal(rows[0].rows[3][3], '43');
  assert.equal(rows[1].rows[0][0], '2026-10-02T00:00:00.000Z');
});
test('Reject truncated, bogus and oversized workbooks', async () => {
  for (const input of [Buffer.alloc(0), Buffer.from('bad'), Buffer.alloc(11 * 1024 * 1024)]) assert.throws(() => validateZip(input));
  const book = new Workbook(); book.addWorksheet('One').addRow([1]);
  const buffer = Buffer.from(await book.xlsx.writeBuffer());
  assert.throws(() => validateZip(buffer.subarray(0, buffer.length - 10)));
});