import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'runner-protocol',
    include: ['src/**/*.test.ts'],
  },
});
