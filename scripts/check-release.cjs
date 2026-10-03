const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..');
const directory = 'D:/VSCodeData/Temp/gridlens-release-check';
fs.mkdirSync(directory, { recursive: true });
const env = { ...process.env, TEMP: 'D:\\VSCodeData\\Temp', TMP: 'D:\\VSCodeData\\Temp', npm_config_cache: 'D:\\VSCodeData\\Temp\\npm-cache' };
env.PATH = `${path.dirname(process.execPath)};${env.PATH}`;
const result = { date: new Date().toISOString(), passed: false, steps: [] };
try {
  for (const [name, args] of [
    ['TypeScript', ['node_modules/typescript/bin/tsc', '--noEmit']],
    ['Test build', ['esbuild.js']],
    ['Tests', ['--test', ...fs.readdirSync(path.join(root, 'tests')).filter(f => f.endsWith('.test.cjs')).map(f => `tests/${f}`)]],
    ['Package', ['node_modules/@vscode/vsce/vsce', 'package', '--no-dependencies']],
  ]) {
    const run = spawnSync(process.execPath, args, { cwd: root, env, encoding: 'utf8', maxBuffer: 1024 * 1024 });
    fs.writeFileSync(path.join(directory, `${name.replaceAll(' ', '-')}.log`), `${run.stdout || ''}\n${run.stderr || ''}`);
    console.log(`${name}: exit ${run.status}`);
    result.steps.push({ name, exit: run.status });
    if (run.status !== 0) throw new Error(`${name} failed; see the local D: log.`);
  }
  const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  const artifact = path.join(root, `gridlens-${version}.vsix`);
  const data = fs.readFileSync(artifact);
  result.artifact = artifact;
  result.size = data.length;
  result.sha256 = crypto.createHash('sha256').update(data).digest('hex');
  result.passed = true;
} catch (error) {
  result.error = error.message;
  process.exitCode = 1;
} finally {
  fs.writeFileSync(path.join(directory, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}