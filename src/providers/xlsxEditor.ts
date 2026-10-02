import * as vscode from 'vscode';
import { MAX_XLSX, readWorkbook, SheetData } from '../xlsx';
import { setupWebview } from '../webview';

interface XlsxDocument extends vscode.CustomDocument { sheets: SheetData[] }
export class XlsxEditorProvider implements vscode.CustomReadonlyEditorProvider<XlsxDocument> {
  static readonly viewType = 'gridlens.xlsxGrid';
  constructor(private readonly context: vscode.ExtensionContext) {}
  async openCustomDocument(uri: vscode.Uri, _context: vscode.CustomDocumentOpenContext, token: vscode.CancellationToken): Promise<XlsxDocument> {
    const stat = await vscode.workspace.fs.stat(uri);
    if (stat.size > MAX_XLSX) throw new Error('XLSX exceeds the 10 MiB file limit.');
    const sheets = await readWorkbook(Buffer.from(await vscode.workspace.fs.readFile(uri)));
    if (token.isCancellationRequested) throw new Error('Workbook loading cancelled.');
    return { uri, sheets, dispose() { sheets.length = 0; } };
  }
  resolveCustomEditor(document: XlsxDocument, panel: vscode.WebviewPanel): void {
    let selected = 0;
    const received = panel.webview.onDidReceiveMessage(message => {
      if (!message || typeof message !== 'object') return;
      if (message.type === 'sheet') {
        if (!Number.isInteger(message.sheet) || message.sheet < 0 || message.sheet >= document.sheets.length) return;
        selected = message.sheet;
      } else if (message.type !== 'ready') return;
      void panel.webview.postMessage({ type: 'state', version: 0, readonly: true, label: document.uri.path.split('/').at(-1), delimiter: '', rows: document.sheets[selected]?.rows ?? [], sheets: document.sheets.map(s => s.name), sheet: selected, warning: 'Read-only values snapshot. Formatting and charts are not rendered; formulas are not calculated. Reopen to reload external changes.' });
    });
    panel.onDidDispose(() => received.dispose());
    setupWebview(panel.webview, this.context.extensionUri);
  }
}