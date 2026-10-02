const esbuild = require('esbuild');
const fs = require('node:fs');
const path = require('node:path');
(async () => {
  const alias = { exceljs: path.resolve('scripts/document-exceljs.cjs') };
  const result = await esbuild.build({ entryPoints: ['src/extension.ts'], bundle: true, platform: 'node', target: 'node18', external: ['vscode'], alias, outfile: 'dist/extension.js', minify: process.argv.includes('--production'), legalComments: 'eof', metafile: true });
  fs.writeFileSync('dist/build-meta.json', JSON.stringify(result.metafile));
  await esbuild.build({ entryPoints: ['src/csv/csv.ts'], bundle: true, platform: 'node', outfile: 'dist/csv.js' });
  await esbuild.build({ entryPoints: ['src/xlsx.ts'], bundle: true, platform: 'node', alias, outfile: 'dist/xlsx.js', legalComments: 'eof' });
  if (process.argv.includes('--host-tests')) {
    await esbuild.build({ entryPoints: ['src/providers/csvEditor.ts'], bundle: true, platform: 'node', external: ['vscode'], outfile: 'dist/test-provider.js' });
    await esbuild.build({ entryPoints: ['src/analysis.ts'], bundle: true, platform: 'node', alias, external: ['vscode'], outfile: 'dist/test-analysis.js' });
  }
  if (!process.argv.includes('--production')) {
    await esbuild.build({ entryPoints: ['src/pro/analytics.ts', 'src/pro/export.ts', 'src/pro/license.ts', 'src/pro/licenseClient.ts', 'src/pro/reconcile.ts'], bundle: true, platform: 'node', alias, outdir: 'dist/pro', legalComments: 'eof' });
  }
  require('./scripts/notices.js');
})().catch(e => { console.error(e); process.exitCode = 1; });