import { describe, SELF } from './support/helpers'
import { expect, it } from 'vitest'

describe('request id propagation', () => {
  it('sets an X-Request-Id header on every response', async () => {
    const res = await SELF.fetch('http://example.com/health')
    expect(res.headers.get('X-Request-Id')).toBeTruthy()
  })

  it('echoes back a client-supplied X-Request-Id', async () => {
    const res = await SELF.fetch('http://example.com/health', {
      headers: { 'X-Request-Id': 'client-supplied-id-123' },
    })
    expect(res.headers.get('X-Request-Id')).toBe('client-supplied-id-123')
  })

  it('generates a different request id for each request when none is supplied', async () => {
    const res1 = await SELF.fetch('http://example.com/health')
    const res2 = await SELF.fetch('http://example.com/health')
    expect(res1.headers.get('X-Request-Id')).not.toBe(res2.headers.get('X-Request-Id'))
  })

  it('includes request_id in admin route 500 error payloads', async () => {
    const res = await SELF.fetch('http://example.com/admin/set-lore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Request-Id': 'admin-trace-789' },
      body: '{not valid json',
    })
    expect(res.status).toBe(500)
    const body = (await res.json()) as Record<string, any>
    expect(res.headers.get('X-Request-Id')).toBe('admin-trace-789')
    expect(body.request_id).toBe('admin-trace-789')
  })
})
