// src/types.ts

export type JsonRpcRequest = {
  jsonrpc?: string
  id?: string | number | null
  method?: string
  params?: any
}

export type JsonRpcResponse = {
  jsonrpc: '2.0'
  id: string | number | null
  result?: any
  error?: { code: number; message: string; data?: any }
}

export interface LoreEntry {
  text: string;
  meta?: unknown;
}

export type AppBindings = {
  LORE_DB?: KVNamespace
  RPG_DB?: D1Database
  MCP_API_KEY?: string
  ADMIN_SECRET?: string
  MCP_OBJECT?: DurableObjectNamespace
  AI?: Ai
}

// Satisfies the McpAgent<Env extends Cloudflare.Env> constraint — required bindings
// only, matching what the DO actually receives at runtime (all bindings are present).
export type DOEnv = {
  LORE_DB: KVNamespace
  RPG_DB: D1Database
  ADMIN_SECRET: string
  MCP_API_KEY: string
  MCP_OBJECT: DurableObjectNamespace
  AI: Ai
}
