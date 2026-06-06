// src/tools/types.ts
import type { Context } from 'hono'
import type { AppBindings } from '../types'

export interface ToolContext {
  c: Context<{ Bindings: AppBindings }>
  id: string | number | null
  args: Record<string, any>
  isAuthenticated: boolean
}

export type ToolHandler = (ctx: ToolContext) => Promise<Response>
