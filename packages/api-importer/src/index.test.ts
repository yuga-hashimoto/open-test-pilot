import { describe, expect, it } from 'vitest';
import { importOpenApi, importPostmanCollection } from './index.js';

describe('API importers', () => {
  it('imports OpenAPI operations, parameters, JSON body, response schema, local refs, and bearer auth', () => {
    const result = importOpenApi({
      openapi: '3.0.3',
      info: { title: 'Accounts', version: '1.0.0' },
      servers: [{ url: 'https://api.example.test/v1' }],
      components: {
        schemas: { Account: { type: 'object', required: ['id'], properties: { id: { type: 'integer' } } } },
        securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } },
      },
      security: [{ bearerAuth: [] }],
      paths: {
        '/accounts/{accountId}': {
          parameters: [{ name: 'accountId', in: 'path', required: true, example: 'acct-1' }],
          get: {
            operationId: 'getAccount',
            responses: { '200': { content: { 'application/json': { schema: { $ref: '#/components/schemas/Account' } } } } },
          },
        },
        '/accounts': {
          post: {
            operationId: 'createAccount',
            requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/Account' }, example: { id: 1 } } } },
            responses: { '201': { content: { 'application/json': { schema: { $ref: '#/components/schemas/Account' } } } } },
          },
        },
      },
    });
    expect(result.operations).toHaveLength(2);
    expect(result.manifest.steps[0]?.actions[0]).toMatchObject({ type: 'api.request', method: 'GET', url: 'https://api.example.test/v1/accounts/{accountId}', pathParams: { accountId: 'acct-1' }, expectedStatus: 200, allowedHosts: ['api.example.test'] });
    expect(result.manifest.secrets).toEqual([{ name: 'BEARER_AUTH', provider: 'env', reference: '${secret:BEARER_AUTH}' }]);
    expect(result.manifest.steps[0]?.actions[0]?.headers).toMatchObject({ authorization: 'Bearer ${secret:BEARER_AUTH}' });
    expect(result.manifest.steps[0]?.actions[0]?.responseSchema).toMatchObject({ required: ['id'] });
    expect(result.manifest.steps[1]?.actions[0]).toMatchObject({ method: 'POST', body: { id: 1 }, expectedStatus: 201 });
  });

  it('imports Postman Collection v2.1 nested requests, variables, raw JSON, and bearer auth', () => {
    const result = importPostmanCollection({
      info: { name: 'Demo', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
      variable: [{ key: 'baseUrl', value: 'https://api.example.test' }],
      item: [{ name: 'Users', item: [{ name: 'List users', request: { method: 'GET', url: '{{baseUrl}}/users', auth: { type: 'bearer', bearer: [{ key: 'token', value: '{{token}}' }] } } }, { name: 'Create', request: { method: 'POST', url: '{{baseUrl}}/users', body: { mode: 'raw', raw: '{"name":"A"}', options: { raw: { language: 'json' } } } } }] }],
    });
    expect(result.operations).toHaveLength(2);
    expect(result.manifest.steps[0]?.actions[0]).toMatchObject({ method: 'GET', url: 'https://api.example.test/users', headers: { authorization: 'Bearer ${secret:TOKEN}' }, allowedHosts: ['api.example.test'] });
    expect(result.manifest.steps[1]?.actions[0]).toMatchObject({ method: 'POST', body: { name: 'A' }, contentType: 'application/json' });
  });

  it('rejects unsupported OpenAPI versions and unresolved remote refs', () => {
    expect(() => importOpenApi({ swagger: '2.0', info: {}, paths: {} })).toThrow(/OpenAPI 3/i);
    expect(() => importOpenApi({ openapi: '3.0.0', info: {}, paths: { '/x': { get: { responses: { '200': { schema: { $ref: 'https://evil.test/schema.json' } } } } } } })).toThrow(/remote|external|ref/i);
  });
});
