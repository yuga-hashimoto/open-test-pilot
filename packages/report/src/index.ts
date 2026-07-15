import type { ActionResult, Artifact, StepResult, TestRunResult } from '@open-test-pilot/result-schema';

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function artifactById(artifacts: Artifact[], id: string): Artifact | undefined {
  return artifacts.find((artifact) => artifact.id === id);
}

function renderAction(action: ActionResult, artifacts: Artifact[]): string {
  const error = action.error === undefined
    ? ''
    : `<div class="error"><strong>${escapeHtml(action.error.category)}</strong>: ${escapeHtml(action.error.message)}</div>`;
  const links = (action.artifacts ?? [])
    .map((id) => artifactById(artifacts, id))
    .filter((artifact): artifact is Artifact => artifact !== undefined)
    .map((artifact) => `<a href="${escapeHtml(artifact.path)}">${escapeHtml(artifact.type)}</a>`)
    .join(' ');
  return `<li class="action ${escapeHtml(action.status)}"><code>${escapeHtml(action.actionId)}</code> <span>${escapeHtml(action.type)}</span>${error}${links.length > 0 ? `<div class="artifacts">${links}</div>` : ''}</li>`;
}

function renderStep(step: StepResult, artifacts: Artifact[]): string {
  return `<li class="step ${escapeHtml(step.status)}"><h3>${escapeHtml(step.stepId)} <small>${escapeHtml(step.status)}</small></h3><ul>${step.actions.map((action) => renderAction(action, artifacts)).join('')}</ul></li>`;
}

export function renderReport(result: TestRunResult): string {
  const title = `OpenTestPilot ${result.runId}`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title>
<style>body{font-family:system-ui,sans-serif;max-width:960px;margin:2rem auto;padding:0 1rem;color:#202124}.passed{color:#137333}.failed{color:#b3261e}.step,.action{margin:.5rem 0}.step{padding:.75rem;border:1px solid #ddd;border-radius:.5rem}.action{padding:.35rem}.error{margin:.25rem 0;color:#b3261e}.artifacts{display:flex;gap:.75rem;font-size:.9rem}small{font-weight:normal}</style>
</head><body><header><h1>${escapeHtml(title)}</h1><p class="${escapeHtml(result.status)}">Status: <strong>${escapeHtml(result.status)}</strong></p><p>Test: ${escapeHtml(result.testId)} · Browser: ${escapeHtml(result.metadata.browser)}</p></header>
<main><h2>Steps</h2><ol>${result.steps.map((step) => renderStep(step, result.artifacts)).join('')}</ol><h2>Artifacts</h2><ul>${result.artifacts.map((artifact) => `<li><a href="${escapeHtml(artifact.path)}">${escapeHtml(artifact.type)} · ${escapeHtml(artifact.id)}</a></li>`).join('')}</ul></main></body></html>`;
}
