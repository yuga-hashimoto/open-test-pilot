#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { generateMobileAppium, generatePlaywright } from '@open-test-pilot/generator';
import { runLocal } from '@open-test-pilot/local-runner';
import type { CustomActionExecutor } from '@open-test-pilot/playwright-adapter';
import { diffManifests, migrateManifest, previewMigration } from '@open-test-pilot/manifest-migrator';
import { parseManifest } from '@open-test-pilot/manifest-parser';
import { renderReport } from '@open-test-pilot/report';
import type { TestRunResult } from '@open-test-pilot/result-schema';

export async function runCli(args: string[], output: string[] = []): Promise<number> {
  const [group, command, input, ...rest] = args;
  if (group === 'manifest' && (command === 'validate' || command === 'generate') && input !== undefined) {
    const source = await readFile(input, 'utf8');
    const parsed = parseManifest(source, input);
    if (parsed.diagnostics.length > 0) {
      parsed.diagnostics.forEach((diagnostic) => output.push(`${diagnostic.severity}: ${diagnostic.code} ${diagnostic.path} ${diagnostic.message}`));
      return 1;
    }
    if (command === 'validate') {
      output.push(`valid: ${input}`);
      return 0;
    }
    const isMobile = [...parsed.manifest.setup, ...parsed.manifest.steps, ...parsed.manifest.cleanup].some((step) => step.actions.some((action) => action.type.startsWith('mobile.')));
    const generated = isMobile ? generateMobileAppium(parsed.manifest) : generatePlaywright(parsed.manifest);
    const generatedPath = isAbsolute(parsed.manifest.generatedCode.path)
      ? parsed.manifest.generatedCode.path
      : resolve(dirname(input), parsed.manifest.generatedCode.path);
    await mkdir(dirname(generatedPath), { recursive: true });
    await writeFile(generatedPath, generated.code, 'utf8');
    await writeFile(`${generatedPath}.map.json`, JSON.stringify(generated.sourceMap, null, 2), 'utf8');
    output.push(`generated: ${generatedPath}`);
    return 0;
  }

  if (group === 'manifest' && command === 'migrate' && input !== undefined) {
    const source = await readFile(input, 'utf8');
    const preview = previewMigration(parseYaml(source));
    if (!rest.includes('--approve')) {
      output.push('migration preview (no files changed):');
      output.push(preview.yamlDiff);
      output.push('pass --approve to write the migrated Manifest');
      return 0;
    }
    await writeFile(input, stringifyYaml(migrateManifest(parseYaml(source), { approve: true })), 'utf8');
    output.push(`migrated: ${input}`);
    output.push('generated-code diff:');
    output.push(preview.generatedCodeDiff);
    return 0;
  }

  if (group === 'manifest' && command === 'diff' && input !== undefined && rest[0] !== undefined) {
    const before = parseYaml(await readFile(input, 'utf8')) as unknown;
    const after = parseYaml(await readFile(rest[0], 'utf8')) as unknown;
    output.push(diffManifests(before, after));
    return 0;
  }

  if (group === 'run' && command !== undefined) {
    const source = await readFile(command, 'utf8');
    const parsed = parseManifest(source, command);
    if (parsed.diagnostics.length > 0) {
      parsed.diagnostics.forEach((diagnostic) => output.push(`${diagnostic.severity}: ${diagnostic.code} ${diagnostic.path} ${diagnostic.message}`));
      return 1;
    }
    const runArgs = input === undefined ? rest : [input, ...rest];
    const actionFlag = runArgs.indexOf('--actions');
    let customActions: Record<string, CustomActionExecutor> | undefined;
    const actionPath = actionFlag >= 0 ? runArgs[actionFlag + 1] : undefined;
    if (actionPath !== undefined) {
      const loaded = await import(resolve(actionPath));
      const loadedActions: unknown = loaded.customActions ?? loaded.default;
      customActions = loadedActions as Record<string, CustomActionExecutor>;
    }
    const result = await runLocal(parsed.manifest, {
      ...(customActions === undefined ? {} : { customActions }),
      ...(actionPath === undefined ? {} : { customActionModule: resolve(actionPath) }),
    });
    output.push(`run: ${result.runId}`);
    output.push(`report: ${result.htmlReportPath}`);
    return result.status === 'passed' ? 0 : 1;
  }

  if (group === 'report' && command !== undefined) {
    const source = await readFile(command, 'utf8');
    const result = JSON.parse(source) as TestRunResult;
    const htmlPath = join(dirname(command), 'index.html');
    await writeFile(htmlPath, renderReport(result), 'utf8');
    output.push(`report: ${htmlPath}`);
    return 0;
  }

  output.push('Usage: testpilot manifest validate <file> | manifest generate <file> | manifest migrate <file> [--approve] | manifest diff <before> <after> | run <file> [--actions <module>] | report <report.json>');
  return 2;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const output: string[] = [];
  const exitCode = await runCli(process.argv.slice(2), output);
  output.forEach((line) => console.log(line));
  process.exitCode = exitCode;
}
