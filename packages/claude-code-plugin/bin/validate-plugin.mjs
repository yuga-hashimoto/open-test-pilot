import { access, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const plugin = JSON.parse(await readFile(join(root, '.claude-plugin/plugin.json'), 'utf8'));
const requiredSkills = ['analyze-repository', 'design-tests', 'generate-manifest', 'generate-code', 'run-tests', 'analyze-failure', 'repair-tests', 'publish-tests', 'review-tests', 'handle-change-request'];
const missing = [];
for (const skill of requiredSkills) {
  try {
    await access(join(root, `skills/${skill}/SKILL.md`));
  } catch {
    missing.push(`skills/${skill}`);
  }
}
if (!plugin.name || !plugin.version || missing.length > 0) {
  throw new Error(`Invalid OpenTestPilot Claude Code Plugin: ${missing.join(', ')}`);
}
console.log(`valid plugin: ${plugin.name}@${plugin.version}`);
