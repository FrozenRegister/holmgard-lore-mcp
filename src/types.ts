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

export type AppBindings = {
  LORE_DB?: KVNamespace
  MCP_API_KEY?: string
  ADMIN_SECRET?: string
}
