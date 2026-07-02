// src/lib/errors.ts
// Shared helpers for producing agent-actionable validation errors.
import type { z } from 'zod'
import { makeError } from './rpc'
import type { JsonRpcResponse } from '../types'

// Turns a Zod validation failure into a JSON-RPC error whose top-level `message`
// already states which field(s) are wrong and why (Zod's own issue messages spell out
// enum/type expectations), instead of forcing the caller to dig through `error.format()`.
// Pass `example` to also echo back a minimal valid payload for the action being attempted.
export function invalidParamsError(
  id: string | number | null,
  error: z.ZodError,
  example?: Record<string, unknown>
): JsonRpcResponse {
  const issues = error.issues.map(i => `${i.path.join('.')}: ${i.message}`)
  const message = `Invalid params — ${issues.join('; ')}`
  const data: Record<string, unknown> = { issues: error.format() }
  if (example) data.example = example
  return makeError(id, -32602, message, data)
}
