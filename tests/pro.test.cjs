const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Workbook } = require('exceljs');
const { summarizeColumn, summarizeGroups } = require('../dist/pro/analytics');
const { exportValues } = require('../dist/pro/export');
const { assessLicense } = require('../dist/pro/license');

test('Column summaries handle blanks, strict numbers and stable totals without altering values', () => {
  const rows = [['1'], ['2.5'], ['  '], [], ['10usd'], ['0x10'], ['Infinity'], ['1e2'], ['雪'], ['001']];
  const before = JSON.stringify(rows);
  assert.deepEqual(summarizeColumn(rows, 0), { rows: 10, present: 8, blank: 2, distinct: 8, numeric: 4, sum: 104.5, min: 1, max: 100, mean: 26.125 });
  assert.equal(JSON.stringify(rows), before);
  assert.equal(summarizeColumn([['0.1'], ['0.2'], ['0.3']], 0).sum, 0.6);
  assert.equal(summarizeColumn([['1e308'], ['1e308']], 0).sum, null);
  assert.equal(summarizeColumn([], 0).mean, null);
});

test('Grouped summaries use literal keys and reject invalid inputs', () => {
  assert.deepEqual(summarizeGroups([['__proto__', '2'], ['__proto__', '3'], ['雪', 'not numeric'], ['', '1']], 0, 1), [
    { group: '__proto__', rows: 2, numeric: 2, sum: 5 }, { group: '雪', rows: 1, numeric: 0, sum: null }, { group: '', rows: 1, numeric: 1, sum: 1 },
  ]);
  for (const column of [-1, 0.5, 512, NaN]) assert.throws(() => summarizeColumn([['x']], column));
  assert.throws(() => summarizeColumn([[{}]], 0));
  assert.throws(() => summarizeGroups([['x', '1e308'], ['x', '1e308']], 0, 1));
  assert.throws(() => summarizeGroups(Array.from({length:10001}, (_, i) => [String(i)]), 0, 1));
  const amounts = [['x','0.1'], ['x','0.2'], ['x','0.3']];
  assert.equal(summarizeGroups(amounts, 0, 1)[0].sum, summarizeColumn(amounts, 1).sum);
});

test('Values-only XLSX export preserves Unicode, leading zeros and formula-like text', async () => {
  const rows = [['001', '=1+1', '+SUM(A1:A2)', '@sample', '雪\nquoted "text"'], ['https://example.invalid', '', '-12']];
  const output = await exportValues(rows);
  const book = new Workbook(); await book.xlsx.load(output);
  const sheet = book.getWorksheet('GridLens');
  for (let r=0;r<rows.length;r++) for (let c=0;c<rows[r].length;c++) {
    assert.equal(sheet.getCell(r+1,c+1).value, rows[r][c]);
    assert.equal(sheet.getCell(r+1,c+1).formula, undefined);
    assert.equal(sheet.getCell(r+1,c+1).hyperlink, undefined);
  }
});

test('XLSX export rejects unsafe dimensions, control characters and invalid sheet names', async () => {
  for (const value of ['x'.repeat(32768), '\x00', '\uffff', {}]) await assert.rejects(exportValues([[value]]));
  for (const name of ['', 'x/y', "'bad", "bad'", 'x'.repeat(32)]) await assert.rejects(exportValues([['x']], name));
  await assert.rejects(exportValues([Array(513).fill('x')]));
});

const product = {storeId: 101, productId: 202, variantId: 303};
const id = '00000000-0000-4000-8000-000000000001';
const key = 'synthetic-unit-test-license';
const response = overrides => ({ activated:true, valid:true, error:null, license_key:{status:'active',key,expires_at:null}, meta:{store_id:101,product_id:202,variant_id:303}, instance:{id}, ...overrides });
const expectation = overrides => ({product,key,operation:'validate',instanceId:id,now:Date.parse('2026-10-02T00:00:00Z'),...overrides});

test('License assessment binds store, product, variant, key and activated instance', () => {
  assert.deepEqual(assessLicense(response(), expectation()), {allowed:true,instanceId:id,expiresAt:null});
  assert.equal(assessLicense(response(), expectation({operation:'activate',instanceId:undefined})).allowed, true);
  for (const field of ['store_id', 'product_id', 'variant_id']) {
    const body = response(); body.meta[field] = 999;
    assert.equal(assessLicense(body, expectation()).reason, 'product');
  }
  assert.equal(assessLicense(response({instance:null}), expectation()).reason, 'instance');
  assert.equal(assessLicense(response(), expectation({instanceId:'00000000-0000-4000-8000-000000000002'})).reason, 'instance');
});

test('License assessment rejects revoked, expired, malformed and unconfigured responses', () => {
  for (const status of ['inactive','expired','disabled']) {
    assert.equal(assessLicense(response({license_key:{status,key,expires_at:null}}), expectation()).allowed, false);
  }
  for (const body of [null, [], 'bad', response({valid:'true'}), response({error:'failed'}), response({license_key:{status:'active',key:'another',expires_at:null}})]) assert.equal(assessLicense(body,expectation()).allowed,false);
  assert.equal(assessLicense(response({license_key:{status:'active',key,expires_at:'2026-10-01T00:00:00Z'}}),expectation()).reason,'expired');
  for (const date of [undefined, 99, 'invalid']) assert.equal(assessLicense(response({license_key:{status:'active',key,expires_at:date}}),expectation()).allowed,false);
  assert.equal(assessLicense(response(),expectation({product:{storeId:0,productId:202,variantId:303}})).reason,'configuration');
  assert.equal(assessLicense(response(),expectation({instanceId:undefined})).reason,'configuration');
  assert.equal(assessLicense(response(),expectation({now:NaN})).reason,'configuration');
  assert.equal(JSON.stringify(assessLicense(response(),expectation())).includes(key),false);
});

test('Dated licenses accept upstream microseconds but reject impossible dates and expired boundary', () => {
  const dated = date => response({license_key:{status:'active',key,expires_at:date}});
  assert.equal(assessLicense(dated('2026-12-01T00:00:00.000000Z'),expectation()).allowed,true);
  assert.equal(assessLicense(dated('2026-02-30T00:00:00.000Z'),expectation()).reason,'invalid');
  assert.equal(assessLicense(dated('2026-10-02T00:00:00.000000Z'),expectation()).reason,'expired');
});