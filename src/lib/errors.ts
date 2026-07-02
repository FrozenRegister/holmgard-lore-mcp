// src/lib/errors.ts
// Shared helpers for producing agent-actionable validation errors.
import type { z } from 'zod'
import { makeError } from './rpc'
import type { JsonRpcResponse } from '../types'

// Turns a Zod validation failure into a JSON-RPC error whose top-level `message`
// already states which field(s) are wrong and why (Zod's own issue messages spell out
// enum/type expectations), instead of forcing the caller to dig through `error.format()`.
// Pass `example` to also echo back a minimal valid payload for the action being attempted.
// Always points the caller at `load_tool_schema` for the full per-action schema — this
// matters even for clients (e.g. Cline) that validate arguments against the tool's
// JSON Schema before sending: a genuine server-side Zod failure means the payload passed
// that check but is still wrong in a way only the full schema/description would explain
// (e.g. a value outside an enum, or a nested constraint the top-level schema doesn't spell out).
export function invalidParamsError(
  id: string | number | null,
  toolName: string,
  error: z.ZodError,
  example?: Record<string, unknown>
): JsonRpcResponse {
  const issues = error.issues.map(i => `${i.path.join('.')}: ${i.message}`)
  const schemaHint = `load_tool_schema({ toolName: "${toolName}" })`
  const message = `Invalid params — ${issues.join('; ')}. For the full parameter schema, call ${schemaHint}.`
  const data: Record<string, unknown> = { issues: error.format(), schema_hint: schemaHint }
  if (example) data.example = example
  return makeError(id, -32602, message, data)
}
