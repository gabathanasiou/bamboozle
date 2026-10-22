import { defineConfig } from 'vitest/config';

// Pure-logic unit tests (the bottom of the pyramid — docs/TESTING.md).
// Node environment, no DOM. Run: `npm run test:unit`.
export default defineConfig({
  test: {
    include: [
      'src/**/*.test.ts',
      'app/**/*.test.ts',
      'lib/**/*.test.ts',
      'services/**/*.test.ts',
      'server/**/*.test.ts',
      'workers/**/*.test.ts',
      'i18n/**/*.test.ts',
    ],
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'text'],
    },
  },
});
