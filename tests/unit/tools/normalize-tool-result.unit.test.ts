import { describe, it, expect } from 'vitest'
import { normalizeToolResult } from '@/tools/normalize-tool-result'

describe('normalizeToolResult (#621)', () => {
  it('passes an already content-block-shaped result through unchanged', () => {
    const result = { content: [{ type: 'text', text: 'pong' }], metadata: { source: 'internal' } }
    expect(normalizeToolResult(result)).toBe(result)
  })

  it('wraps a structured payload with no content array into a text block', () => {
    const result = { keys: ['character:eira-holt', 'location:marsh-end'] }
    const normalized = normalizeToolResult(result)

    expect(normalized.content).toEqual([{ type: 'text', text: JSON.stringify(result) }])
    expect(normalized.structuredContent).toEqual(result)
    expect(normalized.isError).toBeUndefined()
  })

  it('treats a non-array content field as not content-block-shaped', () => {
    const result = { content: 'not-an-array' }
    const normalized = normalizeToolResult(result)

    expect(normalized.content).toEqual([{ type: 'text', text: JSON.stringify(result) }])
    expect(normalized.structuredContent).toEqual(result)
  })

  it('returns an explicit error result for an undefined result', () => {
    const normalized = normalizeToolResult(undefined)

    expect(normalized.isError).toBe(true)
    expect(normalized.content[0].text).toMatch(/no result/i)
  })
})
