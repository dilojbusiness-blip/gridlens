import * as vscode from 'vscode';
import { LicenseClient, ClientResult } from './pro/licenseClient';
import { PRODUCT } from './product';
import { ProductIdentity } from './pro/license';

const explain = (result: ClientResult): string => result.allowed ? 'License active on this device.' : {
  configuration: 'Paid activation is not available in this release. No key was sent.',
  missing: 'No local activation. Existing free features remain available.',
  rejected: 'License rejected. Check the key and product, or contact support without sending your key.',
  activation_limit: 'Activation limit reached. Deactivate another device or restore a known activation ID. Contact support if the device is lost.',
  different_key: 'A different key is already stored. Deactivate it before switching keys.',
  forgotten: 'Local activation removed. This does not free a remote activation slot.',
  unavailable: 'Could not reach the license service. No new paid access was granted. Free features still work.',
  storage: 'VS Code secret storage is unavailable. Please unlock it and retry.',
}[result.reason];

export function registerLicenseCommands(context: vscode.ExtensionContext, product: ProductIdentity | null = PRODUCT, prefix = 'gridlens.license'): LicenseClient {
  const client = new LicenseClient(product, context.secrets);
  const run = async (action: 'activate' | 'deactivate' | 'restore' | 'forget' | 'status') => {
    if (!product && action !== 'forget') { void vscode.window.showInformationMessage(explain({ allowed: false, reason: 'configuration' })); return; }
    let result: ClientResult;
    if (action === 'activate' || action === 'restore') {
      const key = await vscode.window.showInputBox({ title: prefix.startsWith('gridlens.test') ? 'GridLens INTERNAL TEST license' : 'GridLens license', prompt: 'Enter the license key directly here. Sent only to Lemon Squeezy for activation/validation.', password: true, ignoreFocusOut: true });
      if (!key) return;
      if (action === 'restore') {
        const id = await vscode.window.showInputBox({ title: 'Restore GridLens activation', prompt: 'Enter the existing instance ID from your legitimate activation backup or support. This does not create a new slot.', password: true, ignoreFocusOut: true });
        if (!id) return;
        result = await client.restore(key.trim(), id.trim());
      } else result = await client.activate(key.trim());
    } else if (action === 'forget') {
      const answer = await vscode.window.showWarningMessage('Remove local license? The remote slot will NOT be released.', { modal: true }, 'Remove local only');
      if (answer !== 'Remove local only') return;
      result = await client.forgetLocal();
    } else result = action === 'deactivate' ? await client.deactivate() : await client.validate();
    void vscode.window.showInformationMessage(explain(result));
  };
  for (const action of ['activate', 'deactivate', 'restore', 'forget', 'status'] as const) {
    context.subscriptions.push(vscode.commands.registerCommand(`${prefix}.${action}`, () => run(action)));
  }
  return client;
}