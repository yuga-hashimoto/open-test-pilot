import { Ajv } from 'ajv';

export const CustomActionApiVersion = '1.0.0' as const;
export type JsonSchema = Readonly<Record<string, unknown>>;
export type ActionPublicationStatus = 'private' | 'published' | 'deprecated';

export interface ActionUiSchema {
  order?: string[];
  fields?: Readonly<Record<string, { label?: string; description?: string; widget?: 'text' | 'password' | 'select' | 'checkbox' | 'json' }>>;
}

export interface ActionContext {
  organizationId: string;
  projectId?: string;
  runId: string;
  getSecret(name: string): Promise<string | undefined>;
  writeArtifact(name: string, body: Uint8Array, contentType: string): Promise<string>;
}

export interface ActionPermissions {
  network?: string[];
  filesystem?: { read?: string[]; write?: string[] };
  secrets?: string[];
}

export interface ActionDefinition<Input extends object = Record<string, unknown>, Output = unknown> {
  type: string;
  title: string;
  version?: string;
  description?: string;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  uiSchema?: ActionUiSchema;
  permissions: ActionPermissions;
  execute(context: ActionContext, input: Input): Promise<Output>;
}

export interface RegisteredAction<Input extends object = Record<string, unknown>, Output = unknown> extends ActionDefinition<Input, Output> {
  apiVersion: typeof CustomActionApiVersion;
  version: string;
  publication: ActionPublicationStatus;
}

export function defineAction<Input extends object, Output>(definition: ActionDefinition<Input, Output>): RegisteredAction<Input, Output> {
  if (!/^[a-z][A-Za-z0-9]*(?:[._-][A-Za-z0-9]+)+$/.test(definition.type)) throw new Error(`invalid action type: ${definition.type}`);
  if (definition.version !== undefined && !/^\d+\.\d+\.\d+$/.test(definition.version)) throw new Error(`invalid action version: ${definition.version}`);
  return { ...definition, apiVersion: CustomActionApiVersion, version: definition.version ?? '1.0.0', publication: 'private' };
}

export class ActionRegistry {
  private readonly actions = new Map<string, RegisteredAction>();

  public register(action: RegisteredAction): void {
    if (this.actions.has(action.type)) throw new Error(`Action type already registered: ${action.type}`);
    this.actions.set(action.type, action);
  }

  public get(type: string): RegisteredAction | undefined { return this.actions.get(type); }
  public list(): RegisteredAction[] { return [...this.actions.values()]; }
  public publish(type: string): RegisteredAction {
    const action = this.actions.get(type);
    if (action === undefined) throw new Error(`Action type is not registered: ${type}`);
    validateSchema(action.inputSchema, 'inputSchema');
    validateSchema(action.outputSchema, 'outputSchema');
    const published = { ...action, publication: 'published' as const };
    this.actions.set(type, published);
    return published;
  }
  public deprecate(type: string): RegisteredAction {
    const action = this.actions.get(type);
    if (action === undefined) throw new Error(`Action type is not registered: ${type}`);
    const deprecated = { ...action, publication: 'deprecated' as const };
    this.actions.set(type, deprecated);
    return deprecated;
  }
}

export function validateActionInput(action: RegisteredAction, input: unknown): string[] {
  const validator = new Ajv({ allErrors: true, strict: false }).compile(action.inputSchema);
  if (validator(input)) return [];
  return (validator.errors ?? []).map((error) => `${error.instancePath || '$'} ${error.message ?? 'is invalid'}`);
}

function validateSchema(schema: JsonSchema, name: string): void {
  try { new Ajv({ strict: false }).compile(schema); } catch (error) { throw new Error(`${name} is not valid JSON Schema: ${error instanceof Error ? error.message : String(error)}`); }
}
