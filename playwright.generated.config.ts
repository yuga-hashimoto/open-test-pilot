import { defineConfig } from '@playwright/test';

/** Opt-in config for executing generated artifacts under .testpilot/runs. */
export default defineConfig({
  testDir: '.testpilot/runs',
  testMatch: '**/*.spec.ts',
  reporter: 'line',
});
