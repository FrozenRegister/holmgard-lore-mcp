// src/tools/register.ts
// Core tool registration infrastructure (Phase 1 of #540).
// Additive only — existing toolRegistry/toolDefinitions remain unchanged.

import type { ToolHandler } from './types'
import type { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'

export interface RegisteredTool {
  name: string
  title: string
  version: string
  description: string
  category?: string // 'lore' | 'rpg' — unused today, cheap to add now
  inputSchema: z.ZodTypeAny // Zod schema — NOT hand-written JSON Schema
  handler: ToolHandler // same signature as ToolHandler in src/tools/types.ts
}

/** Shape produced for tools/list serialization (see Phase 2+). */
export interface SerializedToolDefinition {
  name: string
  title: string
  version: string
  description: string
  inputSchema: Record<string, unknown>
}

const _tools: RegisteredTool[] = []

/** Register a tool. Throws on duplicate name — drift guard at import time. */
export function registerTool(tool: RegisteredTool): void {
  if (_tools.some((t) => t.name === tool.name)) {
    throw new Error(`Tool "${tool.name}" is already registered`)
  }
  _tools.push(tool)
}

/** All registered tools, in insertion order. */
export function getTools(): RegisteredTool[] {
  return _tools
}

/** Look up a handler by tool name. */
export function getToolHandler(name: string): ToolHandler | undefined {
  return _tools.find((t) => t.name === name)?.handler
}

/** Serialize a tool definition for tools/list (Zod → JSON Schema). */
export function getToolDefinition(name: string): SerializedToolDefinition | undefined {
  const tool = _tools.find((t) => t.name === name)
  if (!tool) return undefined
  return {
    name: tool.name,
    title: tool.title,
    version: tool.version,
    description: tool.description,
    inputSchema: zodToJsonSchema(tool.inputSchema) as Record<string, unknown>,
  }
}

/** Convert a tool's Zod inputSchema to JSON Schema. */
export function toJsonSchema(tool: RegisteredTool): Record<string, unknown> {
  return zodToJsonSchema(tool.inputSchema) as Record<string, unknown>
}
