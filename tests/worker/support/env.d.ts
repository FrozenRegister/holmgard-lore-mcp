// Tells TypeScript about bindings available in tests.
// Generated values come from vitest.config.ts miniflare.bindings + wrangler.jsonc bindings.

// Vite ?raw imports return file contents as a string
declare module '*.sql?raw' {
  const content: string
  export default content
}

declare namespace Cloudflare {
  interface Env {
    LORE_DB: KVNamespace
    RPG_DB: D1Database
    ADMIN_SECRET: string
    MCP_API_KEY: string
    MCP_OBJECT: DurableObjectNamespace
    AI: Ai
  }
}
