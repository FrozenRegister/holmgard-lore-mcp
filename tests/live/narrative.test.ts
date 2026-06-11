import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { MCP_API_KEY, tool, uid, setLore, deleteLore } from './helpers'

describe.skipIf(!MCP_API_KEY)('Append to Section', () => {
  let key: string

  beforeEach(async () => {
    key = `ats:smoke-${uid()}`
    await setLore(key, '## Personality\nBrave and curious.\n## Goals\nFind the truth.')
  })

  afterEach(async () => { await deleteLore(key) })

  it('appends to end of section', async () => {
    const res = await tool('lore_manage', { action: 'append_section', key, section: 'Personality', text: ' Loyal to companions.' })
    expect(res.result.action).toBe('appended')
    expect(res.result.new_version).toBe(2)
  })

  it('section not found with auto_create=false returns error', async () => {
    const res = await tool('lore_manage', {
      action: 'append_section', key, section: 'NonExistentSection', text: 'Some text.', auto_create: false,
    })
    expect(res.result.error).toBe('section_not_found')
  })

  it('auto_create=true creates new section', async () => {
    const res = await tool('lore_manage', { action: 'append_section', key, section: 'Notes', text: 'First note.' })
    expect(res.result.action).toBe('created')
    expect(res.result.warnings).toContain('section_created')
  })

  it('empty text returns empty_text error', async () => {
    const res = await tool('lore_manage', { action: 'append_section', key, section: 'Personality', text: '' })
    expect(res.result.error).toBe('empty_text')
  })

  it('non-existent key returns key_not_found', async () => {
    const res = await tool('lore_manage', {
      action: 'append_section', key: `character:ats-does-not-exist-${uid()}`, section: 'Personality', text: 'Text.',
    })
    expect(res.result.error).toBe('key_not_found')
  })
})
