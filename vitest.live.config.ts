import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'live',
    include: ['tests/live/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30000,
    fileParallelism: false, // live tests hit production KV — run files sequentially to avoid rate limits
  },
})
