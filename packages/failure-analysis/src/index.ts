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
export interface FailureEvidence { message: string; stack?: string; artifacts: string[]; attempt: number; previousCategories?: readonly FailureCategory[]; }
export interface RepairDecision { allowed: boolean; reason: string; category: FailureCategory; }

export function classifyFailure(message: string): FailureCategory {
  if (/ERR_CONNECTION_REFUSED|ECONNREFUSED|browserType\.launch|executable doesn't exist/i.test(message)) return 'ENVIRONMENT_ERROR';
  if (/net::|fetch|ECONNRESET|ENOTFOUND/i.test(message)) return 'NETWORK_ERROR';
  if (/API (?:response )?schema assertion|contract assertion|specification mismatch/i.test(message)) return 'SPECIFICATION_MISMATCH';
  if (/locator|waiting for|to be visible|to have text/i.test(message)) return 'LOCATOR_CHANGED';
  if (/timeout|timed out|waitUntil/i.test(message)) return 'WAIT_CONDITION_ERROR';
  if (/test.?data|fixture|seed/i.test(message)) return 'TEST_DATA_ERROR';
  if (/assert|expect|status/i.test(message)) return 'PRODUCT_DEFECT';
  return 'UNKNOWN';
}

export function decideRepair(evidence: FailureEvidence, options: { maxAttempts: number; forbidAppCodeChanges: boolean }): RepairDecision {
  const category = classifyFailure(evidence.message);
  if (evidence.attempt >= options.maxAttempts) return { allowed: false, reason: 'maximum repair attempts reached', category };
  const lastCategory = evidence.previousCategories?.at(-1);
  if (lastCategory === category) return { allowed: false, reason: 'the same failure cause repeated consecutively; stopping before the attempt limit', category };
  if (category === 'ENVIRONMENT_ERROR' || category === 'NETWORK_ERROR') return { allowed: false, reason: 'environment and network failures require operator remediation', category };
  if (category === 'PRODUCT_DEFECT' || category === 'SPECIFICATION_MISMATCH') return { allowed: false, reason: 'suspected product defects must be reported for approval, not hidden by test changes', category };
  if (!options.forbidAppCodeChanges) return { allowed: false, reason: 'repair policy must forbid product code changes', category };
  return { allowed: true, reason: 'a manifest-only repair proposal may be generated', category };
}

export function validateRepairPaths(paths: readonly string[]): void { for (const path of paths) { if (!path.endsWith('.yaml') && !path.endsWith('.yml') && !path.endsWith('.map.json')) throw new Error(`repair may not modify ${path}`); if (path.split('/').includes('..')) throw new Error('repair path traversal is not allowed'); } }
