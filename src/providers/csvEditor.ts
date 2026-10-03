import * as vscode from 'vscode';
import { parse, applyOperation } from '../csv/csv';
import { setupWebview } from '../webview';
import { AnalysisController } from '../analysis';
import { LicenseClient } from '../pro/licenseClient';
import { PRODUCT } from '../product';

export class CsvEditorProvider implements vscode.CustomTextEditorProvider {
  static readonly viewType = 'gridlens.csvGrid';
  constructor(private readonly context: vscode.ExtensionContext, private readonly license: LicenseClient = new LicenseClient(PRODUCT, context.secrets)) {}
  resolveCustomTextEditor(document: vscode.TextDocument, panel: vscode.WebviewPanel): void {
    const webview = panel.webview;
    let delimiter = document.uri.path.toLowerCase().endsWith('.tsv') ? '\t' : undefined;
    const analysis = new AnalysisController(document, webview, () => delimiter, this.license);
    let disposed = false, editing = false, timer: ReturnType<typeof setTimeout> | undefined;
    const error = (e: unknown) => void webview.postMessage({ type: 'error', message: e instanceof Error ? e.message : 'Grid operation failed.' });
    const update = () => {
      if (disposed || document.isClosed) return;
      try {
        const result = parse(document.getText(), delimiter);
        delimiter ??= result.delimiter;
        void webview.postMessage({ type: 'state', version: document.version, rows: result.rows.map(r => r.cells.map(c => c.text)), readonly: false, label: document.uri.path.split('/').at(-1), delimiter: result.delimiter, analysisAvailable: true, paidAvailable: PRODUCT !== null });
      } catch (e) { error(e); }
    };
    const changed = vscode.workspace.onDidChangeTextDocument(e => {
      if (e.document.uri.toString() !== document.uri.toString()) return;
      clearTimeout(timer); timer = setTimeout(update, 80);
    });
    const received = webview.onDidReceiveMessage(async message => {
      if (!message || typeof message !== 'object' || disposed) return;
      if (message.type === 'ready') { update(); return; }
      if (['preflight', 'compare', 'summary', 'exportXlsx', 'saveReport'].includes(message.type)) { await analysis.handle(message); return; }
      if (!['edit', 'addRow', 'deleteRow'].includes(message.type)) return;
      if (editing || message.version !== document.version) { error(new Error('Document changed. Reload the grid before editing.')); return; }
      editing = true;
      try {
        const version = document.version;
        if (message.type === 'deleteRow') {
          const confirmed = await vscode.window.showWarningMessage('Delete the selected source row? You can undo this in VS Code.', { modal: true }, 'Delete row');
          if (confirmed !== 'Delete row') { update(); return; }
          if (disposed || version !== document.version) throw new Error('Document changed. Reload before deleting.');
        }
        const op = applyOperation(document.getText(), message, delimiter);
        const next = document.getText().slice(0, op.start) + op.text + document.getText().slice(op.end);
        parse(next, delimiter);
        if (version !== document.version) throw new Error('Document changed while preparing edit.');
        const edit = new vscode.WorkspaceEdit();
        edit.replace(document.uri, new vscode.Range(document.positionAt(op.start), document.positionAt(op.end)), op.text);
        if (!await vscode.workspace.applyEdit(edit)) throw new Error('VS Code could not apply the edit.');
        update();
      } catch (e) { error(e); } finally { editing = false; }
    });
    panel.onDidDispose(() => { disposed = true; analysis.dispose(); clearTimeout(timer); changed.dispose(); received.dispose(); });
    setupWebview(webview, this.context.extensionUri);
  }
}