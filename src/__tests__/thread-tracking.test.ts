import { describe, rpc, callTool, seedKV, ADMIN_SECRET } from './helpers'
import { SELF, env } from 'cloudflare:test'
import { expect, it, beforeEach } from 'vitest'

describe('Thread tracking', () => {
  describe('append_event with thread', () => {
    it('writes thread field into event metadata', async () => {
      const res = await callTool('continuity_manage', {
        action: 'append_event',
        entity_key: 'character:test',
        verb: 'moved',
        object: 'to the north corridor',
        location: 'north-corridor',
        thread: 'investigation-thread',
        detail: 'Subject proceeded northward',
      })
      expect(res.error).toBeUndefined()
      expect(res.result.metadata).toBeDefined()
      expect(res.result.metadata.thread).toBe('investigation-thread')
    })

    it('works without thread (backward compatible)', async () => {
      const res = await callTool('continuity_manage', {
        action: 'append_event',
        entity_key: 'character:test',
        verb: 'rested',
        object: 'at camp',
        location: 'base-camp',
        detail: 'Subject rested for the night',
      })
      expect(res.error).toBeUndefined()
    })
  })

  describe('plant_setup with thread', () => {
    it('writes thread field into setup lore text', async () => {
      const res = await callTool('continuity_manage', {
        action: 'plant_setup',
        id: 'setup-test-001',
        description: 'The investigation reveals a hidden connection',
        planted_in: 'scene:interrogation-room',
        tension: 3,
        expected_in: 'chapter:7',
        actors: ['character:detective', 'character:suspect'],
        thread: 'investigation-thread',
      })
      expect(res.error).toBeUndefined()
      expect(res.result.metadata).toBeDefined()
      expect(res.result.metadata.thread).toBe('investigation-thread')
    })

    it('works without thread (backward compatible)', async () => {
      const res = await callTool('continuity_manage', {
        action: 'plant_setup',
        id: 'setup-test-002',
        description: 'A loose thread in the narrative',
        planted_in: 'scene:marketplace',
        tension: 2,
        expected_in: 'chapter:12',
        actors: ['character:merchant'],
      })
      expect(res.error).toBeUndefined()
    })
  })

  describe('check_convergence (KV path, no world_id)', () => {
    it('returns result structure without error', async () => {
      const res = await callTool('world_manage', {
        action: 'check_convergence',
        thread_a: 'thread-alpha',
        thread_b: 'thread-beta',
      })
      expect(res.error).toBeUndefined()
      expect(res.result.can_converge).toBeDefined()
      expect(typeof res.result.can_converge).toBe('boolean')
      expect(res.result.thread_a).toBe('thread-alpha')
      expect(res.result.thread_b).toBe('thread-beta')
    })

    it('reports no convergence for empty threads', async () => {
      const res = await callTool('world_manage', {
        action: 'check_convergence',
        thread_a: 'nonexistent-thread-a',
        thread_b: 'nonexistent-thread-b',
      })
      expect(res.result.can_converge).toBe(false)
      expect(res.result.shared_dates).toEqual([])
      expect(res.result.shared_locations).toEqual([])
    })
  })
})
