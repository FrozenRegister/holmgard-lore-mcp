// src/lib/coerce-transport-args.ts
// See #505: the Shapes MCP bridge JSON.stringify()s every non-string tool-call
// argument before it reaches this Worker, so booleans, numbers, arrays, and
// objects all arrive as their stringified text (`true` -> `"true"`,
// `[{q:0,r:0}]` -> `"[{\"q\":0,\"r\":0}]"`). Every zod schema in
// src/tools/**/*.ts and src/rpg/handlers/**/*.ts expects the real type, so
// these calls fail validation before reaching any handler logic.
//
// This undoes the stringification at the transport boundary: any string that
// round-trips through JSON.parse() into a boolean, number, array, or object is
// replaced with the parsed value. Ordinary text (the vast majority of args —
// keys, actions, prose) is never valid JSON on its own and passes through
// unchanged.
export function coerceTransportArgs<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => coerceTransportArgs(item)) as unknown as T
  }
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      result[key] = coerceTransportArgs(val)
    }
    return result as T
  }
  if (typeof value === 'string') {
    return coerceStringValue(value) as unknown as T
  }
  return value
}

const JSON_NUMBER = /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/

function coerceStringValue(value: string): unknown {
  const trimmed = value.trim()
  if (trimmed === '') return value

  const looksLikeJson =
    trimmed === 'true' ||
    trimmed === 'false' ||
    trimmed === 'null' ||
    JSON_NUMBER.test(trimmed) ||
    (trimmed[0] === '[' && trimmed[trimmed.length - 1] === ']') ||
    (trimmed[0] === '{' && trimmed[trimmed.length - 1] === '}')
  if (!looksLikeJson) return value

  try {
    const parsed: unknown = JSON.parse(trimmed)
    // Recurse in case of double-stringification (a stringified array whose
    // own elements are themselves stringified numbers/booleans).
    return coerceTransportArgs(parsed)
  } catch {
    return value
  }
}
