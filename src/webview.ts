import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';

export function setupWebview(webview: vscode.Webview, extensionUri: vscode.Uri): void {
  const root = vscode.Uri.joinPath(extensionUri, 'media');
  webview.options = { enableScripts: true, localResourceRoots: [root] };
  const nonce = randomBytes(24).toString('base64');
  const script = webview.asWebviewUri(vscode.Uri.joinPath(root, 'grid.js'));
  const style = webview.asWebviewUri(vscode.Uri.joinPath(root, 'grid.css'));
  // Virtual cell positions require dynamic styles; scripts remain nonce-only.
  webview.html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src ${webview.cspSource} 'unsafe-inline'; img-src ${webview.cspSource}; connect-src 'none';"><link rel="stylesheet" href="${style}"><title>GridLens</title></head><body><div id="app"></div><script nonce="${nonce}" src="${script}"></script></body></html>`;
}