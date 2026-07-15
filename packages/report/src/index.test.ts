import { describe, expect, it } from 'vitest';
import { renderReport } from './index.js';

describe('renderReport', () => {
  it('renders escaped run data and local artifact links', () => {
    const html = renderReport({
      runId: 'run-1',
      testId: 'test-1',
      manifestId: 'manifest-1',
      status: 'failed',
      startedAt: '2026-07-16T00:00:00.000Z',
      endedAt: '2026-07-16T00:00:01.000Z',
      metadata: { browser: 'Chromium', browserVersion: '1', viewport: { width: 1280, height: 720 } },
      steps: [{
        stepId: 'step-1',
        status: 'failed',
        startedAt: '2026-07-16T00:00:00.000Z',
        endedAt: '2026-07-16T00:00:01.000Z',
        actions: [{
          actionId: 'action-1',
          type: 'web.click',
          status: 'failed',
          startedAt: '2026-07-16T00:00:00.000Z',
          endedAt: '2026-07-16T00:00:01.000Z',
          error: { message: '<unsafe>', category: 'LOCATOR_CHANGED' },
          artifacts: ['artifact-1'],
        }],
      }],
      artifacts: [{ id: 'artifact-1', type: 'screenshot', path: 'screenshots/failure.png', createdAt: '2026-07-16T00:00:01.000Z' }],
    });
    expect(html).toContain('<title>OpenTestPilot run-1</title>');
    expect(html).toContain('screenshots/failure.png');
    expect(html).toContain('&lt;unsafe&gt;');
    expect(html).not.toContain('<unsafe>');
  });
});
