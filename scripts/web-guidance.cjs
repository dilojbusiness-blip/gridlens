const {spawnSync} = require('node:child_process');
const path = require('node:path');
const cli = path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npx-cli.js');
const env = { ...process.env, TEMP:'D:\\VSCodeData\\Temp',TMP:'D:\\VSCodeData\\Temp', npm_config_cache:'D:\\VSCodeData\\Temp\\npm-cache' };
env.PATH = `${path.dirname(process.execPath)};${env.PATH}`;
const result=spawnSync(process.execPath,[cli,'--yes','--offline','modern-web-guidance','retrieve','forms'],{env,encoding:'utf8'});
process.stdout.write(result.stdout||'');process.stderr.write(result.stderr||'');process.exitCode=result.status||0;