import { describe, it, expect } from 'vitest'
import { MCP_API_KEY, tool } from './helpers'

describe.skipIf(!MCP_API_KEY)('Consumption Timelines', () => {
  it('list_consumption_timelines - all statuses', async () => {
    const res = await tool('entity_manage', { action: 'list_consumption_timelines', status_filter: 'all' })
    expect(res.error).toBeUndefined()
  })

  it('list_consumption_timelines - imminent only', async () => {
    const res = await tool('entity_manage', { action: 'list_consumption_timelines', status_filter: 'imminent' })
    expect(res.error).toBeUndefined()
  })
})

describe.skipIf(!MCP_API_KEY)('Thread Operations', () => {
  it('list_active_threads', async () => {
    const res = await tool('entity_manage', { action: 'list_active_threads' })
    expect(res.error).toBeUndefined()
  })
})
