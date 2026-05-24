// Tells TypeScript about the KV namespace and secret binding available in tests.
// Generated values come from vitest.config.ts miniflare.bindings + wrangler.toml kv_namespaces.
declare namespace Cloudflare {
  interface Env {
    LORE_DB: KVNamespace
    ADMIN_SECRET: string
  }
}
