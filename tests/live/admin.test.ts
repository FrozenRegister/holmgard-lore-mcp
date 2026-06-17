import { describe, it, expect } from 'vitest'
import { MCP_API_KEY, ADMIN_SECRET, adminPost, tool, uid } from './helpers'

describe.skipIf(!MCP_API_KEY || !ADMIN_SECRET)('Admin Endpoints', () => {
  it('admin/set-lore endpoint', async () => {
    const key = `test:admin-set-${uid()}`
    const res = await adminPost('/admin/set-lore', { key, text: 'Admin test content.' })
    expect(res.ok).toBe(true)
    await tool('lore_manage', { action: 'delete', key })
  })

  it('admin/delete-lore endpoint', async () => {
    const key = `test:admin-delete-${uid()}`
    await tool('lore_manage', { action: 'set', key, text: 'Admin test content.' })
    const res = await adminPost('/admin/delete-lore', { key })
    expect(res.ok).toBe(true)
  })

  it('admin/purge-csp-reports returns ok:true with deleted count', async () => {
    const res = await adminPost('/admin/purge-csp-reports', {})
    expect(res.ok).toBe(true)
    expect(typeof res.deleted).toBe('number')
  })
})
