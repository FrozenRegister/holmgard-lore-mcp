import { defineConfig } from 'vitest/config'
import path from 'node:path'

// Fast tier for genuinely pure functions — no miniflare/Workers runtime boot.
// The rest of the suite (vitest.config.ts) drives the worker end-to-end via
// SELF.fetch and is the source of truth for tool behavior; this tier exists
// so pure logic (string/scoring helpers) gets sub-second feedback instead of
// waiting on a miniflare isolate. See docs/testing-and-linting-guide.md.
export default defineConfig({
  test: {
    name: 'unit',
    include: ['tests/unit/**/*.test.ts'],
    testTimeout: 5000,
    coverage: {
      provider: 'istanbul',
      reporter: ['json'],
      include: ['src/**/*.ts'],
      exclude: ['node_modules/**', 'src/**/migrate-*.ts'],
      reportsDirectory: './coverage-unit',
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
