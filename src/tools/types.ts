// src/tools/types.ts
import type { Context } from 'hono'
import type { z } from 'zod'
import type { AppBindings } from '../types'
import type { RequestIdVariables } from '../middleware/request-id'
import { makeError } from '../lib/rpc'
import { invalidParamsError } from '../lib/errors'

export type HonoCtx = Context<{ Bindings: AppBindings; Variables: RequestIdVariables }>

export interface ToolContext {
  c: HonoCtx
  id: string | number | null
  args: Record<string, unknown>
  isAuthenticated: boolean
}

export type ToolHandler = (ctx: ToolContext) => Promise<Response>

// --- Typed action-handler pattern (see issue #22 / #237) ---
//
// ACTION_MAP dispatchers (e.g. scene-manage.ts) previously handed every handler
// the same untyped `Record<string, unknown>` and left each handler responsible for
// its own `schema.safeParse(args)` boilerplate — with no compile-time link between
// an action's declared schema and what its handler actually reads off `args`.
//
// `makeActionDispatcher` centralizes that parse at the dispatch boundary: it looks
// up the matched action's `ActionSpec`, parses once, and only calls the handler with
// already-validated, fully-typed args (`z.infer<S>`). A handler can no longer be out
// of sync with its own schema — the compiler enforces it via `TypedToolHandler<S>`.

export interface TypedToolContext<S extends z.ZodTypeAny> {
  c: HonoCtx
  id: string | number | null
  args: z.infer<S>
  isAuthenticated: boolean
}

export type TypedToolHandler<S extends z.ZodTypeAny> = (
  ctx: TypedToolContext<S>,
) => Promise<Response>

export interface ActionSpec<S extends z.ZodTypeAny = z.ZodTypeAny> {
  schema: S
  handler: TypedToolHandler<S>
  /** Echoed back in the error payload as a minimal valid example when validation fails. */
  example?: Record<string, unknown>
}

/**
 * Pairs a schema with its handler into an `ActionSpec` for storage in a
 * heterogeneous `ACTION_MAP`. TypeScript can't express "a map where each
 * value's handler type depends on that same value's own schema type"
 * without an existential type, so this is the single sanctioned point
 * where that pairing is erased to `ActionSpec<z.ZodTypeAny>` for storage.
 * The erasure is safe by construction: `makeActionDispatcher` only ever
 * calls `spec.handler` with the output of that same `spec.schema.safeParse`,
 * so a pair's specific `S` never gets crossed with another pair's data.
 * `schema` and `handler` are still checked against each other here, before
 * the erasure happens — swapping them for a mismatched pair is a type error.
 */
export function defineAction<S extends z.ZodTypeAny>(
  schema: S,
  handler: TypedToolHandler<S>,
  example?: Record<string, unknown>,
): ActionSpec {
  return { schema, handler, example } as unknown as ActionSpec
}

/**
 * Builds a `ToolHandler` that dispatches on `args.action` to one of `actionMap`'s
 * handlers. Map values may be either a typed `ActionSpec` — parsed once against its
 * own schema before the handler ever sees `args` — or a legacy raw `ToolHandler`
 * that still parses `args` itself. The mixed form lets an ACTION_MAP migrate to the
 * typed pattern one action at a time instead of requiring a whole file to convert
 * atomically (e.g. lore-manage.ts pairs a converted system.ts read-side with a
 * not-yet-converted lore.ts write-side).
 */
export function makeActionDispatcher(
  toolName: string,
  actionMap: Record<string, ActionSpec | ToolHandler>,
): ToolHandler {
  return ({ c, id, args, isAuthenticated }) => {
    const { action, ...rest } = args
    if (!action || typeof action !== 'string')
      return Promise.resolve(c.json(makeError(id, -32602, 'Missing required param: action'), 200))

    const entry = actionMap[action]
    if (!entry)
      return Promise.resolve(c.json(makeError(id, -32602, `Unknown action "${action}"`), 200))

    if (typeof entry === 'function') return entry({ c, id, args: rest, isAuthenticated })

    const parsed = entry.schema.safeParse(rest)
    if (!parsed.success) {
      const example = entry.example ? { action, ...entry.example } : undefined
      return Promise.resolve(c.json(invalidParamsError(id, toolName, parsed.error, example), 200))
    }

    return entry.handler({ c, id, args: parsed.data, isAuthenticated })
  }
}
