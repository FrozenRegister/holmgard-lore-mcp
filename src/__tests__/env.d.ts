// Tells TypeScript about bindings available in tests.
// Generated values come from vitest.config.ts miniflare.bindings + wrangler.jsonc bindings.
declare namespace Cloudflare {
  interface Env {
    LORE_DB: KVNamespace
    ADMIN_SECRET: string
    MCP_API_KEY: string
    MCP_OBJECT: DurableObjectNamespace
  }
}
