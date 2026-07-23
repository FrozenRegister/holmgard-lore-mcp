// Tests for the D1-backed world-level tick lock (#512) — replaces the old
// in-memory WORLD_LOCKS Map, which provided zero cross-isolate protection for
// callers using the "legacy hand-rolled JSON-RPC" /mcp path (every test in
// this repo, and plausibly most real callers) rather than the Streamable
// HTTP transport routed through the HolmgardMCP Durable Object.
import { describe } from '../support/helpers'
import { env } from 'cloudflare:test'
import { expect, it, beforeEach } from 'vitest'
import { setupRpgDb } from '../support/setup-d1'
import {
  acquireWorldLock,
  releaseWorldLock,
  runTickDriver,
  HOOK_REGISTRY,
  type HookResult,
} from '@/rpg/handlers/tick-hooks'

describe('World lock (#512)', () => {
  beforeEach(async () => {
    await setupRpgDb(env.RPG_DB)
    const now = new Date().toISOString()
    await env.RPG_DB.prepare(
      `INSERT OR IGNORE INTO worlds (id, name, seed, width, height, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind('lock-world', 'lock-world', 'seed', 10, 10, now, now)
      .run()
    await env.RPG_DB.prepare(
      `INSERT OR REPLACE INTO world_state (world_id, current_date) VALUES (?, ?)`,
    )
      .bind('lock-world', '2187-01-10')
      .run()
  })

  it('acquires a lock for an unlocked world', async () => {
    const acquired = await acquireWorldLock(env.RPG_DB, 'lock-world', 'holder-1')
    expect(acquired).toBe(true)
  })

  it('rejects a second acquisition while the first lock is still active', async () => {
    const first = await acquireWorldLock(env.RPG_DB, 'lock-world', 'holder-1')
    const second = await acquireWorldLock(env.RPG_DB, 'lock-world', 'holder-2')

    expect(first).toBe(true)
    expect(second).toBe(false)
  })

  it('allows acquisition again after the lock is released', async () => {
    await acquireWorldLock(env.RPG_DB, 'lock-world', 'holder-1')
    await releaseWorldLock(env.RPG_DB, 'lock-world')

    const reacquired = await acquireWorldLock(env.RPG_DB, 'lock-world', 'holder-2')
    expect(reacquired).toBe(true)
  })

  it('does not release a lock acquired by a different holder', async () => {
    // Guards against a slow caller's own finally-block release clobbering a
    // different caller's lock that was legitimately acquired in between
    // (e.g. after the first caller's own TTL expired).
    await acquireWorldLock(env.RPG_DB, 'lock-world', 'holder-1')
    await releaseWorldLock(env.RPG_DB, 'lock-world', 'someone-else')

    const stillHeld = await acquireWorldLock(env.RPG_DB, 'lock-world', 'holder-2')
    expect(stillHeld).toBe(false)
  })

  it('releases a lock when the correct holder is given', async () => {
    await acquireWorldLock(env.RPG_DB, 'lock-world', 'holder-1')
    await releaseWorldLock(env.RPG_DB, 'lock-world', 'holder-1')

    const reacquired = await acquireWorldLock(env.RPG_DB, 'lock-world', 'holder-2')
    expect(reacquired).toBe(true)
  })

  it('allows acquisition again once the previous lock has expired', async () => {
    await env.RPG_DB.prepare(
      `INSERT INTO world_locks (world_id, holder_id, expires_at) VALUES (?, ?, ?)`,
    )
      .bind('lock-world', 'stale-holder', '2000-01-01T00:00:00.000Z')
      .run()

    const acquired = await acquireWorldLock(env.RPG_DB, 'lock-world', 'holder-2')
    expect(acquired).toBe(true)
  })

  it('locks are independent per world', async () => {
    const now = new Date().toISOString()
    await env.RPG_DB.prepare(
      `INSERT OR IGNORE INTO worlds (id, name, seed, width, height, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind('lock-world-2', 'lock-world-2', 'seed', 10, 10, now, now)
      .run()

    const first = await acquireWorldLock(env.RPG_DB, 'lock-world', 'holder-1')
    const other = await acquireWorldLock(env.RPG_DB, 'lock-world-2', 'holder-2')

    expect(first).toBe(true)
    expect(other).toBe(true)
  })

  it('runTickDriver rejects dry_run combined with a mutating hook, without executing it', async () => {
    const executeSpy = { called: false }
    const mutatingHook = {
      name: 'mutating_test_hook',
      config: { enabled: true, batch_mode: false, mutates: true },
      dependsOn: [],
      batchMode: false,
      execute: async (): Promise<HookResult> => {
        executeSpy.called = true
        return { category: 'resolved' as const, data: {}, narrator_summary: 'should not run' }
      },
    }
    HOOK_REGISTRY.set('mutating_test_hook', mutatingHook)

    try {
      const result = await runTickDriver(
        { RPG_DB: env.RPG_DB } as any,
        env.RPG_DB,
        'lock-world',
        '2187-01-10',
        '2187-01-11',
        { hooks: ['mutating_test_hook'], dry_run: true },
      )

      expect(result.success).toBe(false)
      expect(result.narrator_summary).toContain('dry_run is not supported')
      expect(result.narrator_summary).toContain('mutating_test_hook')
      expect(executeSpy.called).toBe(false)
    } finally {
      HOOK_REGISTRY.delete('mutating_test_hook')
    }
  })

  it('runTickDriver allows dry_run for non-mutating hooks', async () => {
    const result = await runTickDriver(
      { RPG_DB: env.RPG_DB } as any,
      env.RPG_DB,
      'lock-world',
      '2187-01-10',
      '2187-01-11',
      { hooks: ['weather_update'], dry_run: true },
    )

    expect(result.success).toBe(true)
  })

  it('preserves earlier hooks’ resolved results when a later hook throws, and logs a timeline_events audit entry', async () => {
    const throwingHook = {
      name: 'throwing_after_resolved_hook',
      config: { enabled: true, batch_mode: false },
      dependsOn: ['weather_update'],
      batchMode: false,
      execute: async (): Promise<HookResult> => {
        throw new Error('boom')
      },
    }
    HOOK_REGISTRY.set('throwing_after_resolved_hook', throwingHook)

    try {
      const result = await runTickDriver(
        { RPG_DB: env.RPG_DB } as any,
        env.RPG_DB,
        'lock-world',
        '2187-01-10',
        '2187-01-11',
        { hooks: ['weather_update', 'throwing_after_resolved_hook'] },
      )

      expect(result.success).toBe(false)
      // weather_update ran successfully before the throw — its result must
      // survive in the response, not be wiped to an empty array.
      expect(result.resolved).toHaveLength(1)
      expect(result.resolved[0].data).toMatchObject({ action: 'weather_update' })
      expect(result.hook_failures).toEqual([
        { hook: 'throwing_after_resolved_hook', error: 'boom' },
      ])
      // narrator_summary keeps weather_update's summary too, not just the
      // failure — same "don't discard what already happened" reasoning as
      // resolved/flagged above.
      expect(result.narrator_summary).toContain('Weather system placeholder.')
      expect(result.narrator_summary).toContain('Hook throwing_after_resolved_hook failed: boom')

      const auditRow = await env.RPG_DB.prepare(
        `SELECT * FROM timeline_events WHERE world_id = ? AND verb = ? ORDER BY created_at DESC LIMIT 1`,
      )
        .bind('lock-world', 'tick_hook_failure')
        .first<{ detail: string; object_entity: string }>()

      expect(auditRow).toBeTruthy()
      expect(auditRow?.detail).toBe('boom')
      expect(auditRow?.object_entity).toBe('throwing_after_resolved_hook')
    } finally {
      HOOK_REGISTRY.delete('throwing_after_resolved_hook')
    }
  })
})
