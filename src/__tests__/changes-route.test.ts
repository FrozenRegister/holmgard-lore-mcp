import { describe, SELF, env } from './helpers'
import { expect, it } from 'vitest'
import { CHANGELOG_KEY } from '../constants'

describe('GET /changes', () => {
  it('returns an empty list when no changelog exists', async () => {
    const res = await SELF.fetch('http://example.com/changes')
    expect(res.status).toBe(200)
    const body = await res.json() as { changes: unknown[]; count: number; generated_at: string }
    expect(body.changes).toEqual([])
    expect(body.count).toBe(0)
    expect(typeof body.generated_at).toBe('string')
  })

  it('returns all entries when no since param is given', async () => {
    const entries = [
      { key: 'a', version: 1, updatedAt: '2026-01-01T00:00:00.000Z', op: 'set' },
      { key: 'b', version: 1, updatedAt: '2026-02-01T00:00:00.000Z', op: 'set' },
    ]
    await env.LORE_DB.put(CHANGELOG_KEY, JSON.stringify(entries))
    const res = await SELF.fetch('http://example.com/changes')
    const body = await res.json() as { changes: unknown[]; count: number }
    expect(body.count).toBe(2)
  })

  it('filters entries to those after the since timestamp', async () => {
    const entries = [
      { key: 'a', version: 1, updatedAt: '2026-01-01T00:00:00.000Z', op: 'set' },
      { key: 'b', version: 1, updatedAt: '2026-03-01T00:00:00.000Z', op: 'set' },
    ]
    await env.LORE_DB.put(CHANGELOG_KEY, JSON.stringify(entries))
    const res = await SELF.fetch('http://example.com/changes?since=2026-02-01T00:00:00.000Z')
    const body = await res.json() as { changes: Array<{ key: string }>; count: number }
    expect(body.count).toBe(1)
    expect(body.changes[0].key).toBe('b')
  })

  it('ignores a malformed since param and returns all entries', async () => {
    const entries = [{ key: 'a', version: 1, updatedAt: '2026-01-01T00:00:00.000Z', op: 'set' }]
    await env.LORE_DB.put(CHANGELOG_KEY, JSON.stringify(entries))
    const res = await SELF.fetch('http://example.com/changes?since=not-a-date')
    const body = await res.json() as { count: number }
    expect(body.count).toBe(1)
  })

  it('returns an empty list when the changelog value is corrupt JSON', async () => {
    await env.LORE_DB.put(CHANGELOG_KEY, '{not valid json')
    const res = await SELF.fetch('http://example.com/changes')
    expect(res.status).toBe(200)
    const body = await res.json() as { changes: unknown[]; count: number }
    expect(body.changes).toEqual([])
    expect(body.count).toBe(0)
  })

  it('sets no-store cache headers', async () => {
    const res = await SELF.fetch('http://example.com/changes')
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expect(res.headers.get('Content-Type')).toContain('application/json')
  })
})
