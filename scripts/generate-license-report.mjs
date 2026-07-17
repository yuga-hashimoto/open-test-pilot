import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';

const raw = execFileSync('pnpm', ['licenses', 'list', '--json'], { encoding: 'utf8' });
const grouped = JSON.parse(raw);
const packages = [];
const platformPackagePattern = /(?:^|[-/])(darwin|linux|win32|freebsd|android|aix|sunos)-(?:arm64|x64|ia32|arm|x86)(?:[-/]|$)/;
for (const [license, entries] of Object.entries(grouped)) {
  for (const entry of entries) {
    if (entry.name === 'fsevents' || platformPackagePattern.test(entry.name)) continue;
    for (const version of entry.versions ?? []) packages.push({ license, name: entry.name, version });
  }
}
packages.sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`));
await mkdir('docs', { recursive: true });
await writeFile('docs/THIRD_PARTY_LICENSES.json', `${JSON.stringify({ generatedAt: 'deterministic', packages }, null, 2)}\n`);
console.log(`Wrote ${packages.length} dependency license records`);
