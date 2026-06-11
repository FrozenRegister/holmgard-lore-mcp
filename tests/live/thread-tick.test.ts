import { describe, it, expect } from 'vitest'
import { MCP_API_KEY, tool } from './helpers'

describe.skipIf(!MCP_API_KEY)('Thread Tick', () => {
  it('thread_tick with no entities returns no-entities message', async () => {
    const res = await tool('world_manage', { action: 'thread_tick', thread_id: 'nonexistent-thread-xyz' })
    expect(res.error).toBeUndefined()
    expect(res.result.content[0].text).toMatch(/No entities/)
  })
})
