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
  if (fields.length !== 5 || fields.some((field) => !/^[\d*/\-,]+$/.test(field))) throw new Error('schedule must be a five-field cron expression');
  return fields.join(' ');
}

function valuesForField(field: string, minimum: number, maximum: number): Set<number> {
  const values = new Set<number>();
  for (const segment of field.split(',')) {
    const parts = segment.split('/');
    const rangePart = parts[0] ?? '';
    const stepPart = parts[1];
    const step = stepPart === undefined ? 1 : Number(stepPart);
    if (!Number.isInteger(step) || step < 1) throw new Error(`invalid cron step: ${segment}`);
    const [startText, endText] = rangePart === '*' ? [String(minimum), String(maximum)] : rangePart.split('-');
    const start = startText === undefined || startText === '' ? minimum : Number(startText);
    const end = endText === undefined || endText === '' ? start : Number(endText);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < minimum || end > maximum || start > end) throw new Error(`invalid cron range: ${segment}`);
    for (let value = start; value <= end; value += step) values.add(value);
  }
  return values;
}

export function cronMatches(date: Date, expression: string): boolean {
  const fields = validateCronExpression(expression).split(' ');
  const minute = valuesForField(fields[0] ?? '*', 0, 59).has(date.getMinutes());
  const hour = valuesForField(fields[1] ?? '*', 0, 23).has(date.getHours());
  const month = valuesForField(fields[3] ?? '*', 1, 12).has(date.getMonth() + 1);
  const dayOfMonthField = fields[2] ?? '*';
  const dayOfWeekField = fields[4] ?? '*';
  const dayOfMonth = valuesForField(dayOfMonthField, 1, 31).has(date.getDate());
  const dayOfWeek = valuesForField(dayOfWeekField, 0, 7).has(date.getDay()) || (date.getDay() === 0 && valuesForField(dayOfWeekField, 0, 7).has(7));
  const dayOfMonthWildcard = dayOfMonthField === '*';
  const dayOfWeekWildcard = dayOfWeekField === '*';
  const dayMatches = dayOfMonthWildcard && dayOfWeekWildcard
    ? true
    : dayOfMonthWildcard
      ? dayOfWeek
      : dayOfWeekWildcard
        ? dayOfMonth
        : dayOfMonth || dayOfWeek;
  return minute && hour && month && dayMatches;
}
