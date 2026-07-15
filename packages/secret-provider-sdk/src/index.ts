export interface SecretProvider {
  get(name: string): Promise<string | undefined>;
}

export class EnvironmentSecretProvider implements SecretProvider {
  public async get(name: string): Promise<string | undefined> {
    return process.env[name];
  }
}

export function redact(text: string, secrets: readonly string[]): string {
  return secrets.filter((secret) => secret.length > 0).reduce((current, secret) => current.replaceAll(secret, '[REDACTED]'), text);
}
