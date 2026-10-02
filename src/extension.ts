import * as vscode from 'vscode';
import { CsvEditorProvider } from './providers/csvEditor';
import { XlsxEditorProvider } from './providers/xlsxEditor';
import { registerLicenseCommands } from './licenseCommands';

export function activate(context: vscode.ExtensionContext): void {
  const license = registerLicenseCommands(context);
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(CsvEditorProvider.viewType, new CsvEditorProvider(context, license)),
    vscode.window.registerCustomEditorProvider(XlsxEditorProvider.viewType, new XlsxEditorProvider(context), { supportsMultipleEditorsPerDocument: true }),
  );
  context.subscriptions.push(vscode.commands.registerCommand('gridlens.open', async (uri?: vscode.Uri) => {
    const target = uri ?? vscode.window.activeTextEditor?.document.uri;
    if (!target) { void vscode.window.showInformationMessage('Open a CSV, TSV, or XLSX file first.'); return; }
    const ext = target.path.split('.').at(-1)?.toLowerCase();
    if (!['csv', 'tsv', 'xlsx'].includes(ext ?? '')) { void vscode.window.showInformationMessage('GridLens supports CSV, TSV, and XLSX.'); return; }
    await vscode.commands.executeCommand('vscode.openWith', target, ext === 'xlsx' ? XlsxEditorProvider.viewType : CsvEditorProvider.viewType);
  }));
}