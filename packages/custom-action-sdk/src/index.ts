export const CustomActionApiVersion = '1.0.0' as const;
export type JsonSchema = Readonly<Record<string, unknown>>;

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
  description?: string;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  permissions: ActionPermissions;
  execute(context: ActionContext, input: Input): Promise<Output>;
}

export interface RegisteredAction<Input extends object = Record<string, unknown>, Output = unknown> extends ActionDefinition<Input, Output> {
  apiVersion: typeof CustomActionApiVersion;
}

export function defineAction<Input extends object, Output>(definition: ActionDefinition<Input, Output>): RegisteredAction<Input, Output> {
  return { ...definition, apiVersion: CustomActionApiVersion };
}

export class ActionRegistry {
  private readonly actions = new Map<string, RegisteredAction>();

  public register(action: RegisteredAction): void {
    if (this.actions.has(action.type)) throw new Error(`Action type already registered: ${action.type}`);
    this.actions.set(action.type, action);
  }

  public get(type: string): RegisteredAction | undefined { return this.actions.get(type); }
}
