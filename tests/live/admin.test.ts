import { describe, it, expect } from 'vitest'
import { MCP_API_KEY, ADMIN_SECRET, adminPost, tool, uid } from './helpers'

describe.skipIf(!MCP_API_KEY || !ADMIN_SECRET)('Admin Endpoints', () => {
  it('admin/set-lore endpoint', async () => {
    const key = `test:admin-set-${uid()}`
    const res = await adminPost('/admin/set-lore', { key, text: 'Admin test content.' })
    expect(res.ok).toBe(true)
    await tool('delete_lore', { key })
  })

  it('admin/delete-lore endpoint', async () => {
    const key = `test:admin-delete-${uid()}`
    await tool('set_lore', { key, text: 'Admin test content.' })
    const res = await adminPost('/admin/delete-lore', { key })
    expect(res.ok).toBe(true)
  })
})
