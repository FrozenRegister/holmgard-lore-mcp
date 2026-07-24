/**
 * Tests for claims system - cross-tick resource locking and conflict resolution
 *
 * Implements #444 (Cross-tick claims + conflict resolution)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as characterManage from '@/rpg/handlers/character-manage'

import {
  getClaim,
  setClaim,
  clearClaim,
  isStaleClaim,
  resolveTickConflicts,
  type Priority,
  type FlaggedEvent,
} from '@/rpg/utils/claims'
import type { AppBindings } from '@/types'

// Mock the character-manage module
vi.mock('@/rpg/handlers/character-manage', () => ({
  getCharacter: vi.fn(),
  updateCharacter: vi.fn(),
}))

// Mock environment and database
const mockEnv: AppBindings = {
  LORE_DB: {} as KVNamespace,
  RPG_DB: {} as D1Database,
  MCP_API_KEY: 'test-key',
  ADMIN_SECRET: 'test-secret',
}

const mockDb = {
  prepare: vi.fn(),
  dump: vi.fn(),
  batch: vi.fn(),
  exec: vi.fn(),
} as unknown as D1Database

// Mock character data
const testCharacter = {
  id: 'char-1',
  name: 'Test Character',
  stats: '{}',
  hp: 10,
  max_hp: 10,
  ac: 10,
  level: 1,
  character_type: 'npc',
  claimed_by: null as string | null,
  claimed_until: null as string | null,
  claimed_at: null as string | null,
}

const testCharacter2 = {
  id: 'char-2',
  name: 'Test Character 2',
  stats: '{}',
  hp: 10,
  max_hp: 10,
  ac: 10,
  level: 1,
  character_type: 'npc',
  claimed_by: null as string | null,
  claimed_until: null as string | null,
  claimed_at: null as string | null,
}

beforeEach(() => {
  // Reset mocks before each test
  vi.resetAllMocks()

  // Mock getCharacter to return test data
  vi.spyOn(characterManage, 'getCharacter').mockImplementation(async (env, db, key) => {
    if (key === 'char-1') return testCharacter
    if (key === 'char-2') return testCharacter2
    return null
  })

  // Mock updateCharacter
  vi.spyOn(characterManage, 'updateCharacter').mockImplementation(async (env, db, key, updates) => {
    if (key === 'char-1') {
      Object.assign(testCharacter, updates)
      return testCharacter
    }
    if (key === 'char-2') {
      Object.assign(testCharacter2, updates)
      return testCharacter2
    }
    throw new Error(`Character not found: ${key}`)
  })

  // Fake conditional UPDATE for setClaim's atomic claim write (bypasses
  // updateCharacter so the WHERE guard can be tested) — mutates the same
  // testCharacter/testCharacter2 fixtures the rest of the suite asserts on,
  // succeeding only when the guard ("no active claim") actually holds.
  vi.mocked(mockDb.prepare).mockImplementation(
    (sql: string) =>
      ({
        bind: (...args: unknown[]) => ({
          run: async () => {
            if (!sql.includes('UPDATE characters SET claimed_by')) {
              return { success: true, meta: { changes: 0 } }
            }
            const [claimedBy, claimedUntil, claimedAt, , charId, guardTick] = args as [
              string,
              string,
              string,
              string,
              string,
              string,
            ]
            const target =
              charId === 'char-1' ? testCharacter : charId === 'char-2' ? testCharacter2 : null
            if (!target) return { success: true, meta: { changes: 0 } }
            const guardPasses =
              !target.claimed_by ||
              (target.claimed_until !== null &&
                new Date(target.claimed_until) <= new Date(guardTick))
            if (!guardPasses) return { success: true, meta: { changes: 0 } }
            target.claimed_by = claimedBy
            target.claimed_until = claimedUntil
            target.claimed_at = claimedAt
            return { success: true, meta: { changes: 1 } }
          },
        }),
      }) as unknown as ReturnType<D1Database['prepare']>,
  )
})

afterEach(() => {
  // Reset test character data
  testCharacter.claimed_by = null
  testCharacter.claimed_until = null
  testCharacter.claimed_at = null

  testCharacter2.claimed_by = null
  testCharacter2.claimed_until = null
  testCharacter2.claimed_at = null
})

describe('Claims System', () => {
  describe('getClaim', () => {
    it('should return null values for unclaimed character', async () => {
      const result = await getClaim(mockEnv, mockDb, 'char-1')
      expect(result).toEqual({
        claimedBy: null,
        claimedUntil: null,
        claimedAt: null,
      })
    })

    it('should return claim information for claimed character', async () => {
      // Set up a claim
      testCharacter.claimed_by = 'creature:shaper-alpha'
      testCharacter.claimed_until = '2187-01-15T00:00:00Z'
      testCharacter.claimed_at = '2187-01-10T00:00:00Z'

      const result = await getClaim(mockEnv, mockDb, 'char-1')
      expect(result).toEqual({
        claimedBy: 'creature:shaper-alpha',
        claimedUntil: '2187-01-15T00:00:00Z',
        claimedAt: '2187-01-10T00:00:00Z',
      })
    })

    it('should throw error for non-existent character', async () => {
      await expect(getClaim(mockEnv, mockDb, 'non-existent')).rejects.toThrow(
        'Character not found: non-existent',
      )
    })
  })

  describe('setClaim', () => {
    it('should set a claim successfully', async () => {
      const result = await setClaim(
        mockEnv,
        mockDb,
        'char-1',
        'creature:shaper-alpha',
        '2187-01-15T00:00:00Z',
        '2187-01-10T00:00:00Z',
      )

      expect(result.success).toBe(true)
      expect(testCharacter.claimed_by).toBe('creature:shaper-alpha')
      expect(testCharacter.claimed_until).toBe('2187-01-15T00:00:00Z')
      expect(testCharacter.claimed_at).toBe('2187-01-10T00:00:00Z')
    })

    it('should reject empty claimer key', async () => {
      await expect(
        setClaim(mockEnv, mockDb, 'char-1', '', '2187-01-15T00:00:00Z', '2187-01-10T00:00:00Z'),
      ).rejects.toThrow('Claimed_by cannot be empty')
    })

    it('should reject self-claiming by default', async () => {
      await expect(
        setClaim(
          mockEnv,
          mockDb,
          'char-1',
          'char-1',
          '2187-01-15T00:00:00Z',
          '2187-01-10T00:00:00Z',
        ),
      ).rejects.toThrow('Self-claiming is not allowed')
    })

    it('should allow self-claiming when configured', async () => {
      const result = await setClaim(
        mockEnv,
        mockDb,
        'char-1',
        'char-1',
        '2187-01-15T00:00:00Z',
        '2187-01-10T00:00:00Z',
        true,
      )

      expect(result.success).toBe(true)
      expect(testCharacter.claimed_by).toBe('char-1')
    })

    it('should detect and reject active claim collisions', async () => {
      // Set up an existing claim
      testCharacter.claimed_by = 'creature:shaper-beta'
      testCharacter.claimed_until = '2187-01-20T00:00:00Z'

      const result = await setClaim(
        mockEnv,
        mockDb,
        'char-1',
        'creature:shaper-alpha',
        '2187-01-15T00:00:00Z',
        '2187-01-10T00:00:00Z',
      )

      expect(result.success).toBe(false)
      expect(result.conflict).toEqual({
        claimerKey: 'creature:shaper-beta',
        claimedUntil: '2187-01-20T00:00:00Z',
      })
      // Original claim should remain unchanged
      expect(testCharacter.claimed_by).toBe('creature:shaper-beta')
    })

    it('should allow claim when existing claim is expired', async () => {
      // Set up an expired claim
      testCharacter.claimed_by = 'creature:shaper-beta'
      testCharacter.claimed_until = '2187-01-05T00:00:00Z' // Expired

      const result = await setClaim(
        mockEnv,
        mockDb,
        'char-1',
        'creature:shaper-alpha',
        '2187-01-15T00:00:00Z',
        '2187-01-10T00:00:00Z',
      )

      expect(result.success).toBe(true)
      expect(testCharacter.claimed_by).toBe('creature:shaper-alpha')
    })

    it('reports a conflict when the atomic write loses the race', async () => {
      // Simulate a race: the initial read (and its fast-path check) sees the
      // character as unclaimed, but by the time the guarded UPDATE actually
      // runs, another concurrent setClaim call has already won — the WHERE
      // guard fails to match despite the pre-check passing, so meta.changes
      // comes back 0 even though the statement itself succeeded.
      vi.mocked(mockDb.prepare).mockImplementationOnce(
        () =>
          ({
            bind: () => ({
              run: async () => ({ success: true, meta: { changes: 0 } }),
            }),
          }) as unknown as ReturnType<D1Database['prepare']>,
      )

      vi.spyOn(characterManage, 'getCharacter')
        .mockImplementationOnce(async () => ({
          ...testCharacter,
          claimed_by: null,
          claimed_until: null,
        }))
        .mockImplementationOnce(async () => ({
          ...testCharacter,
          claimed_by: 'creature:shaper-winner',
          claimed_until: '2187-01-20T00:00:00Z',
        }))

      const result = await setClaim(
        mockEnv,
        mockDb,
        'char-1',
        'creature:shaper-alpha',
        '2187-01-15T00:00:00Z',
        '2187-01-10T00:00:00Z',
      )

      expect(result.success).toBe(false)
      expect(result.conflict).toEqual({
        claimerKey: 'creature:shaper-winner',
        claimedUntil: '2187-01-20T00:00:00Z',
      })
    })
  })

  describe('clearClaim', () => {
    it('should clear a claim', async () => {
      // Set up a claim
      testCharacter.claimed_by = 'creature:shaper-alpha'
      testCharacter.claimed_until = '2187-01-15T00:00:00Z'
      testCharacter.claimed_at = '2187-01-10T00:00:00Z'

      await clearClaim(mockEnv, mockDb, 'char-1')

      expect(testCharacter.claimed_by).toBeNull()
      expect(testCharacter.claimed_until).toBeNull()
      expect(testCharacter.claimed_at).toBeNull()
    })
  })

  describe('isStaleClaim', () => {
    it('should return true for null claimedUntil', () => {
      expect(isStaleClaim(null, '2187-01-10T00:00:00Z')).toBe(true)
    })

    it('should return true for expired claim', () => {
      expect(isStaleClaim('2187-01-05T00:00:00Z', '2187-01-10T00:00:00Z')).toBe(true)
    })

    it('should return false for active claim', () => {
      expect(isStaleClaim('2187-01-15T00:00:00Z', '2187-01-10T00:00:00Z')).toBe(false)
    })
  })

  describe('resolveTickConflicts', () => {
    const currentTickTime = '2187-01-10T00:00:00Z'

    const createTestEvent = (
      id: string,
      priority: Priority,
      targetKey: string,
      sourceEntityKey: string,
      resourceLocks: string[],
    ): FlaggedEvent => ({
      id,
      eventType: 'test_event',
      priority,
      targetKey,
      sourceEntityKey,
      payload: {},
      resourceLocks,
    })

    it('should resolve single event without conflicts', async () => {
      const events = [
        createTestEvent('event-1', 'HIGH', 'char-1', 'creature:shaper-alpha', ['char-1']),
      ]

      const results = await resolveTickConflicts(events, currentTickTime, mockEnv, mockDb)

      expect(results).toHaveLength(1)
      expect(results[0].status).toBe('resolved')
      expect(results[0].event.id).toBe('event-1')
    })

    it('should resolve multiple events targeting different resources', async () => {
      const events = [
        createTestEvent('event-1', 'HIGH', 'char-1', 'creature:shaper-alpha', ['char-1']),
        createTestEvent('event-2', 'MEDIUM', 'char-2', 'creature:shaper-beta', ['char-2']),
      ]

      const results = await resolveTickConflicts(events, currentTickTime, mockEnv, mockDb)

      expect(results).toHaveLength(2)
      expect(results.every((r) => r.status === 'resolved')).toBe(true)
    })

    it('should resolve conflicts by priority (CRITICAL > HIGH > MEDIUM > LOW)', async () => {
      const events = [
        createTestEvent('event-1', 'MEDIUM', 'char-1', 'creature:shaper-alpha', ['char-1']),
        createTestEvent('event-2', 'HIGH', 'char-1', 'creature:shaper-beta', ['char-1']),
        createTestEvent('event-3', 'CRITICAL', 'char-1', 'creature:shaper-gamma', ['char-1']),
      ]

      const results = await resolveTickConflicts(events, currentTickTime, mockEnv, mockDb)

      expect(results).toHaveLength(3)

      // CRITICAL should resolve
      const criticalResult = results.find((r) => r.event.id === 'event-3')
      expect(criticalResult?.status).toBe('resolved')

      // HIGH should be deferred
      const highResult = results.find((r) => r.event.id === 'event-2')
      expect(highResult?.status).toBe('deferred')

      // MEDIUM should be deferred
      const mediumResult = results.find((r) => r.event.id === 'event-1')
      expect(mediumResult?.status).toBe('deferred')
    })

    it('should resolve conflicts by FIFO when priorities are equal', async () => {
      const events = [
        createTestEvent('event-1', 'HIGH', 'char-1', 'creature:shaper-alpha', ['char-1']),
        createTestEvent('event-2', 'HIGH', 'char-1', 'creature:shaper-beta', ['char-1']),
      ]

      const results = await resolveTickConflicts(events, currentTickTime, mockEnv, mockDb)

      expect(results).toHaveLength(2)

      // First event should resolve
      const firstResult = results.find((r) => r.event.id === 'event-1')
      expect(firstResult?.status).toBe('resolved')

      // Second event should be deferred
      const secondResult = results.find((r) => r.event.id === 'event-2')
      expect(secondResult?.status).toBe('deferred')
    })

    it('should handle active claims (locked by me vs locked by others)', async () => {
      // Set up an active claim
      testCharacter.claimed_by = 'creature:shaper-alpha'
      testCharacter.claimed_until = '2187-01-15T00:00:00Z'
      testCharacter.claimed_at = '2187-01-10T00:00:00Z'

      const events = [
        // Event from the claimer (locked by me)
        createTestEvent('event-1', 'HIGH', 'char-1', 'creature:shaper-alpha', ['char-1']),
        // Event from another entity (locked by others)
        createTestEvent('event-2', 'HIGH', 'char-1', 'creature:shaper-beta', ['char-1']),
      ]

      const results = await resolveTickConflicts(events, currentTickTime, mockEnv, mockDb)

      expect(results).toHaveLength(2)

      // Event from claimer should resolve
      const claimerResult = results.find((r) => r.event.id === 'event-1')
      expect(claimerResult?.status).toBe('resolved')

      // Event from other should be modified
      const otherResult = results.find((r) => r.event.id === 'event-2')
      expect(otherResult?.status).toBe('modified')
      if (otherResult?.status === 'modified') {
        expect(otherResult.modification.narrativeContext).toContain(
          'already claimed by creature:shaper-alpha',
        )
      }
    })

    it('should handle stale claims as unclaimed', async () => {
      // Set up an expired claim
      testCharacter.claimed_by = 'creature:shaper-alpha'
      testCharacter.claimed_until = '2187-01-05T00:00:00Z' // Expired
      testCharacter.claimed_at = '2187-01-01T00:00:00Z'

      const events = [
        createTestEvent('event-1', 'HIGH', 'char-1', 'creature:shaper-beta', ['char-1']),
        createTestEvent('event-2', 'MEDIUM', 'char-1', 'creature:shaper-gamma', ['char-1']),
      ]

      const results = await resolveTickConflicts(events, currentTickTime, mockEnv, mockDb)

      expect(results).toHaveLength(2)

      // HIGH priority should resolve
      const highResult = results.find((r) => r.event.id === 'event-1')
      expect(highResult?.status).toBe('resolved')

      // MEDIUM priority should be deferred
      const mediumResult = results.find((r) => r.event.id === 'event-2')
      expect(mediumResult?.status).toBe('deferred')
    })

    it('should handle events with multiple resource locks', async () => {
      const events = [
        createTestEvent('event-1', 'HIGH', 'char-1', 'creature:shaper-alpha', ['char-1', 'char-2']),
        createTestEvent('event-2', 'MEDIUM', 'char-2', 'creature:shaper-beta', ['char-2']),
      ]

      const results = await resolveTickConflicts(events, currentTickTime, mockEnv, mockDb)

      // Should have 3 results: event-1 creates 2 entries (one for each resource lock), event-2 creates 1
      expect(results).toHaveLength(3)

      // Event-1 should resolve for both resource locks (char-1 and char-2)
      const event1Results = results.filter((r) => r.event.id === 'event-1')
      expect(event1Results).toHaveLength(2)
      expect(event1Results.every((r) => r.status === 'resolved')).toBe(true)

      // Event-2 should be deferred because it conflicts with event-1 on char-2 and has lower priority
      const event2Results = results.filter((r) => r.event.id === 'event-2')
      expect(event2Results).toHaveLength(1)
      expect(event2Results[0].status).toBe('deferred')
    })
  })

  // clearDeadPredatorClaims (#445 Phase 3) does real D1 reads/writes, so its
  // tests live in the real-D1 suite (tests/worker/rpg/creature-tick.test.ts)
  // rather than this mock-based file.

  // ── Coverage: setClaim throws for non-existent character (line 97) ───────────

  it('should throw error for non-existent character in setClaim', async () => {
    await expect(
      setClaim(
        mockEnv,
        mockDb,
        'char:nonexistent',
        'creature:shaper-alpha',
        '2187-01-15T00:00:00Z',
        '2187-01-10T00:00:00Z',
      ),
    ).rejects.toThrow('Character not found: char:nonexistent')
  })

  // ── Coverage: highest-priority event conflicts with active claim from different entity (lines 222-234) ──

  it('should modify highest-priority event when active claim belongs to different entity', async () => {
    testCharacter.claimed_by = 'creature:shaper-beta'
    testCharacter.claimed_until = '2187-01-20T00:00:00Z'
    testCharacter.claimed_at = '2187-01-10T00:00:00Z'

    const currentTickTime = '2187-01-10T00:00:00Z'

    const events: FlaggedEvent[] = [
      {
        id: 'event-solo',
        eventType: 'hunt',
        priority: 'CRITICAL' as Priority,
        targetKey: 'char-1',
        sourceEntityKey: 'creature:shaper-alpha',
        payload: {},
        resourceLocks: ['char-1'],
      },
    ]

    const results = await resolveTickConflicts(events, currentTickTime, mockEnv, mockDb)

    expect(results).toHaveLength(1)
    expect(results[0].status).toBe('modified')
    if (results[0].status === 'modified') {
      expect(results[0].modification.narrativeContext).toContain(
        'already claimed by creature:shaper-beta',
      )
      expect(results[0].modification.conflictWith.claimerKey).toBe('creature:shaper-beta')
      expect(results[0].modification.conflictWith.claimedUntil).toBe('2187-01-20T00:00:00Z')
    }
  })

  // ── Coverage: lower-priority event conflicts with active claim → modified (lines 242-256) ──

  it('should modify lower-priority events when active claim exists', async () => {
    testCharacter.claimed_by = 'creature:shaper-alpha'
    testCharacter.claimed_until = '2187-01-20T00:00:00Z'
    testCharacter.claimed_at = '2187-01-10T00:00:00Z'

    const currentTickTime = '2187-01-10T00:00:00Z'

    const events: FlaggedEvent[] = [
      {
        id: 'event-winner',
        eventType: 'tenderize',
        priority: 'CRITICAL' as Priority,
        targetKey: 'char-1',
        sourceEntityKey: 'creature:shaper-alpha',
        payload: {},
        resourceLocks: ['char-1'],
      },
      {
        id: 'event-loser',
        eventType: 'hunt',
        priority: 'LOW' as Priority,
        targetKey: 'char-1',
        sourceEntityKey: 'party:adventurers',
        payload: {},
        resourceLocks: ['char-1'],
      },
    ]

    const results = await resolveTickConflicts(events, currentTickTime, mockEnv, mockDb)

    expect(results).toHaveLength(2)

    const winner = results.find((r) => r.event.id === 'event-winner')
    expect(winner?.status).toBe('resolved')

    const loser = results.find((r) => r.event.id === 'event-loser')
    expect(loser?.status).toBe('modified')
    if (loser?.status === 'modified') {
      expect(loser.modification.narrativeContext).toContain(
        'already claimed by creature:shaper-alpha',
      )
    }
  })

  // ── Coverage: lower-priority event deferred when no active claim (lines 257-263) ──

  it('should defer lower-priority events when no active claim exists', async () => {
    testCharacter.claimed_by = null
    testCharacter.claimed_until = null

    const currentTickTime = '2187-01-10T00:00:00Z'

    const events: FlaggedEvent[] = [
      {
        id: 'event-high',
        eventType: 'tenderize',
        priority: 'CRITICAL' as Priority,
        targetKey: 'char-1',
        sourceEntityKey: 'creature:shaper-alpha',
        payload: {},
        resourceLocks: ['char-1'],
      },
      {
        id: 'event-low',
        eventType: 'hunt',
        priority: 'LOW' as Priority,
        targetKey: 'char-1',
        sourceEntityKey: 'party:adventurers',
        payload: {},
        resourceLocks: ['char-1'],
      },
    ]

    const results = await resolveTickConflicts(events, currentTickTime, mockEnv, mockDb)

    expect(results).toHaveLength(2)

    const highResult = results.find((r) => r.event.id === 'event-high')
    expect(highResult?.status).toBe('resolved')

    const lowResult = results.find((r) => r.event.id === 'event-low')
    expect(lowResult?.status).toBe('deferred')
    if (lowResult?.status === 'deferred') {
      expect(lowResult.retryAt).toBe(currentTickTime)
    }
  })
})
