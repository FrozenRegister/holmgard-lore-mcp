// src/lib/rpc.ts
import type { JsonRpcRequest, JsonRpcResponse } from '../types'

export const makeResult = (id: string | number | null, result: unknown): JsonRpcResponse => ({
  jsonrpc: '2.0',
  id,
  result,
})

export const makeError = (
  id: string | number | null,
  code: number,
  message: string,
  data?: any,
): JsonRpcResponse => ({
  jsonrpc: '2.0',
  id,
  error: { code, message, data },
})

export const validateRequest = (
  body: any,
): { ok: true; req: JsonRpcRequest } | { ok: false; error: JsonRpcResponse } => {
  if (body === null || body === undefined)
    return { ok: false, error: makeError(null, -32600, 'Invalid Request: empty body') }
  if (Array.isArray(body))
    return { ok: false, error: makeError(null, -32600, 'Batch requests are not supported') }
  const req = body as JsonRpcRequest
  if (req.jsonrpc !== '2.0')
    return {
      ok: false,
      error: makeError(req.id ?? null, -32600, 'Invalid Request: jsonrpc must be "2.0"'),
    }
  if (!req.method || typeof req.method !== 'string')
    return {
      ok: false,
      error: makeError(req.id ?? null, -32600, 'Invalid Request: method missing or not a string'),
    }
  return { ok: true, req }
}
