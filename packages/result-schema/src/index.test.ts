import { describe, expect, it } from 'vitest';
import {
  type Artifact,
  type ActionResult,
  type FailureCategory,
  FailureCategorySchema,
  isRunStatus,
  type ResultEnvelope,
  ResultProtocolVersion,
  type RunMetadata,
  type RunStatus,
  type StepResult,
  type TestRunResult,
  validateTestRunResult,
  redactSecrets,
} from './index.js';

describe('Result Protocol', () => {
  it('exports the result protocol version constant', () => {
    expect(ResultProtocolVersion).toBe('1.0.0');
  });

  it('defines all required run statuses', () => {
    const statuses: RunStatus[] = [
      'queued',
      'running',
      'passed',
      'failed',
      'cancelled',
    ];
    expect(statuses).toHaveLength(5);
  });

  it('defines all required failure categories', () => {
    const categories: FailureCategory[] = [
      'TEST_IMPLEMENTATION_ERROR',
      'LOCATOR_CHANGED',
      'WAIT_CONDITION_ERROR',
      'TEST_DATA_ERROR',
      'ENVIRONMENT_ERROR',
      'NETWORK_ERROR',
      'PRODUCT_DEFECT',
      'SPECIFICATION_MISMATCH',
      'UNKNOWN',
    ];
    expect(categories).toHaveLength(9);
  });

  describe('Artifact', () => {
    it('requires id, type, path, and timestamps', () => {
      const artifact: Artifact = {
        id: 'art-001',
        type: 'screenshot',
        path: 'runs/run-1/step-1/after.png',
        createdAt: '2026-07-16T00:00:00.000Z',
      };
      expect(artifact.id).toBe('art-001');
      expect(artifact.type).toBe('screenshot');
      expect(artifact.path).toBe('runs/run-1/step-1/after.png');
    });

    it('must not contain secret values', () => {
      const artifact: Artifact = {
        id: 'art-002',
        type: 'screenshot',
        path: 'runs/run-1/step-1/screenshot.png',
        createdAt: '2026-07-16T00:00:00.000Z',
      };
      expect(artifact).not.toHaveProperty('secretValue');
      expect(artifact).not.toHaveProperty('secret');
      expect(artifact).not.toHaveProperty('apiKey');
      expect(artifact).not.toHaveProperty('token');
    });
  });

  describe('ActionResult', () => {
    it('contains action ID, status, timing, and optional error', () => {
      const result: ActionResult = {
        actionId: 'act-login',
        type: 'web.fill',
        status: 'passed',
        startedAt: '2026-07-16T00:00:00.000Z',
        endedAt: '2026-07-16T00:00:01.000Z',
      };
      expect(result.actionId).toBe('act-login');
      expect(result.status).toBe('passed');
      expect(result.startedAt).toBeTruthy();
      expect(result.endedAt).toBeTruthy();
    });

    it('includes failure details when status is failed', () => {
      const result: ActionResult = {
        actionId: 'act-login',
        type: 'web.fill',
        status: 'failed',
        startedAt: '2026-07-16T00:00:00.000Z',
        endedAt: '2026-07-16T00:00:01.000Z',
        error: {
          message: 'Element not found',
          category: 'LOCATOR_CHANGED',
        },
        artifacts: [],
      };
      expect(result.error?.category).toBe('LOCATOR_CHANGED');
      expect(result.error?.message).toBe('Element not found');
    });

    it('references artifacts by ID', () => {
      const result: ActionResult = {
        actionId: 'act-screenshot',
        type: 'web.screenshot',
        status: 'passed',
        startedAt: '2026-07-16T00:00:00.000Z',
        endedAt: '2026-07-16T00:00:01.000Z',
        artifacts: ['art-001'],
      };
      expect(result.artifacts).toContain('art-001');
    });
  });

  describe('StepResult', () => {
    it('contains step ID, status, timing, and action results', () => {
      const step: StepResult = {
        stepId: 'step-login',
        status: 'passed',
        startedAt: '2026-07-16T00:00:00.000Z',
        endedAt: '2026-07-16T00:00:05.000Z',
        actions: [],
      };
      expect(step.stepId).toBe('step-login');
      expect(step.status).toBe('passed');
      expect(step.actions).toEqual([]);
    });
  });

  describe('TestRunResult', () => {
    it('contains run and test IDs, status, metadata, steps, and artifacts', () => {
      const run: TestRunResult = {
        runId: 'run-001',
        testId: 'test-login',
        manifestId: 'manifest-001',
        status: 'passed',
        startedAt: '2026-07-16T00:00:00.000Z',
        endedAt: '2026-07-16T00:00:10.000Z',
        metadata: {
          browser: 'Chromium',
          browserVersion: '130.0',
          viewport: { width: 1280, height: 720 },
        },
        steps: [],
        artifacts: [],
        generatedCodePath: 'generated/test-login.spec.ts',
      };
      expect(run.runId).toBe('run-001');
      expect(run.status).toBe('passed');
      expect(run.metadata.browser).toBe('Chromium');
    });

    it('records commit and environment metadata when available', () => {
      const run: TestRunResult = {
        runId: 'run-002',
        testId: 'test-checkout',
        manifestId: 'manifest-002',
        status: 'failed',
        startedAt: '2026-07-16T00:00:00.000Z',
        endedAt: '2026-07-16T00:00:10.000Z',
        metadata: {
          browser: 'Chromium',
          browserVersion: '130.0',
          viewport: { width: 1280, height: 720 },
          commit: 'abc123',
          branch: 'main',
          environment: 'staging',
        },
        steps: [],
        artifacts: [],
      };
      expect(run.metadata.commit).toBe('abc123');
      expect(run.metadata.branch).toBe('main');
      expect(run.metadata.environment).toBe('staging');
    });
  });

  describe('ResultEnvelope', () => {
    it('wraps a result with protocol version', () => {
      const envelope: ResultEnvelope = {
        protocolVersion: '1.0.0',
        result: {
          runId: 'run-001',
          testId: 'test-login',
          manifestId: 'manifest-001',
          status: 'passed',
          startedAt: '2026-07-16T00:00:00.000Z',
          endedAt: '2026-07-16T00:00:10.000Z',
          metadata: {
            browser: 'Chromium',
            browserVersion: '130.0',
            viewport: { width: 1280, height: 720 },
          },
          steps: [],
          artifacts: [],
        },
      };
      expect(envelope.protocolVersion).toBe('1.0.0');
      expect(envelope.result.runId).toBe('run-001');
    });
  });

  describe('isRunStatus guard', () => {
    it('returns true for valid statuses', () => {
      expect(isRunStatus('queued')).toBe(true);
      expect(isRunStatus('running')).toBe(true);
      expect(isRunStatus('passed')).toBe(true);
      expect(isRunStatus('failed')).toBe(true);
      expect(isRunStatus('cancelled')).toBe(true);
    });

    it('returns false for invalid statuses', () => {
      expect(isRunStatus('unknown')).toBe(false);
      expect(isRunStatus('pending')).toBe(false);
      expect(isRunStatus('')).toBe(false);
    });
  });

  describe('failure category schema validation', () => {
    it('accepts all valid failure categories', () => {
      const valid: FailureCategory[] = [
        'TEST_IMPLEMENTATION_ERROR',
        'LOCATOR_CHANGED',
        'WAIT_CONDITION_ERROR',
        'TEST_DATA_ERROR',
        'ENVIRONMENT_ERROR',
        'NETWORK_ERROR',
        'PRODUCT_DEFECT',
        'SPECIFICATION_MISMATCH',
        'UNKNOWN',
      ];
      for (const cat of valid) {
        expect(FailureCategorySchema.safeParse(cat).success).toBe(true);
      }
    });

    it('rejects invalid failure categories', () => {
      expect(FailureCategorySchema.safeParse('RANDOM_ERROR').success).toBe(false);
      expect(FailureCategorySchema.safeParse('').success).toBe(false);
    });
  });

  it('validates stable IDs, artifact references, and failure categories', () => {
    const result: TestRunResult = {
      runId: 'run-1', testId: 'test-1', manifestId: 'manifest-1', status: 'failed', startedAt: '2026-07-16T00:00:00.000Z', endedAt: '2026-07-16T00:00:01.000Z', metadata: { browser: 'Chromium', browserVersion: '1', viewport: { width: 1, height: 1 } },
      steps: [{ stepId: 'step-1', status: 'failed', startedAt: '2026-07-16T00:00:00.000Z', endedAt: '2026-07-16T00:00:01.000Z', actions: [{ actionId: 'action-1', type: 'web.click', status: 'failed', startedAt: '2026-07-16T00:00:00.000Z', endedAt: '2026-07-16T00:00:01.000Z', error: { message: 'not found', category: 'LOCATOR_CHANGED' }, artifacts: ['artifact-1'] }] }],
      artifacts: [{ id: 'artifact-1', type: 'screenshot', path: 'screenshots/failure.png', createdAt: '2026-07-16T00:00:01.000Z' }],
    };
    expect(validateTestRunResult(result)).toEqual({ valid: true, errors: [] });
    expect(validateTestRunResult({ ...result, runId: '' })).toMatchObject({ valid: false });
  });

  it('redacts configured secret values from nested result data', () => {
    expect(redactSecrets({ message: 'Bearer secret-token', nested: ['secret-token'] }, ['secret-token'])).toEqual({ message: 'Bearer [REDACTED]', nested: ['[REDACTED]'] });
  });
});
