const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const env = { ...process.env, TEMP: 'D:\\VSCodeData\\Temp', TMP: 'D:\\VSCodeData\\Temp', GIT_TERMINAL_PROMPT: '0' };
function git(args) {
  const result = spawnSync('git', ['-C', root, ...args], { env, encoding: 'utf8', maxBuffer: 1024 * 1024 });
  if (result.status !== 0) throw new Error(`Git operation failed: ${args[0]}. No credential fallback attempted.`);
  return result.stdout.trim();
}
try {
  if (git(['config', '--get', 'user.email']) !== '336563365+dilojbusiness-blip@users.noreply.github.com') throw new Error('Personal commit email not configured.');
  if (git(['config', '--get', 'credential.https://github.com.username']) !== 'dilojbusiness-blip') throw new Error('Personal credential username not pinned.');
  if (!/^https:\/\/(?:dilojbusiness-blip@)?github\.com\/dilojbusiness-blip\/gridlens\.git$/.test(git(['remote', 'get-url', 'origin']))) throw new Error('Unexpected remote.');
  git(['diff', '--check']);
  git(['add', '.']);
  const names = git(['diff', '--cached', '--name-only']).split('\n').filter(Boolean);
  if (names.some(name => /^(?:dist|node_modules|\.env|\.vscode)\/|\.vsix$|\.log$/i.test(name))) throw new Error('Generated or sensitive file found in staging.');
  for (const name of names) {
    if (/\.png$/i.test(name)) continue;
    const text = fs.readFileSync(path.join(root, name), 'utf8');
    if (/\b(?:ghp_|gho_|sk_live_)[a-z0-9]{15,}|BEGIN [A-Z ]*PRIVATE KEY|DD21@ford\.com|@wipro\.com/i.test(text)) throw new Error('Potential credential or corporate identity in staging.');
  }
  if (names.length) git(['commit', '-m', 'Add free CSV structure checks and isolated test-license validation']);
  git(['-c', 'credential.helper=', '-c', 'credential.helper=manager', '-c', 'credential.username=dilojbusiness-blip', '-c', 'credential.interactive=false', 'push', 'origin', 'main']);
  console.log(JSON.stringify({ published: true, commit: git(['rev-parse', '--short', 'HEAD']), files: names.length, repository: 'https://github.com/dilojbusiness-blip/gridlens', identity: 'personal business' }, null, 2));
} catch (error) { console.error(error.message); process.exitCode = 1; }