import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const result = spawnSync(process.execPath, ['--import', 'tsx', fileURLToPath(new URL('./index.js', import.meta.url)), ...process.argv.slice(2)], { stdio: 'inherit' });
process.exitCode = result.status ?? 1;
