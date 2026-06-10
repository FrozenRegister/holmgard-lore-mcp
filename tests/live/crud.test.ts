import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { MCP_API_KEY, tool, uid, setLore, deleteLore } from './helpers'

describe.skipIf(!MCP_API_KEY)('Topic Validation', () => {
  it('validate_topic_exists - exact match', async () => {
    const res = await tool('validate_topic_exists', { query_string: 'character:sarah-weaver' })
    expect(res.error).toBeUndefined()
  })

  it('validate_topic_exists - partial match', async () => {
    const res = await tool('validate_topic_exists', { query_string: 'molly' })
    expect(res.error).toBeUndefined()
  })

  it('validate_topic_exists - no match', async () => {
    const res = await tool('validate_topic_exists', { query_string: 'nonexistent-thing-12345' })
    expect(res.error).toBeUndefined()
  })
})

describe.skipIf(!MCP_API_KEY)('Search', () => {
  let key: string

  beforeEach(async () => {
    key = `test:search-${uid()}`
    await setLore(key, 'Lore search test content.\nPrey is contained here.')
  })

  afterEach(async () => { await deleteLore(key) })

  it('search_lore returns results containing query term', async () => {
    const res = await tool('search_lore', { query: 'prey', max_results: 5 })
    expect(res.error).toBeUndefined()
    expect(res.result.content[0].text).toMatch(/prey/)
  })
})

describe.skipIf(!MCP_API_KEY)('Lore CRUD', () => {
  let key: string
  const text = '**Status:** Test\n**days_remaining:** 10\n**character:** test-subject'

  beforeEach(() => { key = `test:crud-${uid()}` })
  afterEach(async () => { await deleteLore(key) })

  it('set_lore creates new entry', async () => {
    const res = await tool('set_lore', { key, text })
    expect(res.error).toBeUndefined()
  })

  it('get_lore retrieves written content', async () => {
    await setLore(key, text)
    const res = await tool('get_lore', { query: key })
    expect(res.error).toBeUndefined()
    expect(res.result.content[0].text).toMatch(/days_remaining/)
  })

  it('delete_lore removes entry', async () => {
    await setLore(key, text)
    const res = await tool('delete_lore', { key })
    expect(res.error).toBeUndefined()
  })
})
