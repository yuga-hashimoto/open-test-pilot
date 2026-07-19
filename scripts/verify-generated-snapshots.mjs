import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const manifests = ['examples/manifests/login.yaml', 'examples/manifests/fixture-login.yaml', 'examples/manifests/complex-flow.yaml', 'examples/manifests/android-settings.yaml'];
for (const manifest of manifests) execFileSync(process.execPath, ['--import', 'tsx', 'packages/cli/src/index.ts', 'manifest', 'generate', manifest], { stdio: 'inherit' });
const snapshots = manifests.flatMap((manifest) => {
  const base = manifest.slice(0, manifest.lastIndexOf('/'));
  const name = manifest.slice(manifest.lastIndexOf('/') + 1, -'.yaml'.length);
  return [`${base}/generated/${name}.spec.ts`, `${base}/generated/${name}.spec.ts.map.json`];
});
for (const snapshot of snapshots) if (!existsSync(snapshot)) throw new Error(`Generated snapshot is missing: ${snapshot}`);
if (process.env['CI'] === 'true') {
  execFileSync('git', ['diff', '--exit-code', '--', ...snapshots], { stdio: 'inherit' });
} else {
  console.log('Local run: generated snapshots were regenerated; CI checks the committed diff.');
}
console.log(`Generated snapshots are current: ${snapshots.length} files`);
