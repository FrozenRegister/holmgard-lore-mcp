import { cloudflareTest } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.toml' },
      miniflare: {
        // ADMIN_SECRET injected here so it never needs to live in wrangler.toml
        bindings: {
          ADMIN_SECRET: 'test-secret-123',
        },
      },
    }),
  ],
})
