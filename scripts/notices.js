const fs = require('node:fs');
const path = require('node:path');
const inputs = Object.keys(JSON.parse(fs.readFileSync('dist/build-meta.json', 'utf8')).inputs);
const packages = new Map();
for (const input of inputs) {
  if (!input.includes('node_modules/')) continue;
  let directory = path.dirname(path.resolve(input));
  while (directory !== path.dirname(directory)) {
    const manifest = path.join(directory, 'package.json');
    if (fs.existsSync(manifest)) {
      const json = JSON.parse(fs.readFileSync(manifest, 'utf8'));
      if (json.name && json.version) {
        packages.set(directory, json);
        break;
      }
    }
    directory = path.dirname(directory);
  }
}
const sections = ['GridLens bundled third-party notices. Exact upstream license text follows.'];
for (const [directory, json] of [...packages].sort((a, b) => a[1].name.localeCompare(b[1].name))) {
  const files = fs.readdirSync(directory).filter(name => /^(licen[cs]e|notice|copyright)(\.|$)/i.test(name));
  sections.push(`${'='.repeat(72)}\n${json.name}@${json.version} — ${json.license || 'see upstream text'}`);
  if (!files.length) {
    const readme = fs.readdirSync(directory).find(name => /^readme(\.|$)/i.test(name));
    const text = readme ? fs.readFileSync(path.join(directory, readme), 'utf8') : '';
    const match = /(?:^|\n)#{0,3}\s*licen[cs]e\s*\r?\n/i.exec(text);
    const supplemental = path.join(__dirname, 'licenses', `${json.name.replaceAll('/', '-')}-${json.version}.txt`);
    if (match) sections.push(`${readme}: upstream license section\n${text.slice(match.index).trim()}`);
    else if (fs.existsSync(supplemental)) sections.push(fs.readFileSync(supplemental, 'utf8'));
    else throw new Error(`Missing license text for bundled package ${json.name}`);
  }
  for (const name of files) {
    const file = path.join(directory, name);
    if (fs.statSync(file).isFile()) sections.push(`${name}\n${fs.readFileSync(file, 'utf8')}`);
  }
}
fs.writeFileSync('THIRD_PARTY_NOTICES.txt', sections.join('\n\n'));
console.log(`Bundled license notices: ${packages.size} packages`);