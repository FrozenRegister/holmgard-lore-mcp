// src/tools/types.ts
import type { Context } from 'hono'
import type { AppBindings } from '../types'
import type { RequestIdVariables } from '../middleware/request-id'
import { z } from 'zod'
import { makeError } from '../lib/rpc'
import { invalidParamsError } from '../lib/errors'
import { applyAliases } from '../lib/aliases'

export interface ToolContext {
  c: Context<{ Bindings: AppBindings; Variables: RequestIdVariables }>
  id: string | number | null
  args: Record<string, unknown>
  isAuthenticated: boolean
}

export type ToolHandler = (ctx: ToolContext) => Promise<Response>

export type TypedToolContext<T extends z.ZodSchema> = {
  c: Context<{ Bindings: AppBindings; Variables: RequestIdVariables }>
  id: string | number | null
  args: z.infer<T>
  isAuthenticated: boolean
}

export interface ActionSpec {
  schema: z.ZodSchema
  handler: (ctx: ToolContext) => Promise<Response>
  example: Record<string, unknown>
  aliases?: Record<string, string>
}

export function defineAction<S extends z.ZodSchema>(
  schema: S,
  handler: (ctx: TypedToolContext<S>) => Promise<Response>,
  example: Record<string, unknown>,
  aliases?: Record<string, string>
): ActionSpec {
  return { schema, handler: handler as (ctx: ToolContext) => Promise<Response>, example, aliases }
}

export function makeActionDispatcher(toolName: string, actions: Record<string, ActionSpec | ToolHandler>): ToolHandler {
  return async (ctx: ToolContext) => {
    const { action, ...rest } = ctx.args
    if (!action || typeof action !== 'string') {
      return ctx.c.json(makeError(ctx.id, -32602, 'Missing required param: action'), 200)
    }
    const spec = actions[action]
    if (!spec) {
      return ctx.c.json(makeError(ctx.id, -32602, `Unknown action "${action}"`), 200)
    }

    // Check if it's an ActionSpec (typed) or legacy ToolHandler
    if ('schema' in spec) {
      const actionSpec = spec as ActionSpec
      // Apply aliases if provided
      const normalized = actionSpec.aliases ? applyAliases(rest, actionSpec.aliases) : rest
      const parsed = actionSpec.schema.safeParse(normalized)
      if (!parsed.success) {
        return ctx.c.json(invalidParamsError(ctx.id, toolName, parsed.error, { action, ...actionSpec.example }), 200)
      }
      return actionSpec.handler({ ...ctx, args: parsed.data })
    } else {
      // Legacy ToolHandler
      return (spec as ToolHandler)({ ...ctx, args: rest })
    }
  }
}

