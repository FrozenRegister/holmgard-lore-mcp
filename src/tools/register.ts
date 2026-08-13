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

/**
 * Convert a tool's Zod inputSchema to JSON Schema, normalized to match the
 * shape MCP clients (and this repo's own tests, e.g. protocol-basics.test.ts's
 * "every tool inputSchema declares type: object at the root" check) expect.
 *
 * zod-to-json-schema@3.25 serializes both z.discriminatedUnion and a
 * top-level z.union (used by tools with alias-OR actions, e.g. world_manage)
 * as a bare `{ anyOf: [...] }` with no root `type`, whereas this repo's
 * hand-written schemas (and the original design in #545) always used a
 * root `{ type: 'object', oneOf: [...] }`. Every branch of these unions is
 * itself `type: 'object'`, and — because every action branch is keyed on a
 * mutually-exclusive `action` literal — `oneOf` semantics are what's
 * actually intended, not `anyOf`. Rewrite rather than leave the raw output.
 */
export function toJsonSchema(tool: RegisteredTool): Record<string, unknown> {
  const raw = zodToJsonSchema(tool.inputSchema) as Record<string, unknown>
  if (Array.isArray(raw.anyOf)) {
    const { anyOf, ...rest } = raw
    return { type: 'object', oneOf: anyOf, ...rest }
  }
  return raw
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
    inputSchema: toJsonSchema(tool),
  }
}

/** All registered tools, serialized for tools/list, in insertion order. */
export function getAllToolDefinitions(): SerializedToolDefinition[] {
  return _tools.map((t) => getToolDefinition(t.name)!)
}
