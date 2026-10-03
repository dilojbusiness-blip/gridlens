const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { LicenseClient, requestLicense } = require('../dist/pro/licenseClient');
const { exportValues } = require('../dist/pro/export');
const { Workbook } = require('exceljs');

const TEST_PRODUCT_ID = 1409217;
let phase = 'read test credential';
let cleanup;
let failure = 'unexpected-test-failure';
const directory = 'D:\\VSCodeData\\Temp\\gridlens-merchant-test';
const requireAllowed = result => {
  if (!result.allowed) {
    failure = ['configuration', 'missing', 'rejected', 'activation_limit', 'different_key', 'unavailable', 'storage'].includes(result.reason) ? result.reason : 'license-denied';
    throw new Error('License step failed');
  }
};
(async () => {
  const key = process.env.GRIDLENS_TEST_LICENSE?.trim();
  delete process.env.GRIDLENS_TEST_LICENSE;
  if (!key || key.length > 256 || key.startsWith('#') || /^\d+$/.test(key)) {
    failure = 'license-key-required-not-order-number';
    throw new Error('Invalid test input');
  }
  phase = 'verify internal test product';
  const preflight = await requestLicense('validate', { license_key: key });
  if (preflight?.valid !== true) { failure = 'license-rejected'; throw new Error('Invalid test license'); }
  assert.equal(preflight.valid, true);
  assert.equal(preflight.error, null);
  assert.equal(preflight.meta?.product_id, TEST_PRODUCT_ID);
  assert.equal(preflight.meta?.product_name, 'GridLens Pro — INTERNAL TEST ONLY');
  const product = { storeId: preflight.meta.store_id, productId: TEST_PRODUCT_ID, variantId: preflight.meta.variant_id };
  assert.ok(Object.values(product).every(n => Number.isSafeInteger(n) && n > 0));
  const secret = new Map();
  const store = { get: async name => secret.get(name), store: async (name, value) => { secret.set(name, value); }, delete: async name => { secret.delete(name); } };
  const client = new LicenseClient(product, store);
  phase = 'activate test license';
  const activated = await client.activate(key);
  requireAllowed(activated);
  cleanup = async () => client.deactivate();
  const saved = JSON.parse([...secret.values()][0]);
  phase = 'validate online after restart';
  const restarted = new LicenseClient(product, store);
  requireAllowed(await restarted.validate());
  phase = 'restore same instance without consuming another slot';
  const restored = new LicenseClient(product, store);
  requireAllowed(await restored.restore(key, saved.instanceId));
  phase = 'reject a mismatched product';
  const wrongProduct = new LicenseClient({ ...product, productId: TEST_PRODUCT_ID + 1 }, store);
  assert.equal((await wrongProduct.validate()).allowed, false);
  phase = 'export and verify literal XLSX values';
  requireAllowed(await restored.validate());
  const rows = [['id', 'amount', 'notes'], ['001', '02.00', '=1+1'], ['雪', '000.10', 'multiline\nvalue']];
  const bytes = await exportValues(rows);
  const book = new Workbook(); await book.xlsx.load(bytes);
  for (let r = 0; r < rows.length; r++) for (let c = 0; c < rows[r].length; c++) {
    assert.equal(book.worksheets[0].getCell(r + 1, c + 1).value, rows[r][c]);
    assert.equal(book.worksheets[0].getCell(r + 1, c + 1).formula, undefined);
  }
  phase = 'deactivate and confirm remote slot released';
  assert.equal((await restored.deactivate()).reason, 'missing');
  const inactive = await requestLicense('validate', { license_key: key });
  assert.equal(inactive.license_key.status, 'inactive');
  assert.equal(inactive.license_key.activation_usage, 0);
  assert.equal(secret.size, 0);
  cleanup = undefined;
  const report = {
    date: new Date().toISOString(), scope: 'Internal TEST product only; no live transaction or production activation',
    product, stages: ['online activation', 'cold online validation', 'same-instance restoration', 'wrong-product rejection', 'license-gated literal XLSX export', 'deactivation and remote usage zero'],
    passed: true, checkoutTestOrder: 4885861,
    limits: 'Memory-backed secret adapter used for this lifecycle test; real VS Code SecretStorage and licensed editor UI still require isolated end-to-end checks. Production product IDs remain unset.',
  };
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, 'result.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
})().catch(async () => {
  const report = { date: new Date().toISOString(), passed: false, phase, reason: failure, scope: 'Internal TEST license; no credential or service payload recorded.' };
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, 'failure.json'), JSON.stringify(report, null, 2));
  console.error(`Internal license test failed at: ${phase} (${failure}). No credential or service payload is displayed.`);
  process.exitCode = 1;
}).finally(async () => {
  if (cleanup) {
    try { console.log('Remote test activation cleanup:', (await cleanup()).reason === 'missing' ? 'completed' : 'needs review in test license dashboard'); }
    catch { console.error('Remote cleanup needs review in the TEST license dashboard.'); }
  }
});