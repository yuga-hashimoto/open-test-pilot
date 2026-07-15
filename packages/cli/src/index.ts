#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generatePlaywright } from '@open-test-pilot/generator';
import { runLocal } from '@open-test-pilot/local-runner';
import { parseManifest } from '@open-test-pilot/manifest-parser';
import { renderReport } from '@open-test-pilot/report';
import type { TestRunResult } from '@open-test-pilot/result-schema';

export async function runCli(args: string[], output: string[] = []): Promise<number> {
  const [group, command, input] = args;
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
    const generated = generatePlaywright(parsed.manifest);
    const generatedPath = isAbsolute(parsed.manifest.generatedCode.path)
      ? parsed.manifest.generatedCode.path
      : resolve(dirname(input), parsed.manifest.generatedCode.path);
    await mkdir(dirname(generatedPath), { recursive: true });
    await writeFile(generatedPath, generated.code, 'utf8');
    await writeFile(`${generatedPath}.map.json`, JSON.stringify(generated.sourceMap, null, 2), 'utf8');
    output.push(`generated: ${generatedPath}`);
    return 0;
  }

  if (group === 'run' && command !== undefined) {
    const source = await readFile(command, 'utf8');
    const parsed = parseManifest(source, command);
    if (parsed.diagnostics.length > 0) {
      parsed.diagnostics.forEach((diagnostic) => output.push(`${diagnostic.severity}: ${diagnostic.code} ${diagnostic.path} ${diagnostic.message}`));
      return 1;
    }
    const result = await runLocal(parsed.manifest);
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

  output.push('Usage: testpilot manifest validate <file> | manifest generate <file> | run <file> | report <report.json>');
  return 2;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const output: string[] = [];
  const exitCode = await runCli(process.argv.slice(2), output);
  output.forEach((line) => console.log(line));
  process.exitCode = exitCode;
}
