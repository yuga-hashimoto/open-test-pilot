import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'manifest-schema',
    include: ['src/**/*.test.ts'],
  },
});
