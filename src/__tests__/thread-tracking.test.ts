// Thread tracking: append_event + plant_setup populate thread indexes,
// check_convergence finds intersections via KV fallback path.

import { describe, it, expect } from 'vitest'
import { createMockContext } from '../unit/mocks'
import { handle_append_event, handle_plant_setup } from '../../src/tools/meta'
import { handle_check_convergence } from '../../src/tools/world'

function callTool(handler: Function, args: Record<string, unknown>) {
  const ctx = createMockContext()
  return handler({ c: ctx, id: 'test-id', isAuthenticated: true, args })
}

async function jsonBody(res: Response): Promise<any> {
  expect(res.status).toBe(200)
  return res.json()
}

describe('Thread tracking', () => {
  describe('append_event with thread', () => {
    it('writes thread field into event metadata', async () => {
      const res = await callTool(handle_append_event, {
        action: 'append_event',
        entity_key: 'character:test',
        verb: 'moved',
        object: 'to the north corridor',
        location: 'north-corridor',
        thread: 'investigation-thread',
        detail: 'Subject proceeded northward',
      })
      const body = await jsonBody(res)
      expect(body.result).toBeDefined()
      expect(body.result.metadata).toBeDefined()
      expect(body.result.metadata.thread).toBe('investigation-thread')
    })

    it('works without thread (backward compatible)', async () => {
      const res = await callTool(handle_append_event, {
        action: 'append_event',
        entity_key: 'character:test',
        verb: 'rested',
        object: 'at camp',
        location: 'base-camp',
        detail: 'Subject rested for the night',
      })
      const body = await jsonBody(res)
      expect(body.result).toBeDefined()
    })
  })

  describe('plant_setup with thread', () => {
    it('writes thread field into setup lore text', async () => {
      const res = await callTool(handle_plant_setup, {
        action: 'plant_setup',
        id: 'setup-test-001',
        description: 'The investigation reveals a hidden connection',
        planted_in: 'scene:interrogation-room',
        tension: 3,
        expected_in: 'chapter:7',
        actors: ['character:detective', 'character:suspect'],
        thread: 'investigation-thread',
      })
      const body = await jsonBody(res)
      expect(body.result).toBeDefined()
      expect(body.result.metadata).toBeDefined()
      expect(body.result.metadata.thread).toBe('investigation-thread')
    })

    it('works without thread (backward compatible)', async () => {
      const res = await callTool(handle_plant_setup, {
        action: 'plant_setup',
        id: 'setup-test-002',
        description: 'A loose thread in the narrative',
        planted_in: 'scene:marketplace',
        tension: 2,
        expected_in: 'chapter:12',
        actors: ['character:merchant'],
      })
      const body = await jsonBody(res)
      expect(body.result).toBeDefined()
    })
  })

  describe('check_convergence (KV path, no world_id)', () => {
    it('returns result structure without error', async () => {
      const res = await callTool(handle_check_convergence, {
        action: 'check_convergence',
        thread_a: 'thread-alpha',
        thread_b: 'thread-beta',
      })
      const body = await jsonBody(res)
      expect(body.result).toBeDefined()
      expect(body.result.can_converge).toBeDefined()
      expect(typeof body.result.can_converge).toBe('boolean')
      expect(body.result.thread_a).toBe('thread-alpha')
      expect(body.result.thread_b).toBe('thread-beta')
    })

    it('reports no convergence for empty threads', async () => {
      const res = await callTool(handle_check_convergence, {
        action: 'check_convergence',
        thread_a: 'nonexistent-thread-a',
        thread_b: 'nonexistent-thread-b',
      })
      const body = await jsonBody(res)
      expect(body.result.can_converge).toBe(false)
      expect(body.result.shared_dates).toEqual([])
      expect(body.result.shared_locations).toEqual([])
    })
  })
})
