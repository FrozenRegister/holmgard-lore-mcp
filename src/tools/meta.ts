import { z } from 'zod'
import { randomUUID } from 'crypto'
import { TypedToolContext } from '../types'
import { getKV } from '../lib/kv'
import { makeError, makeResult } from '../lib/rpc'

// ... (schema unchanged except for world_id change shown in diff)
export const appendEventSchema = z.object({
  action: z.literal('append_event'),
  entity_key: z.string().min(1),
  verb: z.string().min(1),
  object: z.string().optional(),
  location: z.string().optional(),
  thread: z.string().optional(),
  detail: z.string().optional(),
  at: z.string().optional(),
  world_id: z.string().min(1),
  entity_id: z.string().optional(),
  date: z.string().optional(),
  description: z.string().optional(),
})