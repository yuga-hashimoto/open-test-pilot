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
