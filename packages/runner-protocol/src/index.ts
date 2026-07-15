export const RunnerProtocolVersion = '1.0.0' as const;

export type JobStatus =
  | 'queued'
  | 'leased'
  | 'running'
  | 'passed'
  | 'failed'
  | 'cancelled'
  | 'expired'
  | 'rejected';

export type LeaseStatus = 'active' | 'expired' | 'released' | 'revoked';

export type ExecutionMode = 'local' | 'docker' | 'trusted-host';

export interface Capabilities {
  browsers: string[];
  labels?: string[];
  operatingSystem?: string;
  maxConcurrency: number;
  devices?: string[];
}

export interface RetryPolicy {
  maxAttempts: number;
  backoff: 'linear' | 'exponential' | 'fixed';
  initialDelay?: number;
}

export interface ArtifactPolicy {
  captureScreenshots: 'never' | 'after' | 'all';
  retainTraces?: boolean;
  maxArtifactSize?: number;
}

export interface ManifestReference {
  schemaVersion: string;
  id: string;
  name: string;
}

export interface Job {
  jobId: string;
  runId: string;
  manifest: ManifestReference;
  requestedCapabilities: Capabilities;
  status: JobStatus;
  createdAt: string;
  organizationId?: string;
  projectId?: string;
  sourceRevision?: string;
  timeout?: number;
  retryPolicy?: RetryPolicy;
  executionMode?: ExecutionMode;
  artifactPolicy?: ArtifactPolicy;
  priority?: number;
  requiredLabels?: string[];
}
