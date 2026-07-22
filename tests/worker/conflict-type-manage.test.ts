// Tests for rpg{sub:"conflict_type"} — global conflict-type taxonomy (#316)
import { describe } from './support/helpers'
import { SELF, env } from 'cloudflare:test'
import { expect, it, beforeEach } from 'vitest'
import { setupRpgDb } from './support/setup-d1'

describe('rpg conflict_type sub', () => {
  beforeEach(async () => {
    await setupRpgDb(env.RPG_DB)
  })

  async function callTool(name: string, args: Record<string, unknown>) {
    const res = await SELF.fetch('http://example.com/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': 'test-api-key-xyz' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name, arguments: args },
      }),
    })
    const json = (await res.json()) as Record<string, any>
    const text = json.result?.content?.[0]?.text
    return text ? JSON.parse(text) : json
  }

  // ── list ──────────────────────────────────────────────────────────────────

  it('list returns the seeded physical/social/hybrid types', async () => {
    const r = await callTool('rpg', { sub: 'conflict_type', action: 'list' })
    expect(r.success).toBe(true)
    const names = r.conflictTypes.map((c: { id: string }) => c.id)
    expect(names).toEqual(expect.arrayContaining(['physical', 'social', 'hybrid']))
  })

  it('seeded types have the expected resolver', async () => {
    const r = await callTool('rpg', { sub: 'conflict_type', action: 'list' })
    const physical = r.conflictTypes.find((c: { id: string }) => c.id === 'physical')
    const social = r.conflictTypes.find((c: { id: string }) => c.id === 'social')
    const hybrid = r.conflictTypes.find((c: { id: string }) => c.id === 'hybrid')
    expect(physical.resolver).toBe('combat')
    expect(social.resolver).toBe('drama')
    expect(hybrid.resolver).toBe('both')
  })

  // ── create ────────────────────────────────────────────────────────────────

  it('create adds a new custom conflict type', async () => {
    const r = await callTool('rpg', {
      sub: 'conflict_type',
      action: 'create',
      name: 'Ritual',
      description: 'A ceremonial contest of wills',
      resolver: 'drama',
    })
    expect(r.success).toBe(true)
    expect(r.conflictTypeId).toBe('ritual')

    const list = await callTool('rpg', { sub: 'conflict_type', action: 'list' })
    expect(list.conflictTypes.some((c: { id: string }) => c.id === 'ritual')).toBe(true)
  })

  it('create requires name and resolver', async () => {
    const noName = await callTool('rpg', {
      sub: 'conflict_type',
      action: 'create',
      resolver: 'combat',
    })
    expect(noName.error).toBe(true)
    const noResolver = await callTool('rpg', {
      sub: 'conflict_type',
      action: 'create',
      name: 'Hunt',
    })
    expect(noResolver.error).toBe(true)
  })

  it('create rejects a duplicate name', async () => {
    const r = await callTool('rpg', {
      sub: 'conflict_type',
      action: 'create',
      name: 'Physical',
      resolver: 'combat',
    })
    expect(r.error).toBe(true)
  })

  // ── update ────────────────────────────────────────────────────────────────

  it('update changes description and resolver', async () => {
    const created = await callTool('rpg', {
      sub: 'conflict_type',
      action: 'create',
      name: 'Chase',
      resolver: 'combat',
    })
    const r = await callTool('rpg', {
      sub: 'conflict_type',
      action: 'update',
      id: created.conflictTypeId,
      description: 'A pursuit',
      resolver: 'both',
    })
    expect(r.success).toBe(true)

    const list = await callTool('rpg', { sub: 'conflict_type', action: 'list' })
    const updated = list.conflictTypes.find((c: { id: string }) => c.id === created.conflictTypeId)
    expect(updated.description).toBe('A pursuit')
    expect(updated.resolver).toBe('both')
  })

  it('update rejects a nonexistent id', async () => {
    const r = await callTool('rpg', {
      sub: 'conflict_type',
      action: 'update',
      id: 'nonexistent',
      description: 'x',
    })
    expect(r.error).toBe(true)
  })

  it('update with no fields returns an error', async () => {
    const created = await callTool('rpg', {
      sub: 'conflict_type',
      action: 'create',
      name: 'Empty Update',
      resolver: 'combat',
    })
    const r = await callTool('rpg', {
      sub: 'conflict_type',
      action: 'update',
      id: created.conflictTypeId,
    })
    expect(r.error).toBe(true)
  })

  // ── delete ────────────────────────────────────────────────────────────────

  it('delete removes an unreferenced custom conflict type', async () => {
    const created = await callTool('rpg', {
      sub: 'conflict_type',
      action: 'create',
      name: 'Disposable',
      resolver: 'combat',
    })
    const r = await callTool('rpg', {
      sub: 'conflict_type',
      action: 'delete',
      id: created.conflictTypeId,
    })
    expect(r.success).toBe(true)

    const list = await callTool('rpg', { sub: 'conflict_type', action: 'list' })
    expect(list.conflictTypes.some((c: { id: string }) => c.id === created.conflictTypeId)).toBe(
      false,
    )
  })

  it('delete rejects a nonexistent id', async () => {
    const r = await callTool('rpg', { sub: 'conflict_type', action: 'delete', id: 'nonexistent' })
    expect(r.error).toBe(true)
  })

  it('update requires id', async () => {
    const r = await callTool('rpg', {
      sub: 'conflict_type',
      action: 'update',
      description: 'no id given',
    })
    expect(r.error).toBe(true)
  })

  it('delete requires id', async () => {
    const r = await callTool('rpg', { sub: 'conflict_type', action: 'delete' })
    expect(r.error).toBe(true)
  })

  it('rejects an invalid resolver value (zod validation failure)', async () => {
    const r = await callTool('rpg', {
      sub: 'conflict_type',
      action: 'create',
      name: 'Bad Resolver',
      resolver: 'not-a-real-resolver',
    })
    expect(r.error).toBe(true)
  })

  it('returns a guiding error for an unrecognized action', async () => {
    const r = await callTool('rpg', { sub: 'conflict_type', action: 'totally-not-a-real-action' })
    expect(r.error).toBeTruthy()
    expect(r.suggestions).toBeDefined()
  })

  it('delete rejects a conflict type still referenced by a scene', async () => {
    const now = new Date().toISOString()
    await env.RPG_DB.prepare(
      'INSERT INTO worlds (id, name, seed, width, height, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
      .bind('world:ct-ref', 'World', 'seed', 10, 10, now, now)
      .run()
    const scene = await callTool('rpg', {
      sub: 'scene',
      action: 'create',
      worldId: 'world:ct-ref',
      title: 'Referenced',
      narration: 'Tagged.',
    })
    await callTool('rpg', {
      sub: 'scene',
      action: 'set_conflict_type',
      id: scene.sceneId,
      conflictTypeId: 'physical',
    })

    const r = await callTool('rpg', { sub: 'conflict_type', action: 'delete', id: 'physical' })
    expect(r.error).toBe(true)
    expect(r.message).toContain('referenced')
  })
})
