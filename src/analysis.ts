import * as vscode from 'vscode';
import { parse, MAX_TEXT } from './csv/csv';
import { reconcileRows, ReconcileReport } from './pro/reconcile';
import { summarizeColumn, ColumnSummary } from './pro/analytics';
import { exportValues } from './pro/export';
import { LicenseClient } from './pro/licenseClient';
import { PRODUCT } from './product';

type Report = ReconcileReport | ColumnSummary;
type AnalysisUI = Pick<typeof vscode.window, 'showOpenDialog' | 'showQuickPick' | 'showSaveDialog'>;
export class AnalysisController {
  private report: { version: number; title: string; data: Report; sources: string[] } | undefined;
  private busy = false;
  private disposed = false;
  constructor(private readonly document: vscode.TextDocument, private readonly webview: vscode.Webview, private readonly delimiter: () => string | undefined, private readonly license: LicenseClient, private readonly ui: AnalysisUI = vscode.window) {}
  dispose(): void { this.disposed = true; this.report = undefined; }
  private current(version: unknown): number {
    if (this.disposed || version !== this.document.version || this.document.isClosed) throw new Error('Document changed or editor closed. Run analysis again.');
    return this.document.version;
  }
  async handle(message: Record<string, unknown>): Promise<void> {
    if (this.busy) { void this.webview.postMessage({ type: 'analysisError', message: 'An analysis is already running.' }); return; }
    this.busy = true;
    try {
      const version = this.current(message.version);
      if (typeof message.header !== 'boolean' && message.type !== 'saveReport') throw new Error('Invalid header option.');
      const parsed = parse(this.document.getText(), this.delimiter());
      const rows = parsed.rows.map(row => row.cells.map(cell => cell.text));
      const dataRows = message.header ? rows.slice(1) : rows;
      if (message.type === 'summary') {
        if (typeof message.column !== 'number') throw new Error('Select a column first.');
        const width = rows.reduce((n, row) => Math.max(n, row.length), 0);
        if (!Number.isInteger(message.column) || message.column < 0 || message.column >= width) throw new Error('Column is outside this table.');
        const result = summarizeColumn(dataRows, message.column);
        this.current(version);
        this.present(version, 'Column summary', result, [this.document.uri.toString()]);
      } else if (message.type === 'compare') {
        const file = (await this.ui.showOpenDialog({ title: 'Compare against another CSV/TSV (saved disk snapshot; files are never modified)', canSelectMany: false, filters: { 'Delimited data': ['csv', 'tsv'] } }))?.[0];
        if (!file) throw new Error('Comparison cancelled.');
        this.current(version);
        const stat = await vscode.workspace.fs.stat(file);
        if (stat.size > MAX_TEXT) throw new Error('Comparison file exceeds 50 MiB.');
        const bytes = await vscode.workspace.fs.readFile(file);
        let text: string;
        try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { throw new Error('Comparison requires UTF-8 CSV/TSV; convert the file encoding first.'); }
        const other = parse(text, file.path.toLowerCase().endsWith('.tsv') ? '\t' : undefined).rows.map(row => row.cells.map(cell => cell.text));
        const selectKey = async (table: string[][], side: string) => {
          const columns = table[0] ?? [];
          const choice = await this.ui.showQuickPick(columns.map((value, index) => ({ label: `${index + 1}: ${message.header ? value : 'Column ' + (index + 1)}`, index })), { title: `${side} key column`, placeHolder: 'Choose a unique, nonblank identifier. 001 and 1 are different.' });
          if (!choice) throw new Error('Comparison cancelled.');
          return choice.index;
        };
        const left = await selectKey(rows, 'Current CSV'), right = await selectKey(other, 'Comparison CSV');
        this.current(version);
        const result = reconcileRows(rows, other, { leftKeyColumn: left, rightKeyColumn: right, header: message.header as boolean, maxChanges: 1000 });
        this.present(version, 'Keyed CSV comparison', result, [this.document.uri.toString(), file.toString()]);
      } else if (message.type === 'exportXlsx') {
        if (!PRODUCT) throw new Error('Paid export is not available yet. No license key was sent.');
        if (!(await this.license.validate()).allowed) throw new Error('A valid license is needed for XLSX export. Activate it using GridLens license commands.');
        this.current(version);
        const output = await exportValues(rows);
        const target = await this.ui.showSaveDialog({ title: 'Export literal values (does not edit the source workbook)', defaultUri: vscode.Uri.joinPath(this.document.uri, '..', 'gridlens-values.xlsx'), filters: { 'Excel workbook': ['xlsx'] } });
        if (!target) throw new Error('Export cancelled.');
        this.current(version);
        if (target.toString() === this.document.uri.toString()) throw new Error('Cannot overwrite the source file.');
        await vscode.workspace.fs.writeFile(target, output);
        void this.webview.postMessage({ type: 'analysisError', message: 'Values-only XLSX exported. Source file unchanged.' });
      } else if (message.type === 'saveReport') {
        if (!this.report || this.report.version !== version) throw new Error('Run analysis again before saving the report.');
        const snapshot = this.report;
        const target = await this.ui.showSaveDialog({ title: 'Save analysis report as JSON', defaultUri: vscode.Uri.joinPath(this.document.uri, '..', 'gridlens-report.json'), filters: { 'JSON report': ['json'] } });
        if (!target) throw new Error('Save cancelled.');
        this.current(version);
        if (snapshot.sources.includes(target.toString())) throw new Error('Cannot overwrite a comparison source.');
        const output = { title: snapshot.title, generatedAt: new Date().toISOString(), scope: 'Full source records, not just the filtered view. Row indices are zero-based; samples may be capped. Literal string comparisons, no numeric coercion.', report: snapshot.data };
        await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(JSON.stringify(output, null, 2)));
        void this.webview.postMessage({ type: 'analysisError', message: 'Report saved. Comparison sources unchanged.' });
      }
    } catch (error) {
      void this.webview.postMessage({ type: 'analysisError', message: error instanceof Error ? error.message : 'Analysis failed.' });
    } finally { this.busy = false; }
  }
  private present(version: number, title: string, report: Report, sources: string[]): void {
    this.report = { version, title, data: report, sources };
    void this.webview.postMessage({ type: 'analysis', version, title, report });
  }
}