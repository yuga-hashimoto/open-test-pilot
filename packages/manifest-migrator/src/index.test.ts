import { describe, expect, it } from 'vitest';
import { diffManifests, migrateManifest, previewMigration } from './index.js';

describe('Manifest migrator', () => {
  it('previews a legacy manifest without mutating the source', () => {
    const legacy = { schemaVersion: '0.9.0', testId: 'legacy-login', title: 'Legacy login', type: 'web', steps: [] };
    const preview = previewMigration(legacy);
    expect(legacy).toEqual({ schemaVersion: '0.9.0', testId: 'legacy-login', title: 'Legacy login', type: 'web', steps: [] });
    expect(preview.changed).toBe(true);
    expect(preview.manifest.schemaVersion).toBe('1.0.0');
    expect(preview.manifest.id).toBe('legacy-login');
    expect(preview.yamlDiff).toContain('+schemaVersion: 1.0.0');
  });

  it('requires explicit approval to apply a migration', () => {
    const legacy = { schemaVersion: '0.9.0', id: 'legacy', name: 'Legacy', type: 'web', steps: [] };
    expect(() => migrateManifest(legacy, { approve: false })).toThrow(/explicit approval/);
    expect(migrateManifest(legacy, { approve: true }).schemaVersion).toBe('1.0.0');
  });

  it('produces a stable manifest diff', () => {
    const diff = diffManifests({ schemaVersion: '1.0.0', id: 'test', name: 'Before' }, { schemaVersion: '1.0.0', id: 'test', name: 'After' });
    expect(diff).toContain('-name: Before');
    expect(diff).toContain('+name: After');
  });
});
