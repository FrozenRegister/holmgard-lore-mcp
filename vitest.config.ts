import { cloudflareTest } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'workers',
    testTimeout: 30000, // 30s global timeout for slow miniflare tests
    exclude: ['tests/live/**', '**/node_modules/**'],
    globalSetup: ['./vitest.global-setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['lcov', 'text'],
      include: ['src/**/*.ts'],
      exclude: ['src/__tests__/**', 'node_modules/**'],
      reportsDirectory: './coverage',
    },
  },
  plugins: [
    cloudflareTest({
      // wrangler.test.jsonc is identical to wrangler.jsonc except it omits the
      // "ai" block. When wrangler reads an AI binding from config, it tries to start
      // a remote proxy session (requires Cloudflare auth) even in miniflare mode.
      // Omitting it from the wrangler config and providing 'ai' via miniflare options
      // below uses miniflare's built-in local AI mock instead, which works without auth.
      wrangler: { configPath: './wrangler.test.jsonc' },
      miniflare: {
        // ADMIN_SECRET injected here so it never needs to live in wrangler.toml
        bindings: {
          ADMIN_SECRET: process.env.ADMIN_SECRET || 'test-secret-123',
          MCP_API_KEY: process.env.MCP_API_KEY || 'test-api-key-xyz',
        },
        // Local AI mock — returns { response: "AI response mock" } for run() calls.
        ai: { binding: 'AI' },
      },
    }),
  ],
})
