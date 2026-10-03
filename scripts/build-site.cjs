const esbuild = require('esbuild');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
esbuild.build({ entryPoints: [path.join(root, 'src/demoWorker.ts')], bundle: true, platform: 'browser', format: 'iife', target: 'es2020', outfile: path.join(root, 'docs/worker.js'), minify: true }).catch(() => { process.exitCode = 1; });