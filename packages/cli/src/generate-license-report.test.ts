import { describe, expect, test } from 'vitest';

interface LicensePackage {
  license: string;
  name: string;
  version: string;
}

type LicenseReportModule = {
  mergeLicensePackages?: (
    currentPackages: LicensePackage[],
    existingPackages: LicensePackage[],
    lockfile: string,
  ) => LicensePackage[];
};

const moduleUrl = new URL('../../../scripts/generate-license-report.mjs', import.meta.url);
const licenseReport = await import(moduleUrl.href) as LicenseReportModule;

describe('mergeLicensePackages', () => {
  test('retains a known package while it remains in the lockfile', () => {
    expect(licenseReport.mergeLicensePackages).toBeTypeOf('function');

    const currentPackages = [
      { license: 'MIT', name: 'wrap-ansi', version: '7.0.0' },
    ];
    const existingPackages = [
      { license: 'MIT', name: 'removed-package', version: '1.0.0' },
      { license: 'MIT', name: 'wrap-ansi', version: '7.0.0' },
      { license: 'MIT', name: 'wrap-ansi', version: '8.1.0' },
    ];
    const lockfile = [
      'packages:',
      '  wrap-ansi@7.0.0:',
      '  wrap-ansi@8.1.0:',
      '',
    ].join('\n');

    expect(licenseReport.mergeLicensePackages?.(currentPackages, existingPackages, lockfile)).toEqual([
      { license: 'MIT', name: 'wrap-ansi', version: '7.0.0' },
      { license: 'MIT', name: 'wrap-ansi', version: '8.1.0' },
    ]);
  });
});
