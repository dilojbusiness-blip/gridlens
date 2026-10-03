const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vscode = require('vscode');

exports.run = async () => {
  if (!process.env.TEMP || !/^D:\\/i.test(process.env.TEMP)) throw new Error('D: test storage required');
  const directory = path.join(process.env.TEMP, 'gridlens-real-licensed-host');
  await fs.mkdir(directory, { recursive: true });
  const report = { date: new Date().toISOString(), passed: false, scope: 'Existing internal TEST order license via actual masked VS Code command, real fixture SecretStorage and actual license API; export controller uses predetermined synthetic destination, not browser button automation. No live product or charge.' };
  let context, client, phase = 'load fixture', cleanup = false;
  const product = { storeId: 488586, productId: 1409217, variantId: 2199953 };
  try {
    const fixture = vscode.extensions.getExtension('dilotools-tests.gridlens-test-harness');
    assert.ok(fixture);
    ({ context } = await fixture.activate());
    assert.equal(await context.secrets.get('gridlens.pro.activation'), undefined, 'Test profile must not contain a prior activation');
    const { registerLicenseCommands } = require('../../dist/test-license-commands');
    const { LicenseClient } = require('../../dist/pro/licenseClient');
    const { AnalysisController } = require('../../dist/test-analysis');
    const { Workbook } = require('exceljs');
    client = registerLicenseCommands(context, product, 'gridlens.test.license');
    phase = 'masked activation command';
    cleanup = true;
    await vscode.commands.executeCommand('gridlens.test.license.activate');
    assert.equal((await client.validate()).allowed, true);
    phase = 'cold online validation through actual SecretStorage';
    const cold = new LicenseClient(product, context.secrets);
    assert.equal((await cold.validate()).allowed, true);
    phase = 'source setup and licensed editor export';
    const source = vscode.Uri.file(path.join(directory, 'source.csv'));
    const text = 'id,amount,formula\r\n001,02.00,=1+1\r\n雪,000.10,literal\r\n';
    await fs.writeFile(source.fsPath, text);
    const document = await vscode.workspace.openTextDocument(source);
    await vscode.commands.executeCommand('vscode.openWith', source, 'gridlens.csvGrid');
    const target = vscode.Uri.file(path.join(directory, 'values.xlsx'));
    const messages = [];
    const controller = new AnalysisController(document, { postMessage: async m => { messages.push(m); return true; } }, () => ',', cold, { showSaveDialog: async () => target }, product);
    await controller.handle({ type: 'exportXlsx', version: document.version, header: true });
    assert.equal(messages.at(-1)?.message, 'Values-only XLSX exported. Source file unchanged.');
    const book = new Workbook(); await book.xlsx.load(await fs.readFile(target.fsPath));
    assert.equal(book.worksheets[0].getCell('A2').value, '001');
    assert.equal(book.worksheets[0].getCell('B2').value, '02.00');
    assert.equal(book.worksheets[0].getCell('C2').value, '=1+1');
    assert.equal(book.worksheets[0].getCell('C2').formula, undefined);
    assert.equal(await fs.readFile(source.fsPath, 'utf8'), text);
    controller.dispose();
    phase = 'command deactivation and secret cleanup';
    await vscode.commands.executeCommand('gridlens.test.license.deactivate');
    assert.equal(await context.secrets.get('gridlens.pro.activation'), undefined);
    cleanup = false;
    report.passed = true;
    report.product = product;
    report.stages = ['real masked activation command', 'real test API', 'actual isolated fixture SecretStorage', 'cold online validation', 'license-gated editor controller export', 'literal values and source preserved', 'deactivate command and secret removed'];
    console.log('GRIDLENS REAL TEST LICENSE HOST PASS');
  } catch {
    report.phase = phase;
    report.failure = 'Test did not pass at the recorded stage. No key, error payload or signed URL is recorded.';
    throw new Error(`Internal real-license editor test failed at ${phase}`);
  } finally {
    if (cleanup && client) {
      try {
        const hadActivation = !!(await context.secrets.get('gridlens.pro.activation'));
        const result = await client.deactivate();
        report.cleanup = result.reason === 'missing' ? hadActivation ? 'remote activation released' : 'no stored activation to release' : 'check TEST dashboard; encrypted recovery state retained';
      }
      catch { report.cleanup = 'check TEST dashboard'; }
    }
    if (context && (!cleanup || report.cleanup === 'remote activation released' || report.cleanup === 'no stored activation to release')) await context.secrets.delete('gridlens.pro.activation');
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await fs.rm(path.join(directory, 'source.csv'), { force: true });
    await fs.rm(path.join(directory, 'values.xlsx'), { force: true });
    await fs.writeFile(path.join(directory, 'result.json'), JSON.stringify(report, null, 2));
  }
};