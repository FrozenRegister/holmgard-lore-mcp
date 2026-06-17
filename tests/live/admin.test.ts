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

  it('admin/gc returns ok:true with deleted_csp_reports count', async () => {
    const res = await adminPost('/admin/gc', {})
    expect(res.ok).toBe(true)
    expect(typeof res.deleted_csp_reports).toBe('number')
  })

  it('admin/set-lore-batch endpoint', async () => {
    const k1 = `test:batch-set-${uid()}`
    const k2 = `test:batch-set-${uid()}`
    const res = await adminPost('/admin/set-lore-batch', {
      items: [{ key: k1, text: 'Batch A' }, { key: k2, text: 'Batch B' }],
    })
    expect(res.ok).toBe(true)
    expect(res.saved).toBe(2)
    await adminPost('/admin/delete-lore-batch', { keys: [k1, k2] })
  })

  it('admin/delete-lore-batch endpoint', async () => {
    const k1 = `test:batch-del-${uid()}`
    const k2 = `test:batch-del-${uid()}`
    await adminPost('/admin/set-lore-batch', {
      items: [{ key: k1, text: 'Del A' }, { key: k2, text: 'Del B' }],
    })
    const res = await adminPost('/admin/delete-lore-batch', { keys: [k1, k2] })
    expect(res.ok).toBe(true)
    expect(res.deleted).toBe(2)
  })
})
