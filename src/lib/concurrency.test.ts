import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { checkForConcurrentWrite } from './concurrency'

const c = { env } as any

describe('checkForConcurrentWrite', () => {
  it('reports no conflict when the version matches', async () => {
    await env.LORE_DB.put('test:concurrency-match', JSON.stringify({ text: 'x', meta: { version: 3 } }))
    const result = await checkForConcurrentWrite(c, 'test:concurrency-match', 3)
    expect(result).toEqual({ conflict: false })
  })

  it('reports a conflict when the version has moved on', async () => {
    await env.LORE_DB.put('test:concurrency-mismatch', JSON.stringify({ text: 'x', meta: { version: 5 } }))
    const result = await checkForConcurrentWrite(c, 'test:concurrency-mismatch', 3)
    expect(result).toEqual({ conflict: true, currentVersion: 5 })
  })

  it('reports a conflict when the key was deleted concurrently', async () => {
    const result = await checkForConcurrentWrite(c, 'test:concurrency-deleted-9999', 1)
    expect(result).toEqual({ conflict: true, currentVersion: null })
  })

  it('treats a legacy entry with no version field as version undefined', async () => {
    await env.LORE_DB.put('test:concurrency-legacy', JSON.stringify({ text: 'x', meta: {} }))
    const result = await checkForConcurrentWrite(c, 'test:concurrency-legacy', undefined)
    expect(result).toEqual({ conflict: false })
  })
})
