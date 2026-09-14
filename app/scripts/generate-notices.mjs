import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const lock = JSON.parse(readFileSync(join(root, 'package-lock.json')));
const notices = [];
const seen = new Set();
for (const [path, info] of Object.entries(lock.packages)) {
  if (!path.startsWith('node_modules/') || info.dev) continue;
  const directory = join(root, path);
  if (!existsSync(join(directory, 'package.json'))) {
    if (info.optional) continue;
    throw Error(`Run npm ci: missing ${path}`);
  }
  const pkg = JSON.parse(readFileSync(join(directory, 'package.json')));
  const key = `${pkg.name}@${pkg.version}`;
  if (seen.has(key)) continue;
  seen.add(key);
  const files = readdirSync(directory, { withFileTypes: true }).filter(file => file.isFile() && /^(licen[sc]e|copying|notice)([._-]|$)/i.test(file.name));
  const text = files.map(file => readFileSync(join(directory, file.name), 'utf8').trim()).join('\n\n');
  notices.push({ name: pkg.name, version: pkg.version, license: typeof pkg.license === 'string' ? pkg.license : 'See package source', text });
}
notices.sort((a, b) => a.name.localeCompare(b.name));
writeFileSync(join(root, 'src/data/notices.json'), JSON.stringify(notices));
console.log(`Collected ${notices.length} dependency notices; ${notices.filter(item => !item.text).length} packages provide license metadata without a root notice file.`);
