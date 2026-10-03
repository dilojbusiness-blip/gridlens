const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const vscode = require('vscode');
exports.run = async () => {
  try { await runTests(); }
  catch (error) {
    await fs.writeFile(path.join(process.env.TEMP, 'gridlens-host-error.txt'), String(error.stack || error));
    throw error;
  }
};
async function runTests() {
  const { CsvEditorProvider } = require('../../dist/test-provider');
  const { AnalysisController } = require('../../dist/test-analysis');
  const root = path.resolve(__dirname, '../..');
  const directory = path.join(process.env.TEMP, 'gridlens-host-fixtures');
  await fs.mkdir(directory, { recursive: true });
  const uri = vscode.Uri.file(path.join(directory, 'host.csv'));
  await fs.writeFile(uri.fsPath, 'Name,Value\r\nSnow,001\r\n');
  const extension = vscode.extensions.getExtension('dilojbusiness.gridlens');
  assert.ok(extension, 'Extension must be discovered');
  await extension.activate();
  const document = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(document);
  const messages = [];
  const received = new vscode.EventEmitter();
  const disposed = new vscode.EventEmitter();
  const webview = {
    options: {}, html: '', cspSource: 'https://local.invalid',
    asWebviewUri: resource => resource,
    onDidReceiveMessage: received.event,
    postMessage: async message => { messages.push(message); return true; },
  };
  const provider = new CsvEditorProvider({ extensionUri: vscode.Uri.file(root) });
  provider.resolveCustomTextEditor(document, { webview, onDidDispose: disposed.event });
  const until = async predicate => {
    for (let i = 0; i < 100; i++) {
      if (predicate()) return;
      await new Promise(resolve => setTimeout(resolve, 30));
    }
    throw new Error('Timed out awaiting VS Code document update');
  };
  try {
    received.fire({ type: 'ready' });
    await until(() => messages.some(m => m.type === 'state'));
    assert.deepEqual(messages.at(-1).rows[1], ['Snow', '001']);
    received.fire({ type: 'edit', version: document.version, row: 1, column: 0, value: '雪,edited' });
    await until(() => document.getText().includes('"雪,edited"') && document.isDirty);
    assert.equal(document.isDirty, true);
    assert.equal(document.getText(), 'Name,Value\r\n"雪,edited",001\r\n');
    await vscode.commands.executeCommand('undo');
    await until(() => document.getText() === 'Name,Value\r\nSnow,001\r\n');
    await vscode.commands.executeCommand('redo');
    await until(() => document.getText().includes('"雪,edited"'));
    await document.save();
    assert.equal(await fs.readFile(uri.fsPath, 'utf8'), document.getText());
    received.fire({ type: 'edit', version: -1, row: 0, column: 0, value: 'stale' });
    await until(() => messages.at(-1).type === 'error');
    assert.equal(document.getText().includes('stale'), false);
    await vscode.commands.executeCommand('vscode.openWith', uri, 'gridlens.csvGrid');
    const { Workbook } = require('exceljs');
    const book = new Workbook(); book.addWorksheet('Example').addRow(['雪', 42]);
    const xlsx = vscode.Uri.file(path.join(directory, 'host.xlsx'));
    await fs.writeFile(xlsx.fsPath, Buffer.from(await book.xlsx.writeBuffer()));
    await vscode.commands.executeCommand('vscode.openWith', xlsx, 'gridlens.xlsxGrid');
    const before=await fs.readFile(uri.fsPath,'utf8');
    const second=vscode.Uri.file(path.join(directory,'comparison.csv'));
    await fs.writeFile(second.fsPath,'Name,Value\r\nNew,005\r\n"雪,edited",002\r\n');
    const output=vscode.Uri.file(path.join(directory,'report.json'));
    let saveTarget=output;
    const ui={showOpenDialog:async()=>[second],showQuickPick:async items=>items[0],showSaveDialog:async()=>saveTarget};
    const analysis=new AnalysisController(document,webview,()=>',',{validate:async()=>{throw new Error('Unconfigured export must never check license');}},ui);
    await analysis.handle({type:'summary',version:document.version,column:1,header:true});
    assert.equal(messages.at(-1).report.sum,1);
    await analysis.handle({type:'preflight',version:document.version,header:true});
    assert.equal(messages.at(-1).title,'CSV preflight');
    assert.equal(messages.at(-1).report.tables[0].blocked,false);
    await fs.writeFile(second.fsPath,'Name,Value\r\nragged\r\n');
    await analysis.handle({type:'compare',version:document.version,header:true});
    assert.equal(messages.at(-1).title,'CSV preflight');
    assert.equal(messages.at(-1).report.tables[1].issues[0].code,'ragged-row');
    await fs.writeFile(second.fsPath,'Name,Value\r\nNew,005\r\n"雪,edited",002\r\n');
    await analysis.handle({type:'compare',version:document.version,header:true});
    assert.deepEqual(messages.at(-1).report.counts,{same:0,changed:1,added:1,removed:0});
    await analysis.handle({type:'saveReport',version:document.version});
    const report=JSON.parse(await fs.readFile(output.fsPath,'utf8'));
    assert.equal(report.report.changes[0].deltas[0].leftValue,'001');
    assert.equal(report.report.changes[0].deltas[0].rightValue,'002');
    saveTarget=second;
    await analysis.handle({type:'saveReport',version:document.version});
    assert.equal(messages.at(-1).message,'Cannot overwrite a comparison source.');
    await analysis.handle({type:'exportXlsx',version:document.version,header:true});
    assert.equal(messages.at(-1).message.includes('Paid export is not available'),true);
    assert.equal(await fs.readFile(uri.fsPath,'utf8'),before);
    assert.equal(await fs.readFile(second.fsPath,'utf8'),'Name,Value\r\nNew,005\r\n"雪,edited",002\r\n');
    analysis.dispose();
    await analysis.handle({type:'summary',version:document.version,column:1,header:true});
    assert.equal(messages.at(-1).type,'analysisError');
    console.log('GRIDLENSHOST PASS: activation, CSV edits/undo/redo/save, XLSX open, summary, keyed comparison, JSON report export, source-overwrite protection, disposed/stale gates, paid export blocked');
  } finally {
    disposed.fire(); received.dispose(); disposed.dispose();
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  }
}