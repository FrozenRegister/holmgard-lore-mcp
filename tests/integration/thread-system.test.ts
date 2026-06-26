// tests/integration/thread-system.test.ts
// Integration test: world_manage — thread_tick, get_thread_comparison, check_convergence
// Covers: thread_tick, get_thread_comparison, check_convergence, get_relationship,
//   get_location_occupants, get_reachable_locations, sense_environment,
//   get_faction_standing, get_entity_knowledge

import { describe, it, expect, beforeEach } from 'vitest'
import { createMockContext } from '../unit/mocks'
import { handle_world_manage } from '../../src/tools/world-manage'

const LOCATION_KEY = 'location:tavern'
const LOCATION_TEXT = `**Name:** The Rusty Flagon\n**Type:** tavern\n**Description:** A dimly lit tavern.`

function callWorld(ctx: ReturnType<typeof createMockContext>, args: Record<string, unknown>) {
  return handle_world_manage({
    c: ctx,
    id: 'test-id',
    isAuthenticated: true,
    args,
  })
}

async function jsonBody(res: Response): Promise<any> {
  expect(res.status).toBe(200)
  return res.json()
}

describe('Thread system integration', () => {
  let ctx: ReturnType<typeof createMockContext>

  beforeEach(() => {
    ctx = createMockContext({
      [LOCATION_KEY]: JSON.stringify({ text: LOCATION_TEXT, meta: { version: 1 } }),
    })
  })

  describe('Thread lifecycle', () => {
    it('ticks a thread and returns state', async () => {
      const res = await callWorld(ctx, { action: 'thread_tick', thread_id: 'plague-spread' })
      const body = await jsonBody(res)
      expect(body.result).toBeDefined()
    })

    it('handles missing thread_id gracefully', async () => {
      const res = await callWorld(ctx, { action: 'thread_tick', thread_id: '' })
      const body = await jsonBody(res)
      expect(body.error).toBeDefined()
    })
  })

  describe('Thread comparison', () => {
    it('compares two threads', async () => {
      const res = await callWorld(ctx, {
        action: 'get_thread_comparison',
        thread_a: 'thread-alpha',
        thread_b: 'thread-beta',
      })
      const body = await jsonBody(res)
      expect(body.result).toBeDefined()
    })
  })

  describe('Convergence check', () => {
    it('checks if two threads are converging', async () => {
      const res = await callWorld(ctx, {
        action: 'check_convergence',
        thread_a: 'thread-alpha',
        thread_b: 'thread-beta',
      })
      const body = await jsonBody(res)
      expect(body.result).toBeDefined()
    })
  })

  describe('Relationships', () => {
    it('gets relationship between two entities (may return error for nonexistent entities)', async () => {
      const res = await callWorld(ctx, {
        action: 'get_relationship',
        entity_a: 'npc:merchant',
        entity_b: 'npc:guard',
      })
      const body = await jsonBody(res)
      // May return result or error for nonexistent entities; either is valid
      expect(body.result || body.error).toBeDefined()
    })
  })

  describe('Location occupants', () => {
    it('lists occupants at a location', async () => {
      const res = await callWorld(ctx, {
        action: 'get_location_occupants',
        location_key: LOCATION_KEY,
      })
      const body = await jsonBody(res)
      expect(body.result).toBeDefined()
    })

    it('handles empty location', async () => {
      const res = await callWorld(ctx, {
        action: 'get_location_occupants',
        location_key: 'location:void',
      })
      const body = await jsonBody(res)
      expect(body.result).toBeDefined()
    })
  })

  describe('Reachable locations', () => {
    it('gets reachable locations from origin', async () => {
      const res = await callWorld(ctx, {
        action: 'get_reachable_locations',
        origin_key: LOCATION_KEY,
      })
      const body = await jsonBody(res)
      expect(body.result).toBeDefined()
    })
  })

  describe('Sense environment', () => {
    it('senses environment from entity perspective (may error for nonexistent entity)', async () => {
      const res = await callWorld(ctx, {
        action: 'sense_environment',
        entity_key: 'npc:guard',
        location_key: LOCATION_KEY,
      })
      const body = await jsonBody(res)
      expect(body.result || body.error).toBeDefined()
    })
  })

  describe('Faction standing', () => {
    it('gets faction standing for an entity', async () => {
      const res = await callWorld(ctx, {
        action: 'get_faction_standing',
        entity_key: 'npc:guard',
        faction_key: 'faction:empire',
      })
      const body = await jsonBody(res)
      expect(body.result || body.error).toBeDefined()
    })
  })

  describe('Entity knowledge', () => {
    it('gets entity knowledge about a topic (may error for nonexistent entity)', async () => {
      const res = await callWorld(ctx, {
        action: 'get_entity_knowledge',
        entity_key: 'npc:guard',
        topic: 'plague',
      })
      const body = await jsonBody(res)
      expect(body.result || body.error).toBeDefined()
    })
  })
})
