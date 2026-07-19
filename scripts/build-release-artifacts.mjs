import { execFileSync } from 'node:child_process';
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';

const output = process.env['RELEASE_DIR'] ?? 'dist/release';
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
execFileSync(process.execPath, ['--import', 'tsx', 'scripts/verify-generated-snapshots.mjs'], { stdio: 'inherit' });
execFileSync(process.execPath, ['--import', 'tsx', 'scripts/generate-license-report.mjs'], { stdio: 'inherit' });
await cp('LICENSE', `${output}/LICENSE`);
await cp('NOTICE', `${output}/NOTICE`);
await cp('docs/THIRD_PARTY_LICENSES.json', `${output}/THIRD_PARTY_LICENSES.json`);
await cp('docs/OSS_GOVERNANCE.md', `${output}/OSS_GOVERNANCE.md`);
await cp('GOVERNANCE.md', `${output}/GOVERNANCE.md`);
await cp('README.md', `${output}/README.md`);
await cp('CHANGELOG.md', `${output}/CHANGELOG.md`);
await cp('AGENTS.md', `${output}/AGENTS.md`);
await cp('.env.example', `${output}/.env.example`);
await cp('docs', `${output}/docs`, { recursive: true });
await cp('docs/MIGRATION.md', `${output}/MIGRATION.md`);
await cp('infra/docker', `${output}/docker`, { recursive: true });
await cp('infra/helm/opentestpilot', `${output}/helm/opentestpilot`, { recursive: true });
await cp('infra/postgres/migrations', `${output}/migrations`, { recursive: true });
await cp('examples', `${output}/examples`, { recursive: true });
await cp('packages/claude-code-plugin', `${output}/claude-code-plugin`, { recursive: true });
// Keep a source checkout in the handoff bundle so the private workspace CLI can
// be installed and built without assuming internal packages were published.
await mkdir(`${output}/source`, { recursive: true });
const sourceFilter = (source) => !/(^|[\\/])(node_modules|dist|\.testpilot|\.vite)(?:[\\/]|$)/.test(source);
await cp('apps', `${output}/source/apps`, { recursive: true, filter: sourceFilter });
await cp('packages', `${output}/source/packages`, { recursive: true, filter: sourceFilter });
await cp('package.json', `${output}/source/package.json`);
await cp('pnpm-lock.yaml', `${output}/source/pnpm-lock.yaml`);
await cp('pnpm-workspace.yaml', `${output}/source/pnpm-workspace.yaml`);
await cp('tsconfig.json', `${output}/source/tsconfig.json`);
await writeFile(`${output}/docker-image-manifest.json`, `${JSON.stringify({
  images: [
    { name: 'opentestpilot-server', dockerfile: 'docker/Dockerfile.server' },
    { name: 'opentestpilot-runner', dockerfile: 'docker/Dockerfile.runner' },
    { name: 'opentestpilot-scheduler', dockerfile: 'docker/Dockerfile.scheduler' },
    { name: 'opentestpilot-ai-worker', dockerfile: 'docker/Dockerfile.ai-worker' },
  ],
}, null, 2)}\n`);
execFileSync('pnpm', ['--filter', '@open-test-pilot/cli', 'pack', '--pack-destination', output], { stdio: 'inherit' });
const files = execFileSync('find', [output, '-type', 'f', '-print'], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 }).trim().split('\n').filter(Boolean).sort();
await writeFile(`${output}/release-manifest.json`, `${JSON.stringify({ product: 'open-test-pilot', version: '0.1.0', sourceCheckout: 'source/', files: files.map((file) => file.replace(`${output}/`, '')) }, null, 2)}\n`);
console.log(`Release artifacts ready in ${output}`);
