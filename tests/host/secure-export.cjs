const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const vscode = require('vscode');

exports.run = async () => {
  if (!process.env.TEMP || !/^D:\\/i.test(process.env.TEMP)) throw new Error('Isolated test requires a D: temporary directory.');
  const directory = path.join(process.env.TEMP, 'gridlens-secure-host');
  await fs.mkdir(directory, { recursive: true });
  const report = { date: new Date().toISOString(), passed: false, scope: 'Actual isolated test-fixture SecretStorage namespace and export controller; synthetic license responses plus real HTTPS dummy-key connectivity probe. Not a real checkout-to-editor flow.' };
  let secrets;
  try {
    const fixture = vscode.extensions.getExtension('dilotools-tests.gridlens-test-harness');
    assert.ok(fixture, 'Isolated fixture not loaded');
    ({ secrets } = await fixture.activate());
    const { LicenseClient, requestLicense } = require('../../dist/pro/licenseClient');
    const { AnalysisController } = require('../../dist/test-analysis');
    const { Workbook } = require('exceljs');
    const product = { storeId: 101, productId: 202, variantId: 303 };
    const key = 'synthetic-host-test-key-not-a-real-license';
    const instance = '00000000-0000-4000-8000-000000000001';
    const calls = [];
    const transport = async (operation, fields) => {
      calls.push(operation);
      if (operation === 'deactivate') return { deactivated: true, error: null };
      return { valid: true, activated: true, error: null, license_key: { key: fields.license_key, status: fields.instance_id || operation === 'activate' ? 'active' : 'inactive', expires_at: null }, instance: fields.instance_id || operation === 'activate' ? { id: instance } : null, meta: { store_id: 101, product_id: 202, variant_id: 303 } };
    };
    await secrets.delete('gridlens.pro.activation');
    const client = new LicenseClient(product, secrets, transport);
    assert.equal((await client.activate(key)).allowed, true);
    assert.ok(await secrets.get('gridlens.pro.activation'));
    const cold = new LicenseClient(product, secrets, transport);
    assert.equal((await cold.validate()).allowed, true);
    assert.equal(calls.at(-1), 'validate');
    assert.equal((await cold.restore(key, instance)).allowed, true);
    const source = vscode.Uri.file(path.join(directory, 'source.csv'));
    const text = 'id,amount,formula\r\n001,02.00,=1+1\r\n雪,000.10,literal\r\n';
    await fs.writeFile(source.fsPath, text);
    const document = await vscode.workspace.openTextDocument(source);
    const output = vscode.Uri.file(path.join(directory, 'licensed-values.xlsx'));
    let target = output;
    const messages = [];
    const webview = { postMessage: async message => { messages.push(message); return true; } };
    const ui = { showSaveDialog: async () => target };
    const controller = new AnalysisController(document, webview, () => ',', cold, ui, product);
    await controller.handle({ type: 'exportXlsx', version: document.version, header: true });
    assert.equal(messages.at(-1).message, 'Values-only XLSX exported. Source file unchanged.');
    const book = new Workbook(); await book.xlsx.load(await fs.readFile(output.fsPath));
    assert.equal(book.worksheets[0].getCell('A2').value, '001');
    assert.equal(book.worksheets[0].getCell('B2').value, '02.00');
    assert.equal(book.worksheets[0].getCell('C2').value, '=1+1');
    assert.equal(book.worksheets[0].getCell('C2').formula, undefined);
    assert.equal(await fs.readFile(source.fsPath, 'utf8'), text);
    target = source;
    await controller.handle({ type: 'exportXlsx', version: document.version, header: true });
    assert.equal(messages.at(-1).message, 'Cannot overwrite the source file.');
    await controller.handle({ type: 'exportXlsx', version: -1, header: true });
    assert.equal(messages.at(-1).type, 'analysisError');
    controller.dispose();
    assert.equal((await cold.deactivate()).reason, 'missing');
    assert.equal(await secrets.get('gridlens.pro.activation'), undefined);
    try {
      const probe = await requestLicense('validate', { license_key: 'gridlens-invalid-connectivity-probe' });
      report.runtimeHttpsProbe = probe?.valid === false ? 'passed; invalid dummy key denied as expected' : 'unexpected-response';
    } catch { report.runtimeHttpsProbe = 'failed; investigate VS Code runtime certificate trust before live licensing'; }
    report.passed = true;
    report.stages = ['real SecretStorage write/read/delete', 'cold licensed check', 'restore same synthetic instance', 'controller XLSX export', 'literal values and formula text preserved', 'source-overwrite and stale-version blocked', 'activation cleanup'];
    console.log('GRIDLENS SECURE HOST PASS (synthetic license service; real secure storage and export controller).');
  } catch (error) {
    report.failureType = error?.name === 'AssertionError' ? 'assertion' : 'runtime-or-environment';
    report.failure = 'Isolated secure-storage/export check failed; no credentials or response payload recorded.';
    throw new Error(report.failure);
  } finally {
    if (secrets) await secrets.delete('gridlens.pro.activation');
    await fs.rm(path.join(directory, 'source.csv'), { force: true });
    await fs.rm(path.join(directory, 'licensed-values.xlsx'), { force: true });
    await fs.writeFile(path.join(directory, 'result.json'), JSON.stringify(report, null, 2));
  }
};