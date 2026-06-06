import { cloudflareTest } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        // ADMIN_SECRET injected here so it never needs to live in wrangler.toml
        bindings: {
          ADMIN_SECRET: process.env.ADMIN_SECRET || 'test-secret-123',
          MCP_API_KEY: process.env.MCP_API_KEY || 'test-api-key-xyz',
        },
      },
    }),
  ],
})
