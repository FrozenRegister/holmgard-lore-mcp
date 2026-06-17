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

  describe('/admin/migrate-all-characters', () => {
    beforeEach(async () => {
      await setupRpgDb(env.RPG_DB)
    })

    it('returns 401 with wrong secret', async () => {
      const res = await adminPost('/admin/migrate-all-characters', { secret: 'wrong-secret' })
      expect(res.status).toBe(401)
      const body = await res.json() as Record<string, any>
      expect(body.ok).toBe(false)
    })

    it('returns 401 when secret is omitted', async () => {
      const res = await adminPost('/admin/migrate-all-characters', {})
      expect(res.status).toBe(401)
    })

    it('500 responses never expose internal details', async () => {
      const res = await SELF.fetch('http://example.com/admin/migrate-all-characters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'invalid json {',
      })
      expect(res.status).toBe(500)
      const body = await res.json() as Record<string, any>
      expect(body.ok).toBe(false)
      expect(typeof body.error).toBe('string')
      expect(body.error).not.toContain('KVNamespace')
      expect(body.error).not.toContain('.ts:')
    })

    it('successfully migrates multiple characters and returns summary', async () => {
      // Seed KV with test characters
      const testChars = [
        { key: 'character:alice', text: '# Character:Alice\n**Age:** 30' },
        { key: 'character:bob', text: '# Character:Bob\n**Age:** 40' },
      ]

      for (const { key, text } of testChars) {
        await env.LORE_DB.put(
          key,
          JSON.stringify({
            text,
            meta: { version: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
          }),
        )
      }

      const res = await adminPost('/admin/migrate-all-characters', { secret: ADMIN_SECRET })
      expect(res.status).toBe(200)
      const body = await res.json() as Record<string, any>
      expect(body.ok).toBe(true)
      expect(body.total).toBe(2)
      expect(body.migrated).toBe(2)
      expect(body.skipped).toBe(0)
      expect(body.failed).toBe(0)
      expect(Array.isArray(body.results)).toBe(true)
    })

    it('skips already-migrated characters', async () => {
      // Seed with one already-migrated character (with proper UUID format)
      await env.LORE_DB.put(
        'character:old',
        JSON.stringify({
          text: '## D1-Migrated: true\n## D1-Character-ID: 550e8400-e29b-41d4-a716-446655440000\n# Character:Old',
          meta: { version: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
        }),
      )

      const res = await adminPost('/admin/migrate-all-characters', { secret: ADMIN_SECRET })
      const body = await res.json() as Record<string, any>
      expect(body.skipped).toBeGreaterThanOrEqual(1)
    })
  })

  describe('/admin/purge-csp-reports', () => {
    it('deletes all _csp_report:* keys and returns count', async () => {
      await env.LORE_DB.put('_csp_report:2026-01-01T00:00:00.000Z:aaa111', JSON.stringify({ blocked: 'data' }))
      await env.LORE_DB.put('_csp_report:2026-01-02T00:00:00.000Z:bbb222', JSON.stringify({ blocked: 'data' }))

      const res = await adminPost('/admin/purge-csp-reports', { secret: ADMIN_SECRET })
      expect(res.status).toBe(200)
      const body = await res.json() as Record<string, any>
      expect(body.ok).toBe(true)
      expect(body.deleted).toBe(2)

      expect(await env.LORE_DB.get('_csp_report:2026-01-01T00:00:00.000Z:aaa111')).toBeNull()
      expect(await env.LORE_DB.get('_csp_report:2026-01-02T00:00:00.000Z:bbb222')).toBeNull()
    })

    it('returns deleted:0 when no CSP report keys exist', async () => {
      const res = await adminPost('/admin/purge-csp-reports', { secret: ADMIN_SECRET })
      expect(res.status).toBe(200)
      const body = await res.json() as Record<string, any>
      expect(body.ok).toBe(true)
      expect(body.deleted).toBe(0)
    })

    it('returns 401 with wrong secret', async () => {
      const res = await adminPost('/admin/purge-csp-reports', { secret: 'wrong' })
      expect(res.status).toBe(401)
    })

    it('does not delete non-CSP keys', async () => {
      await env.LORE_DB.put('lore:safe-entry', JSON.stringify({ text: 'keep me', meta: {} }))
      await env.LORE_DB.put('_csp_report:2026-01-01T00:00:00.000Z:cleanup', JSON.stringify({ blocked: 'data' }))

      await adminPost('/admin/purge-csp-reports', { secret: ADMIN_SECRET })

      expect(await env.LORE_DB.get('lore:safe-entry')).not.toBeNull()
    })
  })

  describe('/csp-report endpoint', () => {
    it('returns status:reported without writing to KV', async () => {
      const reportPayload = {
        'blocked-uri': 'https://evil.example.com/script.js',
        'violated-directive': 'script-src',
        'source-file': 'https://myapp.example.com/',
        'original-policy': "default-src 'self'",
        disposition: 'enforce',
      }
      const res = await SELF.fetch('http://example.com/csp-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reportPayload),
      })
      expect(res.status).toBe(200)
      const body = await res.json() as Record<string, any>
      expect(body.status).toBe('reported')

      // Verify nothing was written to KV
      const listed: any = await env.LORE_DB.list({ prefix: '_csp_report:' })
      expect(listed.keys).toHaveLength(0)
    })
  })
})
