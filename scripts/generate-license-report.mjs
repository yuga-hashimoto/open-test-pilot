import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const platformPackagePattern = /(?:^|[-/])(darwin|linux|win32|freebsd|android|aix|sunos)-(?:arm64|x64|ia32|arm|x86)(?:[-/]|$)/;

function packageKey(packageEntry) {
  return `${packageEntry.name}@${packageEntry.version}`;
}

function isInLockfile(packageEntry, lockfile) {
  const escapedKey = packageKey(packageEntry).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^  ['"]?${escapedKey}(?:\\([^\\n]+\\))?['"]?:\\s*$`, 'm').test(lockfile);
}

export function mergeLicensePackages(currentPackages, existingPackages, lockfile) {
  const merged = new Map(currentPackages.map((packageEntry) => [packageKey(packageEntry), packageEntry]));
  for (const packageEntry of existingPackages) {
    const key = packageKey(packageEntry);
    if (!merged.has(key) && isInLockfile(packageEntry, lockfile)) merged.set(key, packageEntry);
  }
  return [...merged.values()].sort((a, b) => packageKey(a).localeCompare(packageKey(b)));
}

async function generateLicenseReport() {
  const raw = execFileSync('pnpm', ['licenses', 'list', '--json'], { encoding: 'utf8' });
  const grouped = JSON.parse(raw);
  const currentPackages = [];
  for (const [license, entries] of Object.entries(grouped)) {
    for (const entry of entries) {
      if (entry.name === 'fsevents' || platformPackagePattern.test(entry.name)) continue;
      for (const version of entry.versions ?? []) currentPackages.push({ license, name: entry.name, version });
    }
  }

  const [lockfile, existingReport] = await Promise.all([
    readFile('pnpm-lock.yaml', 'utf8'),
    readFile('docs/THIRD_PARTY_LICENSES.json', 'utf8')
      .then((source) => JSON.parse(source).packages ?? [])
      .catch(() => []),
  ]);
  const packages = mergeLicensePackages(currentPackages, existingReport, lockfile);
  await mkdir('docs', { recursive: true });
  await writeFile('docs/THIRD_PARTY_LICENSES.json', `${JSON.stringify({ generatedAt: 'deterministic', packages }, null, 2)}\n`);
  console.log(`Wrote ${packages.length} dependency license records`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await generateLicenseReport();
}
