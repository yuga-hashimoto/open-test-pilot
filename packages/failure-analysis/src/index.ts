export type FailureCategory = 'ENVIRONMENT_ERROR' | 'NETWORK_ERROR' | 'LOCATOR_CHANGED' | 'PRODUCT_DEFECT' | 'TEST_IMPLEMENTATION_ERROR' | 'UNKNOWN';
export interface FailureEvidence { message: string; stack?: string; artifacts: string[]; attempt: number; }
export interface RepairDecision { allowed: boolean; reason: string; category: FailureCategory; }

export function classifyFailure(message: string): FailureCategory { if (/ERR_CONNECTION_REFUSED|browserType\.launch|executable doesn't exist/i.test(message)) return 'ENVIRONMENT_ERROR'; if (/net::|fetch|ECONNRESET|ENOTFOUND|timeout/i.test(message)) return 'NETWORK_ERROR'; if (/locator|waiting for|to be visible|to have text/i.test(message)) return 'LOCATOR_CHANGED'; if (/assert|expect|status/i.test(message)) return 'PRODUCT_DEFECT'; return 'UNKNOWN'; }

export function decideRepair(evidence: FailureEvidence, options: { maxAttempts: number; forbidAppCodeChanges: boolean }): RepairDecision {
  const category = classifyFailure(evidence.message);
  if (evidence.attempt >= options.maxAttempts) return { allowed: false, reason: 'maximum repair attempts reached', category };
  if (category === 'ENVIRONMENT_ERROR' || category === 'NETWORK_ERROR') return { allowed: false, reason: 'environment and network failures require operator remediation', category };
  if (!options.forbidAppCodeChanges) return { allowed: false, reason: 'repair policy must forbid product code changes', category };
  return { allowed: true, reason: 'a manifest-only repair proposal may be generated', category };
}

export function validateRepairPaths(paths: readonly string[]): void { for (const path of paths) { if (!path.endsWith('.yaml') && !path.endsWith('.yml') && !path.endsWith('.map.json')) throw new Error(`repair may not modify ${path}`); if (path.split('/').includes('..')) throw new Error('repair path traversal is not allowed'); } }
