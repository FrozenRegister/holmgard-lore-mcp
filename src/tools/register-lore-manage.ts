// src/tools/register-lore-manage.ts
// Registration of lore_manage tool via the Phase 1 registerTool() infrastructure (#545).

import { z } from 'zod'
import { registerTool, type RegisteredTool } from './register'
import { handle_lore_manage } from './lore-manage'

export const InputSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('get'),
      query: z.string().min(1),
    })
    .strict(),
  z
    .object({
      action: z.literal('get_batch'),
      keys: z.array(z.string().min(1)).min(1),
    })
    .strict(),
  z
    .object({
      action: z.literal('get_section'),
      key: z.string().min(1),
      sections: z.array(z.string().min(1)),
      mode: z.enum(['strict', 'loose']).optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal('list'),
      prefix: z.string().min(1).optional(),
      limit: z.number().min(1).max(1000).optional(),
      offset: z.number().min(0).optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal('list_maps'),
      limit: z.number().min(1).max(1000).optional(),
      offset: z.number().min(0).optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal('get_map'),
      map_id: z.string().min(1),
    })
    .strict(),
  z
    .object({
      action: z.literal('search'),
      query: z.string().min(1),
      match_mode: z.enum(['any', 'all', 'exact']).optional(),
      prefix: z.string().min(1).optional(),
      max_results: z.number().min(1).max(50).optional(),
      scan_limit: z.number().int().min(1).max(2000).optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal('validate'),
      query_string: z.string().min(1),
    })
    .strict(),
  z
    .object({
      action: z.literal('set'),
      key: z.string().min(1),
      text: z.string().min(1),
      dry_run: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal('delete'),
      key: z.string().min(1),
      dry_run: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal('patch'),
      key: z.string().min(1),
      operation: z.enum(['replace', 'append', 'delete_field']),
      target: z.string().optional(),
      value: z.string().optional(),
      dry_run: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal('batch_set'),
      entries: z
        .array(
          z
            .object({
              key: z.string().min(1),
              text: z.string().min(1),
            })
            .strict(),
        )
        .min(1),
    })
    .strict(),
  z
    .object({
      action: z.literal('batch_mutate'),
      mutations: z
        .array(
          z
            .object({
              key: z.string().min(1),
              action: z.enum(['increment', 'patch']),
              field_path: z.string().optional(),
              increment: z.number().optional(),
              reason: z.string().optional(),
              operation: z.enum(['replace', 'append', 'delete_field']).optional(),
              target: z.string().optional(),
              value: z.string().optional(),
            })
            .strict(),
        )
        .min(1),
    })
    .strict(),
  z
    .object({
      action: z.literal('restore'),
      key: z.string().min(1),
    })
    .strict(),
  z
    .object({
      action: z.literal('history'),
      keys: z.array(z.string().min(1)).min(1),
    })
    .strict(),
  z
    .object({
      action: z.literal('increment'),
      key: z.string().min(1),
      field_path: z.string().min(1),
      increment: z.number().optional(),
      reason: z.string().optional(),
      dry_run: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal('append_section'),
      key: z.string().min(1),
      section: z.string().min(1),
      text: z.string().min(1),
      position: z.enum(['end', 'start']).optional(),
      auto_create: z.boolean().optional(),
    })
    .strict(),
])

export function registerLoreManageTool(): void {
  const tool: RegisteredTool = {
    name: 'lore_manage',
    title: 'Lore Manage',
    version: '1.0.0',
    description:
      'KV lore store — read, write, search, and mutate lore entries. Actions: get, get_batch, get_section, list, list_maps, get_map, search, validate, set, delete, patch, batch_set, batch_mutate, restore, history, increment, append_section. IMPORTANT: Always call validate before get_lore when the key is ambiguous, user-supplied, or AI-generated. The validate action returns did_you_mean with a confidence score — use this to resolve uncertain keys before reading. get_lore also auto-suggests alternatives in its error response when a key is not found. set, delete, patch, and increment accept an optional dry_run: true to preview the before/after diff without writing.',
    category: 'lore',
    inputSchema: InputSchema,
    handler: handle_lore_manage,
  }
  registerTool(tool)
}
