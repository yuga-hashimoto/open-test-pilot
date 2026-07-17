import { Ajv } from 'ajv';
import type { ValidateFunction } from 'ajv';

export const DefaultManifestSchemaVersion = '1.0.0' as const;

export const SupportedActions = [
  'web.goto',
  'web.fill',
  'web.click',
  'web.expectVisible',
  'web.expectText',
  'web.screenshot',
  'api.request',
  'mobile.launch',
  'mobile.tap',
  'mobile.fill',
  'mobile.expectVisible',
  'mobile.expectText',
  'mobile.screenshot',
  'mobile.back',
  'control.if',
  'control.switch',
  'control.for',
  'control.forEach',
  'control.while',
  'control.retry',
  'control.try',
  'control.parallel',
  'control.race',
  'control.waitUntil',
  'control.break',
  'control.continue',
  'control.return',
  'control.set',
  'control.call',
  'control.timeout',
  'custom.action',
] as const;

export const ReservedControlNodes = [
  'if',
  'forEach',
  'retry',
  'parallel',
  'try',
  'call',
  'timeout',
] as const;

export type ManifestActionType = (typeof SupportedActions)[number];

export interface ManifestVariable {
  name: string;
  type?: 'string' | 'number' | 'boolean' | 'object' | 'array';
  defaultValue?: string;
}

export interface ManifestSecretRef {
  name: string;
  provider: string;
  reference: string;
}

export interface ManifestMobileCapabilities {
  platform: 'android' | 'ios';
  deviceName: string;
  udid?: string;
  platformVersion?: string;
  app?: string;
  bundleId?: string;
  appPackage?: string;
  appActivity?: string;
  automationName?: 'UiAutomator2' | 'XCUITest';
  wdaLocalPort?: number;
  useNewWDA?: boolean;
  wdaLaunchTimeout?: number;
  wdaConnectionTimeout?: number;
  showXcodeLog?: boolean;
  noReset?: boolean;
  simulatorDevicesSetPath?: string;
  serverUrl?: string;
}

export interface ManifestAction {
  id: string;
  type: string;
  name?: string;
  url?: string;
  selector?: string;
  capabilities?: ManifestMobileCapabilities;
  target?: { role?: string; name?: string; label?: string; text?: string; testId?: string; css?: string };
  value?: string;
  expectedText?: string;
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  expectedStatus?: number | number[];
  jsonAssertions?: Record<string, unknown>;
  condition?: string;
  items?: string | unknown[];
  variable?: string;
  maxAttempts?: number;
  backoffMs?: number;
  timeoutMs?: number;
  pollMs?: number;
  actionType?: string;
  input?: Record<string, unknown>;
  outputs?: Record<string, string>;
  children?: ManifestAction[];
  elseChildren?: ManifestAction[];
  branches?: ManifestAction[][];
  catch?: ManifestAction[];
  finally?: ManifestAction[];
  cases?: Record<string, ManifestAction[]>;
  defaultChildren?: ManifestAction[];
  from?: number;
  to?: number;
  step?: number;
  functionName?: string;
  arguments?: Record<string, unknown>;
  customCodeRef?: string;
  assertions?: Array<Record<string, unknown>>;
}

export interface ManifestFunction {
  id: string;
  parameters?: string[];
  actions: ManifestAction[];
}

export interface ManifestStep {
  id: string;
  description?: string;
  title?: string;
  actions: ManifestAction[];
  output?: Record<string, string>;
}

export type ScreenshotMode = 'none' | 'failure-only' | 'after' | 'before-and-after';

export interface Manifest {
  schemaVersion: string;
  id: string;
  name: string;
  description: string;
  type: string;
  tags?: string[];
  priority?: string;
  preconditions: string[];
  variables: ManifestVariable[];
  secrets: ManifestSecretRef[];
  setup: ManifestStep[];
  steps: ManifestStep[];
  cleanup: ManifestStep[];
  functions?: ManifestFunction[];
  artifacts: { screenshots: ScreenshotMode; traces?: boolean };
  runner: { minBrowsers: string[] };
  permissions: { networkAccess: boolean; fileSystem?: boolean };
  source: { repository: string; path: string };
  generatedCode: { path: string };
  customCode?: Array<{ id: string; path: string; permissions?: string[] }>;
}

export interface ValidationResult {
  valid: boolean;
  errors: null | Array<{
    instancePath: string;
    keyword: string;
    message?: string | undefined;
    params: Record<string, unknown>;
    schemaPath: string;
  }>;
}

export const manifestJsonSchema = {
  type: 'object',
  required: [
    'schemaVersion',
    'id',
    'name',
    'description',
    'type',
    'tags',
    'priority',
    'preconditions',
    'variables',
    'secrets',
    'setup',
    'steps',
    'cleanup',
    'artifacts',
    'runner',
    'permissions',
    'source',
    'generatedCode',
  ],
  properties: {
    schemaVersion: { enum: [DefaultManifestSchemaVersion, '1.0'] },
    id: { type: 'string' },
    name: { type: 'string' },
    description: { type: 'string' },
    type: { type: 'string' },
    tags: { type: 'array', items: { type: 'string' } },
    priority: { type: 'string' },
    preconditions: { type: 'array', items: { type: 'string' } },
    variables: {
      type: 'array',
      items: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string' },
          type: { enum: ['string', 'number', 'boolean', 'object', 'array'] },
          defaultValue: { type: 'string' },
        },
        additionalProperties: false,
      },
    },
    secrets: {
      type: 'array',
      items: {
        type: 'object',
        required: ['name', 'provider', 'reference'],
        additionalProperties: false,
        properties: {
          name: { type: 'string' },
          provider: { type: 'string' },
          reference: { type: 'string', pattern: '^\\$\\{secret:[A-Za-z_][A-Za-z0-9_]*\\}$' },
        },
        // Secret refs must not contain a literal value field
        not: { required: ['value'] },
      },
    },
    setup: { type: 'array', items: { $ref: '#/$defs/step' } },
    steps: { type: 'array', items: { $ref: '#/$defs/step' } },
    cleanup: { type: 'array', items: { $ref: '#/$defs/step' } },
    functions: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'actions'],
        properties: {
          id: { type: 'string' },
          parameters: { type: 'array', items: { type: 'string' } },
          actions: { type: 'array', items: { $ref: '#/$defs/action' } },
        },
        additionalProperties: false,
      },
    },
    artifacts: {
      type: 'object',
      required: ['screenshots'],
      properties: {
        screenshots: { enum: ['none', 'failure-only', 'after', 'before-and-after'] },
        traces: { type: 'boolean' },
      },
      additionalProperties: false,
    },
    runner: {
      type: 'object',
      required: ['minBrowsers'],
      properties: {
        minBrowsers: { type: 'array', items: { type: 'string' } },
      },
      additionalProperties: false,
    },
    permissions: {
      type: 'object',
      required: ['networkAccess'],
      properties: {
        networkAccess: { type: 'boolean' },
        fileSystem: { type: 'boolean' },
      },
      additionalProperties: false,
    },
    source: {
      type: 'object',
      required: ['repository', 'path'],
      properties: {
        repository: { type: 'string' },
        path: { type: 'string' },
      },
      additionalProperties: false,
    },
    generatedCode: {
      type: 'object',
      required: ['path'],
      properties: {
        path: { type: 'string' },
      },
      additionalProperties: false,
    },
    customCode: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'path'],
        properties: { id: { type: 'string' }, path: { type: 'string' }, permissions: { type: 'array', items: { type: 'string' } } },
        additionalProperties: false,
      },
    },
  },
  additionalProperties: false,
  $defs: {
    step: {
      type: 'object',
      required: ['id', 'actions'],
      properties: {
        id: { type: 'string' },
        description: { type: 'string' },
        title: { type: 'string' },
        actions: {
          type: 'array',
          items: { $ref: '#/$defs/action' },
        },
        output: {
          type: 'object',
          additionalProperties: { type: 'string' },
        },
      },
      additionalProperties: false,
    },
    action: {
      type: 'object',
      required: ['id', 'type'],
      properties: {
        id: { type: 'string' },
        type: {
          type: 'string',
          enum: SupportedActions,
        },
        name: { type: 'string' },
        url: { type: 'string' },
        selector: { type: 'string' },
        capabilities: {
          type: 'object',
          required: ['platform', 'deviceName'],
          properties: {
            platform: { enum: ['android', 'ios'] },
            deviceName: { type: 'string' },
            udid: { type: 'string' },
            platformVersion: { type: 'string' },
            app: { type: 'string' },
            bundleId: { type: 'string' },
            appPackage: { type: 'string' },
            appActivity: { type: 'string' },
            automationName: { enum: ['UiAutomator2', 'XCUITest'] },
            wdaLocalPort: { type: 'integer', minimum: 1, maximum: 65535 },
            useNewWDA: { type: 'boolean' },
            wdaLaunchTimeout: { type: 'integer', minimum: 1 },
            wdaConnectionTimeout: { type: 'integer', minimum: 1 },
            showXcodeLog: { type: 'boolean' },
            noReset: { type: 'boolean' },
            simulatorDevicesSetPath: { type: 'string', minLength: 1 },
            serverUrl: { type: 'string', pattern: '^https?://[^\\s]+$' },
          },
          additionalProperties: false,
        },
        target: {
          type: 'object',
          properties: { role: { type: 'string' }, name: { type: 'string' }, label: { type: 'string' }, text: { type: 'string' }, testId: { type: 'string' }, css: { type: 'string' } },
          additionalProperties: false,
        },
        value: { type: 'string' },
        expectedText: { type: 'string' },
        method: { type: 'string' },
        headers: { type: 'object' },
        body: {},
        expectedStatus: { anyOf: [{ type: 'integer' }, { type: 'array', items: { type: 'integer' } }] },
        jsonAssertions: { type: 'object' },
        condition: { type: 'string' },
        items: {},
        variable: { type: 'string' },
        maxAttempts: { type: 'integer', minimum: 1, maximum: 1000 },
        backoffMs: { type: 'integer', minimum: 0 },
        timeoutMs: { type: 'integer', minimum: 1 },
        pollMs: { type: 'integer', minimum: 1 },
        actionType: { type: 'string' },
        input: { type: 'object' },
        outputs: { type: 'object', additionalProperties: { type: 'string' } },
        children: { type: 'array', items: { $ref: '#/$defs/action' } },
        elseChildren: { type: 'array', items: { $ref: '#/$defs/action' } },
        branches: { type: 'array', items: { type: 'array', items: { $ref: '#/$defs/action' } } },
        catch: { type: 'array', items: { $ref: '#/$defs/action' } },
        finally: { type: 'array', items: { $ref: '#/$defs/action' } },
        cases: { type: 'object', additionalProperties: { type: 'array', items: { $ref: '#/$defs/action' } } },
        defaultChildren: { type: 'array', items: { $ref: '#/$defs/action' } },
        from: { type: 'integer' },
        to: { type: 'integer' },
        step: { type: 'integer', minimum: 1 },
        functionName: { type: 'string' },
        arguments: { type: 'object' },
        customCodeRef: { type: 'string' },
        assertions: { type: 'array', items: { type: 'object' } },
      },
      additionalProperties: false,
      allOf: [
        {
          if: { properties: { type: { const: 'web.goto' } } },
          then: { required: ['url'] },
        },
        {
          if: { properties: { type: { const: 'web.fill' } } },
          then: { required: ['value'], anyOf: [{ required: ['selector'] }, { required: ['target'] }] },
        },
        {
          if: { properties: { type: { const: 'web.click' } } },
          then: { anyOf: [{ required: ['selector'] }, { required: ['target'] }] },
        },
        {
          if: { properties: { type: { const: 'web.expectVisible' } } },
          then: { anyOf: [{ required: ['selector'] }, { required: ['target'] }] },
        },
        {
          if: { properties: { type: { const: 'web.expectText' } } },
          then: { required: ['expectedText'], anyOf: [{ required: ['selector'] }, { required: ['target'] }] },
        },
        {
          if: { properties: { type: { const: 'api.request' } } },
          then: { required: ['method', 'url'] },
        },
        {
          if: { properties: { type: { const: 'mobile.launch' } } },
          then: { required: ['capabilities'] },
        },
        {
          if: { properties: { type: { enum: ['mobile.tap', 'mobile.expectVisible'] } } },
          then: { required: ['selector'] },
        },
        {
          if: { properties: { type: { const: 'mobile.fill' } } },
          then: { required: ['selector', 'value'] },
        },
        {
          if: { properties: { type: { const: 'mobile.expectText' } } },
          then: { required: ['selector', 'expectedText'] },
        },
        {
          if: { properties: { type: { const: 'control.call' } } },
          then: { required: ['functionName'] },
        },
        {
          if: { properties: { type: { const: 'control.timeout' } } },
          then: { required: ['timeoutMs', 'children'] },
        },
        {
          if: { properties: { type: { const: 'control.if' } } },
          then: { required: ['condition', 'children'] },
        },
        {
          if: { properties: { type: { const: 'control.switch' } } },
          then: { required: ['value', 'cases'] },
        },
        {
          if: { properties: { type: { const: 'control.for' } } },
          then: { required: ['variable', 'from', 'to', 'children'] },
        },
        {
          if: { properties: { type: { const: 'control.forEach' } } },
          then: { required: ['items', 'variable', 'children'] },
        },
        {
          if: { properties: { type: { const: 'control.while' } } },
          then: { required: ['condition', 'maxAttempts', 'children'] },
        },
        {
          if: { properties: { type: { const: 'control.retry' } } },
          then: { required: ['maxAttempts', 'children'] },
        },
        {
          if: { properties: { type: { const: 'control.try' } } },
          then: { required: ['children'] },
        },
        {
          if: { properties: { type: { enum: ['control.parallel', 'control.race'] } } },
          then: { required: ['branches'], properties: { branches: { minItems: 1 } } },
        },
        {
          if: { properties: { type: { const: 'control.waitUntil' } } },
          then: { required: ['condition', 'maxAttempts', 'pollMs', 'children'] },
        },
        {
          if: { properties: { type: { const: 'control.set' } } },
          then: { required: ['variable', 'value'] },
        },
        {
          if: { properties: { type: { const: 'custom.action' } } },
          then: { required: ['actionType'] },
        },
      ],
    },
  },
} as const;

let cachedValidator: ValidateFunction | undefined;

export function createManifestValidator(): (data: unknown) => ValidationResult {
  if (!cachedValidator) {
    const ajv = new Ajv({ allErrors: true, strict: false });
    cachedValidator = ajv.compile(manifestJsonSchema);
  }
  const validate = cachedValidator as ValidateFunction;
  return (data: unknown): ValidationResult => {
    const valid = validate(data);
    if (valid) {
      return { valid: true, errors: null };
    }
    const errs = validate.errors ?? [];
    return {
      valid: false,
      errors: errs.map((e) => ({
        instancePath: e.instancePath,
        keyword: e.keyword,
        message: e.message ?? undefined,
        params: e.params as Record<string, unknown>,
        schemaPath: e.schemaPath,
      })),
    };
  };
}
