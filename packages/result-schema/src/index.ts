export const ResultProtocolVersion = '1.0.0' as const;

export type RunStatus = 'queued' | 'running' | 'passed' | 'failed' | 'cancelled';

export type FailureCategory =
  | 'TEST_IMPLEMENTATION_ERROR'
  | 'LOCATOR_CHANGED'
  | 'WAIT_CONDITION_ERROR'
  | 'TEST_DATA_ERROR'
  | 'ENVIRONMENT_ERROR'
  | 'NETWORK_ERROR'
  | 'PRODUCT_DEFECT'
  | 'SPECIFICATION_MISMATCH'
  | 'UNKNOWN';

const RUN_STATUSES: ReadonlySet<RunStatus> = new Set([
  'queued',
  'running',
  'passed',
  'failed',
  'cancelled',
]);

export function isRunStatus(value: string): value is RunStatus {
  return RUN_STATUSES.has(value as RunStatus);
}

const FAILURE_CATEGORIES: ReadonlySet<FailureCategory> = new Set([
  'TEST_IMPLEMENTATION_ERROR',
  'LOCATOR_CHANGED',
  'WAIT_CONDITION_ERROR',
  'TEST_DATA_ERROR',
  'ENVIRONMENT_ERROR',
  'NETWORK_ERROR',
  'PRODUCT_DEFECT',
  'SPECIFICATION_MISMATCH',
  'UNKNOWN',
]);

export const FailureCategorySchema = {
  safeParse(value: string): { success: true; data: FailureCategory } | { success: false; error: string } {
    if (FAILURE_CATEGORIES.has(value as FailureCategory)) {
      return { success: true, data: value as FailureCategory };
    }
    return { success: false, error: `Invalid failure category: ${value}` };
  },
} as const;

export interface RunMetadata {
  browser: string;
  browserVersion: string;
  viewport: { width: number; height: number };
  commit?: string;
  branch?: string;
  environment?: string;
}

export interface Artifact {
  id: string;
  type: string;
  path: string;
  createdAt: string;
  mimeType?: string;
  size?: number;
}

export interface ActionError {
  message: string;
  category: FailureCategory;
  stack?: string;
}

export interface ActionResult {
  actionId: string;
  type: string;
  status: 'passed' | 'failed' | 'skipped';
  startedAt: string;
  endedAt: string;
  error?: ActionError;
  artifacts?: string[];
}

export interface StepResult {
  stepId: string;
  status: 'passed' | 'failed' | 'skipped';
  startedAt: string;
  endedAt: string;
  actions: ActionResult[];
}

export interface TestRunResult {
  runId: string;
  testId: string;
  manifestId: string;
  status: RunStatus;
  startedAt: string;
  endedAt: string;
  metadata: RunMetadata;
  steps: StepResult[];
  artifacts: Artifact[];
  generatedCodePath?: string;
  sourceMapPath?: string;
}

export interface ResultEnvelope {
  protocolVersion: typeof ResultProtocolVersion;
  result: TestRunResult;
}

export interface ResultValidation { valid: boolean; errors: string[]; }

export function validateTestRunResult(value: unknown): ResultValidation {
  const errors: string[] = [];
  if (value === null || typeof value !== 'object') return { valid: false, errors: ['result must be an object'] };
  const result = value as Partial<TestRunResult>;
  for (const field of ['runId', 'testId', 'manifestId', 'startedAt', 'endedAt']) if (typeof result[field as keyof TestRunResult] !== 'string' || String(result[field as keyof TestRunResult]).length === 0) errors.push(`${field} is required`);
  if (!isRunStatus(String(result.status))) errors.push('status is invalid');
  const artifactIds = new Set<string>();
  for (const artifact of result.artifacts ?? []) {
    if (typeof artifact.id !== 'string' || artifact.id.length === 0) errors.push('artifact id is required');
    if (artifactIds.has(artifact.id)) errors.push(`duplicate artifact id: ${artifact.id}`);
    artifactIds.add(artifact.id);
  }
  const stepIds = new Set<string>();
  for (const step of result.steps ?? []) {
    if (stepIds.has(step.stepId)) errors.push(`duplicate step id: ${step.stepId}`);
    stepIds.add(step.stepId);
    for (const action of step.actions ?? []) {
      if (action.actionId.length === 0) errors.push('action id is required');
      if (action.status === 'failed' && (action.error === undefined || !FailureCategorySchema.safeParse(action.error.category).success)) errors.push(`failed action ${action.actionId} requires a valid failure category`);
      for (const artifactId of action.artifacts ?? []) if (!artifactIds.has(artifactId)) errors.push(`unknown artifact reference: ${artifactId}`);
    }
  }
  return { valid: errors.length === 0, errors };
}

export function redactSecrets<T>(value: T, secrets: readonly string[]): T {
  const redact = (current: unknown): unknown => {
    if (typeof current === 'string') return secrets.filter((secret) => secret.length > 0).reduce((text, secret) => text.replaceAll(secret, '[REDACTED]'), current);
    if (Array.isArray(current)) return current.map(redact);
    if (current !== null && typeof current === 'object') return Object.fromEntries(Object.entries(current).map(([key, item]) => [key, redact(item)]));
    return current;
  };
  return redact(value) as T;
}
