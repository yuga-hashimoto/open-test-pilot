import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'result-schema',
    include: ['src/**/*.test.ts'],
  },
});
