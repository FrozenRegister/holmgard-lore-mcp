import type { D1Migration } from '@cloudflare/vitest-pool-workers'

declare module 'vitest' {
  interface ProvidedContext {
    d1Migrations: D1Migration[]
  }
}
