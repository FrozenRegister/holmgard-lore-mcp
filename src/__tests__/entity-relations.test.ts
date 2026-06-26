// src/__tests__/entity-relations.test.ts
// Tests for GET /api/entities/:type/:id/relations and
//   POST/PATCH/DELETE /admin/relations
import { describe, ADMIN_SECRET } from './helpers'
import { SELF, env } from 'cloudflare:test'
import { expect, it, beforeEach } from 'vitest'
import { setupRpgDb } from './setup-d1'

// ── Helpers ───────────────────────────────────────────────────────────────────

async function adminFetch(
  method: string,
  path: string,
  body: Record<string, unknown>,
  secret = ADMIN_SECRET,
) {
  return SELF.fetch(`http://example.com${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Admin-Secret': secret,
    },
    body: JSON.stringify(body),
  })
}

async function createRelation(overrides: Record<string, unknown> = {}) {
  return adminFetch('POST', '/admin/relations', {
    from_type: 'characters',
    from_id: 'char-001',
    to_type: 'nations',
    to_id: 'nation-001',
    relation_type: 'ally',
    attitude: 75,
    ...overrides,
  })
}

async function getRelations(type: string, id: string) {
  return SELF.fetch(`http://example.com/api/entities/${type}/${id}/relations`)
}

// ── GET /api/entities/:type/:id/relations ────────────────────────────────────

describe('GET /api/entities/:type/:id/relations', () => {
  beforeEach(async () => {
    await setupRpgDb(env.RPG_DB)
  })

  it('returns empty array when no relations exist', async () => {
    const res = await getRelations('characters', 'char-nobody')
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, any>
    expect(body.relations).toEqual([])
    expect(body.total).toBe(0)
  })

  it('returns relations where entity is the from side', async () => {
    await createRelation({ from_id: 'char-001', to_id: 'nation-001', relation_type: 'serves' })
    const res = await getRelations('characters', 'char-001')
    const body = await res.json() as Record<string, any>
    expect(body.total).toBe(1)
    expect(body.relations[0].from_id).toBe('char-001')
    expect(body.relations[0].relation_type).toBe('serves')
  })

  it('returns relations where entity is the to side (bidirectional merge)', async () => {
    await createRelation({ from_id: 'char-002', to_type: 'characters', to_id: 'char-001', relation_type: 'friend' })
    const res = await getRelations('characters', 'char-001')
    const body = await res.json() as Record<string, any>
    expect(body.total).toBe(1)
    expect(body.relations[0].from_id).toBe('char-002')
    expect(body.relations[0].to_id).toBe('char-001')
  })

  it('merges from and to relations together', async () => {
    await createRelation({ from_id: 'char-001', to_type: 'nations', to_id: 'nation-001', relation_type: 'serves' })
    await createRelation({ from_type: 'quests', from_id: 'quest-001', to_type: 'characters', to_id: 'char-001', relation_type: 'involves' })
    const res = await getRelations('characters', 'char-001')
    const body = await res.json() as Record<string, any>
    expect(body.total).toBe(2)
  })

  it('pinned relations appear first regardless of insert order', async () => {
    await createRelation({ from_id: 'char-001', to_type: 'nations', to_id: 'n1', relation_type: 'neutral', is_pinned: false })
    await createRelation({ from_id: 'char-001', to_type: 'nations', to_id: 'n2', relation_type: 'ally', is_pinned: true })
    const res = await getRelations('characters', 'char-001')
    const body = await res.json() as Record<string, any>
    expect(body.relations[0].to_id).toBe('n2')
    expect(body.relations[0].is_pinned).toBe(true)
    expect(body.relations[1].to_id).toBe('n1')
  })

  it('normalises null attitude to null', async () => {
    await adminFetch('POST', '/admin/relations', {
      from_type: 'characters', from_id: 'c1', to_type: 'locations', to_id: 'loc-1',
      relation_type: 'visits',
      // no attitude
    })
    const res = await getRelations('characters', 'c1')
    const body = await res.json() as Record<string, any>
    expect(body.relations[0].attitude).toBeNull()
  })

  it('normalises missing optional fields to safe defaults', async () => {
    await adminFetch('POST', '/admin/relations', {
      from_type: 'characters', from_id: 'cx', to_type: 'quests', to_id: 'qx',
      relation_type: 'participates',
    })
    const res = await getRelations('characters', 'cx')
    const body = await res.json() as Record<string, any>
    const rel = body.relations[0]
    expect(typeof rel.id).toBe('string')
    expect(rel.color).toBeNull()
    expect(rel.notes).toBeNull()
    expect(rel.is_bidirectional).toBe(true)
    expect(rel.is_pinned).toBe(false)
    expect(rel.is_private).toBe(false)
  })

  it('returns 400 for unknown entity type slug', async () => {
    const res = await getRelations('dragons', 'drgn-001')
    expect(res.status).toBe(400)
    const body = await res.json() as Record<string, any>
    expect(body.error).toContain('Unknown entity type')
  })
})

// ── POST /admin/relations ─────────────────────────────────────────────────────

describe('POST /admin/relations', () => {
  beforeEach(async () => {
    await setupRpgDb(env.RPG_DB)
  })

  it('creates a relation and returns ok:true with an id', async () => {
    const res = await createRelation()
    expect(res.status).toBe(201)
    const body = await res.json() as Record<string, any>
    expect(body.ok).toBe(true)
    expect(typeof body.id).toBe('string')
    expect(body.id.length).toBeGreaterThan(0)
  })

  it('created relation is queryable via GET', async () => {
    await createRelation({ from_id: 'char-findme', to_type: 'items', to_id: 'item-001', relation_type: 'owns', attitude: 50 })
    const res = await getRelations('characters', 'char-findme')
    const body = await res.json() as Record<string, any>
    expect(body.total).toBe(1)
    expect(body.relations[0].relation_type).toBe('owns')
    expect(body.relations[0].attitude).toBe(50)
  })

  it('returns 401 with wrong secret', async () => {
    const res = await createRelation({ _secret_override: true })
    // re-call with bad secret
    const res2 = await adminFetch('POST', '/admin/relations', {
      from_type: 'characters', from_id: 'x', to_type: 'nations', to_id: 'y', relation_type: 'z',
    }, 'wrong-secret')
    expect(res2.status).toBe(401)
    const body = await res2.json() as Record<string, any>
    expect(body.ok).toBe(false)
  })

  it('returns 401 when secret header is missing', async () => {
    const res = await SELF.fetch('http://example.com/admin/relations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from_type: 'characters', from_id: 'x', to_type: 'nations', to_id: 'y', relation_type: 'z' }),
    })
    expect(res.status).toBe(401)
  })

  it('returns 400 when from_type is invalid', async () => {
    const res = await adminFetch('POST', '/admin/relations', {
      from_type: 'dragons', from_id: 'x', to_type: 'characters', to_id: 'y', relation_type: 'z',
    })
    expect(res.status).toBe(400)
  })

  it('returns 400 when to_type is invalid', async () => {
    const res = await adminFetch('POST', '/admin/relations', {
      from_type: 'characters', from_id: 'x', to_type: 'factions', to_id: 'y', relation_type: 'z',
    })
    expect(res.status).toBe(400)
  })

  it('returns 400 when from_id is missing', async () => {
    const res = await adminFetch('POST', '/admin/relations', {
      from_type: 'characters', to_type: 'nations', to_id: 'y', relation_type: 'z',
    })
    expect(res.status).toBe(400)
  })

  it('returns 400 when to_id is missing', async () => {
    const res = await adminFetch('POST', '/admin/relations', {
      from_type: 'characters', from_id: 'x', to_type: 'nations', relation_type: 'z',
    })
    expect(res.status).toBe(400)
  })

  it('returns 400 when relation_type is missing', async () => {
    const res = await adminFetch('POST', '/admin/relations', {
      from_type: 'characters', from_id: 'x', to_type: 'nations', to_id: 'y',
    })
    expect(res.status).toBe(400)
  })

  it('returns 400 when body is not valid JSON', async () => {
    const res = await SELF.fetch('http://example.com/admin/relations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': ADMIN_SECRET },
      body: 'not-json',
    })
    expect(res.status).toBe(400)
  })

  it('stores optional fields: notes, color, is_private', async () => {
    await adminFetch('POST', '/admin/relations', {
      from_type: 'characters', from_id: 'c-opt', to_type: 'locations', to_id: 'l-opt',
      relation_type: 'haunts',
      notes: 'Seen here at night',
      color: '#ff0000',
      is_private: true,
    })
    const res = await getRelations('characters', 'c-opt')
    const body = await res.json() as Record<string, any>
    const rel = body.relations[0]
    expect(rel.notes).toBe('Seen here at night')
    expect(rel.color).toBe('#ff0000')
    expect(rel.is_private).toBe(true)
  })
})

// ── PATCH /admin/relations/:id ────────────────────────────────────────────────

describe('PATCH /admin/relations/:id', () => {
  beforeEach(async () => {
    await setupRpgDb(env.RPG_DB)
  })

  it('updates relation_type', async () => {
    const created = await (await createRelation({ from_id: 'c-patch' })).json() as Record<string, any>
    const patchRes = await adminFetch('PATCH', `/admin/relations/${created.id}`, { relation_type: 'enemy' })
    expect(patchRes.status).toBe(200)
    const body = await patchRes.json() as Record<string, any>
    expect(body.ok).toBe(true)

    const get = await (await getRelations('characters', 'c-patch')).json() as Record<string, any>
    expect(get.relations[0].relation_type).toBe('enemy')
  })

  it('updates attitude', async () => {
    const created = await (await createRelation({ from_id: 'c-att' })).json() as Record<string, any>
    await adminFetch('PATCH', `/admin/relations/${created.id}`, { attitude: -80 })
    const get = await (await getRelations('characters', 'c-att')).json() as Record<string, any>
    expect(get.relations[0].attitude).toBe(-80)
  })

  it('updates is_pinned', async () => {
    const created = await (await createRelation({ from_id: 'c-pin' })).json() as Record<string, any>
    await adminFetch('PATCH', `/admin/relations/${created.id}`, { is_pinned: 1 })
    const get = await (await getRelations('characters', 'c-pin')).json() as Record<string, any>
    expect(get.relations[0].is_pinned).toBe(true)
  })

  it('returns 404 for unknown relation id', async () => {
    const res = await adminFetch('PATCH', '/admin/relations/does-not-exist', { relation_type: 'x' })
    expect(res.status).toBe(404)
  })

  it('returns 400 when no patchable fields are provided', async () => {
    const created = await (await createRelation({ from_id: 'c-noop' })).json() as Record<string, any>
    const res = await adminFetch('PATCH', `/admin/relations/${created.id}`, { unknown_field: 'x' })
    expect(res.status).toBe(400)
  })

  it('returns 401 with wrong secret', async () => {
    const created = await (await createRelation({ from_id: 'c-auth' })).json() as Record<string, any>
    const res = await adminFetch('PATCH', `/admin/relations/${created.id}`, { relation_type: 'x' }, 'bad-secret')
    expect(res.status).toBe(401)
  })

  it('returns 400 when body is not valid JSON', async () => {
    const created = await (await createRelation({ from_id: 'c-json' })).json() as Record<string, any>
    const res = await SELF.fetch(`http://example.com/admin/relations/${created.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': ADMIN_SECRET },
      body: '{bad}',
    })
    expect(res.status).toBe(400)
  })
})

// ── DELETE /admin/relations/:id ───────────────────────────────────────────────

describe('DELETE /admin/relations/:id', () => {
  beforeEach(async () => {
    await setupRpgDb(env.RPG_DB)
  })

  it('deletes an existing relation and returns ok:true', async () => {
    const created = await (await createRelation({ from_id: 'c-del' })).json() as Record<string, any>
    const delRes = await SELF.fetch(`http://example.com/admin/relations/${created.id}`, {
      method: 'DELETE',
      headers: { 'X-Admin-Secret': ADMIN_SECRET },
    })
    expect(delRes.status).toBe(200)
    const body = await delRes.json() as Record<string, any>
    expect(body.ok).toBe(true)

    const get = await (await getRelations('characters', 'c-del')).json() as Record<string, any>
    expect(get.total).toBe(0)
  })

  it('returns 404 when relation does not exist', async () => {
    const res = await SELF.fetch('http://example.com/admin/relations/ghost-id', {
      method: 'DELETE',
      headers: { 'X-Admin-Secret': ADMIN_SECRET },
    })
    expect(res.status).toBe(404)
  })

  it('returns 401 with wrong secret', async () => {
    const created = await (await createRelation({ from_id: 'c-del-auth' })).json() as Record<string, any>
    const res = await SELF.fetch(`http://example.com/admin/relations/${created.id}`, {
      method: 'DELETE',
      headers: { 'X-Admin-Secret': 'wrong' },
    })
    expect(res.status).toBe(401)
  })

  it('returns 401 when secret header is missing', async () => {
    const created = await (await createRelation({ from_id: 'c-del-noauth' })).json() as Record<string, any>
    const res = await SELF.fetch(`http://example.com/admin/relations/${created.id}`, {
      method: 'DELETE',
    })
    expect(res.status).toBe(401)
  })
})
