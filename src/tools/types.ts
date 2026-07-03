// src/tools/types.ts
import type { Context } from 'hono'
import type { AppBindings } from '../types'
import type { RequestIdVariables } from '../middleware/request-id'

export interface ToolContext {
  c: Context<{ Bindings: AppBindings; Variables: RequestIdVariables }>
  id: string | number | null
  args: Record<string, unknown>
  isAuthenticated: boolean
}

export type ToolHandler = (ctx: ToolContext) => Promise<Response>
