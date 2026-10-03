const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const run = spawnSync(process.execPath, [path.join(root, 'node_modules/@vscode/vsce/vsce'), 'show', 'dilojbusiness.gridlens', '--json'], {
  env: { ...process.env, NODE_USE_SYSTEM_CA: '1', TEMP: 'D:\\VSCodeData\\Temp', TMP: 'D:\\VSCodeData\\Temp' }, encoding: 'utf8', maxBuffer: 1024 * 1024,
});
if (run.status !== 0) { console.error('Public Marketplace verification failed; no account credential was requested.'); process.exitCode = 1; }
else {
  const extension = JSON.parse(run.stdout);
  const version = extension.versions[0];
  const get = name => version.properties?.find(p => p.key === name)?.value;
  const local = path.join(root, `gridlens-${version.version}.vsix`);
  const localHash = fs.existsSync(local) ? crypto.createHash('sha256').update(fs.readFileSync(local)).digest('hex') : null;
  const publicHash = get('Microsoft.VisualStudio.Services.VsixSha256') ?? null;
  const report = {
    checked: new Date().toISOString(), version: version.version, updated: version.lastUpdated,
    pricing: get('Microsoft.VisualStudio.Services.Content.Pricing'), publicSha256: publicHash, localSha256: localHash,
    matchesTestedPackage: localHash !== null && publicHash === localHash,
    metrics: extension.statistics ?? [],
    caution: 'Marketplace statistics may lag and may include self-installs. Installs are not customers, payment or evidence of willingness to pay.',
  };
  const directory = 'D:/VSCodeData/Temp/gridlens-release-check';
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'public-release.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}