import { defineConfig } from 'vitest/config'
import { existsSync, readFileSync } from 'node:fs'

// Load .env.live when present (gitignored — copy from .env.live.example and fill in key).
// This lets VS Code's Vitest extension pick up MCP_API_KEY without needing a shell env.
if (existsSync('.env.live')) {
  for (const line of readFileSync('.env.live', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.+?)\s*$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '')
  }
}

export default defineConfig({
  test: {
    name: 'live',
    include: ['tests/live/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30000,
    fileParallelism: false, // live tests hit production KV — run files sequentially to avoid rate limits
  },
})
