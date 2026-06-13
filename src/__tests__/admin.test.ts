import { describe, ADMIN_SECRET, seedKV } from './helpers'
import { SELF, env } from 'cloudflare:test'
import { expect, it, beforeEach, describe as innerDescribe } from 'vitest'
import { setupRpgDb } from './setup-d1'

describe('admin endpoints', () => {
  async function adminPost(path: string, body: Record<string, unknown>) {
    return SELF.fetch(`http://example.com${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  describe('/admin/set-lore', () => {
    it('stores lore and returns ok:true with correct secret', async () => {
      const res = await adminPost('/admin/set-lore', {
        key: 'admin:test', text: 'Admin content', secret: ADMIN_SECRET,
      })
      const body = await res.json() as Record<string, any>
      expect(body.ok).toBe(true)
      expect(body.version).toBe(1)
    })

    it('returns 401 with wrong secret', async () => {
      const res = await adminPost('/admin/set-lore', {
        key: 'admin:test', text: 'Admin content', secret: 'wrong-secret',
      })
      expect(res.status).toBe(401)
      const body = await res.json() as Record<string, any>
      expect(body.ok).toBe(false)
    })

    it('returns 401 when secret is omitted', async () => {
      const res = await adminPost('/admin/set-lore', { key: 'admin:test', text: 'Admin content' })
      expect(res.status).toBe(401)
    })

    it('returns 400 when key is missing', async () => {
      const res = await adminPost('/admin/set-lore', { text: 'Admin content', secret: ADMIN_SECRET })
      expect(res.status).toBe(400)
    })

    it('returns 400 when key is null', async () => {
      const res = await adminPost('/admin/set-lore', { key: null, text: 'content', secret: ADMIN_SECRET })
      expect(res.status).toBe(400)
    })

    it('returns 400 when key is empty string', async () => {
      const res = await adminPost('/admin/set-lore', { key: '', text: 'content', secret: ADMIN_SECRET })
      expect(res.status).toBe(400)
    })

    it('returns 400 when key is whitespace only', async () => {
      const res = await adminPost('/admin/set-lore', { key: '   ', text: 'content', secret: ADMIN_SECRET })
      expect(res.status).toBe(400)
    })

    it('returns 400 when key is a number', async () => {
      const res = await adminPost('/admin/set-lore', { key: 42, text: 'content', secret: ADMIN_SECRET })
      expect(res.status).toBe(400)
    })

    it('returns 400 when key is an array', async () => {
      const res = await adminPost('/admin/set-lore', { key: ['foo', 'bar'], text: 'content', secret: ADMIN_SECRET })
      expect(res.status).toBe(400)
    })

    it('returns 400 when text is empty string', async () => {
      const res = await adminPost('/admin/set-lore', { key: 'admin:test-empty-text', text: '', secret: ADMIN_SECRET })
      expect(res.status).toBe(400)
    })

    it('returns 400 when text is whitespace only', async () => {
      const res = await adminPost('/admin/set-lore', { key: 'admin:test-ws-text', text: '   ', secret: ADMIN_SECRET })
      expect(res.status).toBe(400)
    })

    it('returns 400 when text is missing', async () => {
      const res = await adminPost('/admin/set-lore', { key: 'admin:test-missing-text', secret: ADMIN_SECRET })
      expect(res.status).toBe(400)
    })

    // ── error sanitization ────────────────────────────────────────────────
    it('500 responses never expose internal KV error strings', async () => {
      const res = await SELF.fetch('http://example.com/admin/set-lore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{not valid json',
      })
      expect(res.status).toBe(500)
      const body = await res.json() as Record<string, any>
      expect(body.ok).toBe(false)
      expect(typeof body.error).toBe('string')
      expect(body.error).not.toContain('KVNamespace')
      expect(body.error).not.toContain('stack trace')
    })

    it('500 responses never expose source file paths or call-site references', async () => {
      const res = await SELF.fetch('http://example.com/admin/set-lore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: Buffer.from([0xFF, 0xFE, 0x00]).toString(),
      })
      expect(res.status).toBe(500)
      const body = await res.json() as Record<string, any>
      expect(body.ok).toBe(false)
      if (typeof body.error === 'string') {
        expect(body.error).not.toContain('at ')
        expect(body.error).not.toContain('.ts:')
      }
    })
  })

  innerDescribe('/admin/migrate-character', () => {
    beforeEach(async () => {
      await setupRpgDb(env.RPG_DB)
    })

    const CHAR_LORE = [
      '# Character:Aria Test',
      '**Age:** 30',
      '**Gender:** Female',
      '**Status:** Active, Healthy',
      '**Faction:** test-faction',
      '',
      '## Mechanical Scaffolding',
      '**Weight-1 (Drive):** 0.7',
      '**Weight-2 (Vulnerability):** 0.3',
      '**Perception:** 0.6',
      '**Thread:** thread:aria-start',
      '**State-Stage:** 1',
      '**Stage-Timer:** 0',
    ].join('\n')

    it('migrates KV character to D1 and prepends redirect marker', async () => {
      await seedKV('character:aria-test', CHAR_LORE)

      const res = await SELF.fetch('http://example.com/admin/migrate-character', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'character:aria-test', secret: ADMIN_SECRET }),
      })
      const body = await res.json() as Record<string, any>
      expect(body.ok).toBe(true)
      expect(body.d1Id).toBeTruthy()
      expect(body.name).toContain('Aria')

      const row = await env.RPG_DB!.prepare('SELECT * FROM characters WHERE kv_origin = ?')
        .bind('character:aria-test').first() as Record<string, any> | null
      expect(row).not.toBeNull()
      expect(row!.name).toContain('Aria')
      expect(row!.faction_id).toBe('test-faction')
      expect(row!.weight_1).toBeCloseTo(0.7, 2)
      expect(row!.thread_id).toBe('thread:aria-start')

      const kvRaw = await env.LORE_DB.get('character:aria-test')
      const kvParsed = JSON.parse(kvRaw!) as { text: string }
      expect(kvParsed.text).toContain('## D1-Migrated: true')
      expect(kvParsed.text).toContain(`## D1-Character-ID: ${body.d1Id}`)
    })

    it('returns already_migrated:true if redirect marker already present', async () => {
      const alreadyMigratedText = [
        '## D1-Migrated: true',
        '## D1-Character-ID: existing-uuid-999',
        '## Status: Legacy entry — see D1 for current data',
        '',
        '# Character:Old Entry',
      ].join('\n')
      await seedKV('character:already-done', alreadyMigratedText)

      const res = await SELF.fetch('http://example.com/admin/migrate-character', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'character:already-done', secret: ADMIN_SECRET }),
      })
      const body = await res.json() as Record<string, any>
      expect(body.ok).toBe(true)
      expect(body.already_migrated).toBe(true)
      expect(body.d1Id).toBe('existing-uuid-999')
    })

    it('returns 400 if key does not start with character:', async () => {
      const res = await SELF.fetch('http://example.com/admin/migrate-character', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'location:somewhere', secret: ADMIN_SECRET }),
      })
      expect(res.status).toBe(400)
    })

    it('returns 404 if KV key not found', async () => {
      const res = await SELF.fetch('http://example.com/admin/migrate-character', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'character:nonexistent', secret: ADMIN_SECRET }),
      })
      expect(res.status).toBe(404)
    })

    it('returns 401 with wrong secret', async () => {
      const res = await SELF.fetch('http://example.com/admin/migrate-character', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'character:aria-test', secret: 'wrong' }),
      })
      expect(res.status).toBe(401)
    })

    it('500 responses never expose internal details (KV errors, stack traces, file paths)', async () => {
      const res = await SELF.fetch('http://example.com/admin/migrate-character', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not json{{{',
      })
      expect(res.status).toBe(500)
      const body = await res.json() as Record<string, any>
      expect(body.ok).toBe(false)
      expect(typeof body.error).toBe('string')
      expect(body.error).not.toContain('KVNamespace')
      expect(body.error).not.toContain('.ts:')
      expect(body.error).not.toContain('at ')
    })
  })

  describe('/admin/delete-lore', () => {
    it('deletes lore and returns ok:true with correct secret', async () => {
      await env.LORE_DB.put('admin:del-target', JSON.stringify({ text: 'to delete', meta: {} }))
      const res = await adminPost('/admin/delete-lore', { key: 'admin:del-target', secret: ADMIN_SECRET })
      const body = await res.json() as Record<string, any>
      expect(body.ok).toBe(true)
    })

    it('returns 401 with wrong secret', async () => {
      const res = await adminPost('/admin/delete-lore', { key: 'admin:test', secret: 'wrong' })
      expect(res.status).toBe(401)
    })

    it('returns 400 when key is missing', async () => {
      const res = await adminPost('/admin/delete-lore', { secret: ADMIN_SECRET })
      expect(res.status).toBe(400)
    })

    it('returns 400 when key is null', async () => {
      const res = await adminPost('/admin/delete-lore', { key: null, secret: ADMIN_SECRET })
      expect(res.status).toBe(400)
    })

    it('returns 400 when key is empty string', async () => {
      const res = await adminPost('/admin/delete-lore', { key: '', secret: ADMIN_SECRET })
      expect(res.status).toBe(400)
    })

    it('returns 400 when key is whitespace only', async () => {
      const res = await adminPost('/admin/delete-lore', { key: '   ', secret: ADMIN_SECRET })
      expect(res.status).toBe(400)
    })

    it('returns 400 when key is a number', async () => {
      const res = await adminPost('/admin/delete-lore', { key: 42, secret: ADMIN_SECRET })
      expect(res.status).toBe(400)
    })

    it('returns 400 when key is an array', async () => {
      const res = await adminPost('/admin/delete-lore', { key: ['k', 'v'], secret: ADMIN_SECRET })
      expect(res.status).toBe(400)
    })

    it('500 responses never expose internal details (KV errors, stack traces, file paths)', async () => {
      const res = await SELF.fetch('http://example.com/admin/delete-lore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{{broken json',
      })
      expect(res.status).toBe(500)
      const body = await res.json() as Record<string, any>
      expect(body.ok).toBe(false)
      expect(typeof body.error).toBe('string')
      expect(body.error).not.toContain('KVNamespace')
      expect(body.error).not.toContain('.ts:')
    })
  })

  describe('/admin/gc', () => {
    it('500 responses never expose internal details (KV errors, stack traces, file paths)', async () => {
      const res = await SELF.fetch('http://example.com/admin/gc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '}{',
      })
      expect(res.status).toBe(500)
      const body = await res.json() as Record<string, any>
      expect(body.ok).toBe(false)
      expect(typeof body.error).toBe('string')
      expect(body.error).not.toContain('KVNamespace')
      expect(body.error).not.toContain('.ts:')
    })
  })

  describe('/admin/map/setup-db', () => {
    it('500 responses never expose internal details', async () => {
      const res = await SELF.fetch('http://example.com/admin/map/setup-db', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not json',
      })
      expect(res.status).toBe(500)
      const body = await res.json() as Record<string, any>
      expect(body.ok).toBe(false)
      expect(typeof body.error).toBe('string')
      expect(body.error).not.toContain('KVNamespace')
      expect(body.error).not.toContain('.ts:')
    })
  })

  describe('/admin/map/push-hexes', () => {
    it('500 responses never expose internal details', async () => {
      const res = await SELF.fetch('http://example.com/admin/map/push-hexes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{',
      })
      expect(res.status).toBe(500)
      const body = await res.json() as Record<string, any>
      expect(body.ok).toBe(false)
      expect(typeof body.error).toBe('string')
      expect(body.error).not.toContain('KVNamespace')
      expect(body.error).not.toContain('.ts:')
    })
  })

  describe('/admin/map/push-landmarks', () => {
    it('500 responses never expose internal details', async () => {
      const res = await SELF.fetch('http://example.com/admin/map/push-landmarks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{',
      })
      expect(res.status).toBe(500)
      const body = await res.json() as Record<string, any>
      expect(body.ok).toBe(false)
      expect(typeof body.error).toBe('string')
      expect(body.error).not.toContain('KVNamespace')
      expect(body.error).not.toContain('.ts:')
    })
  })
})
