export type TriggerKind = 'api' | 'schedule' | 'github.push' | 'github.pull_request' | 'webhook' | 'cli';
export interface TriggerEvent { id: string; kind: TriggerKind; organizationId: string; projectId: string; testId?: string; payload?: Record<string, unknown>; receivedAt: string; }

export interface TriggerRoute { kind: TriggerKind; projectId: string; testId?: string; }

export class TriggerRouter {
  private readonly seen = new Set<string>();
  constructor(private readonly routes: TriggerRoute[]) {}
  dispatch(event: TriggerEvent): TriggerRoute[] {
    if (this.seen.has(event.id)) return [];
    this.seen.add(event.id);
    return this.routes.filter((route) => route.kind === event.kind && route.projectId === event.projectId && (route.testId === undefined || route.testId === event.testId));
  }
}

export function validateCronExpression(expression: string): string {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5 || fields.some((field) => !/^[\d*/?,\-]+$/.test(field))) throw new Error('schedule must be a five-field cron expression');
  return fields.join(' ');
}
