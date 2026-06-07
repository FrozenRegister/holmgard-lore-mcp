import { expect, it, beforeEach } from 'vitest'
import { describe, callTool, seedKV } from '../utils'

// ── set_lore and delete_lore ──────────────────────────────────────────────────

describe('set_lore', () => {
  it('stores text and returns version 1', async () => {
    const res = await callTool('set_lore', { key: 'write:new-entry', text: 'Hello world' })
    expect(res.result.metadata.version).toBe(1)
    expect(res.result.metadata.key).toBe('write:new-entry')
    const get = await callTool('get_lore', { query: 'write:new-entry' })
    expect(get.result.content[0].text).toBe('Hello world')
  })

  it('increments version on subsequent writes', async () => {
    await callTool('set_lore', { key: 'write:versioned', text: 'v1' })
    const res = await callTool('set_lore', { key: 'write:versioned', text: 'v2' })
    expect(res.result.metadata.version).toBe(2)
  })
})

describe('delete_lore', () => {
  it('removes the entry so get_lore returns an error', async () => {
    await callTool('set_lore', { key: 'write:to-delete', text: 'Temporary' })
    await callTool('delete_lore', { key: 'write:to-delete' })
    const get = await callTool('get_lore', { query: 'write:to-delete' })
    expect(get.error).toBeDefined()
  })
})

// ── get_lore_section ──────────────────────────────────────────────────────────

describe('get_lore_section', () => {
  it('exact match returns section content', async () => {
    await seedKV('section:basic', '## Personality\nCurious and kind.\n## Goals\nFind the truth.')
    const res = await callTool('get_lore_section', { key: 'section:basic', sections: ['Personality'] })
    expect(res.error).toBeUndefined()
    expect(res.result.sections['Personality']).toBe('Curious and kind.')
    expect(res.result.not_found).toEqual([])
  })

  it('case-insensitive match in loose mode', async () => {
    await seedKV('section:case', '## PERSONALITY\nCurious and kind.')
    const res = await callTool('get_lore_section', { key: 'section:case', sections: ['personality'] })
    expect(res.result.sections['personality']).toBe('Curious and kind.')
  })

  it('trailing colon stripped in loose mode', async () => {
    await seedKV('section:colon', '## Personality:\nCurious.')
    const res = await callTool('get_lore_section', { key: 'section:colon', sections: ['Personality'] })
    expect(res.result.sections['Personality']).toBe('Curious.')
  })

  it('whitespace collapsed in loose mode', async () => {
    await seedKV('section:spaces', '##   Physical   Profile  \nBroad-shouldered.')
    const res = await callTool('get_lore_section', { key: 'section:spaces', sections: ['Physical Profile'] })
    expect(res.result.sections['Physical Profile']).toBe('Broad-shouldered.')
  })

  it('not_found lists missing sections', async () => {
    await seedKV('section:missing', '## Personality\nCurious.')
    const res = await callTool('get_lore_section', { key: 'section:missing', sections: ['Inventory'] })
    expect(res.result.sections).toEqual({})
    expect(res.result.not_found).toEqual(['Inventory'])
  })

  it('empty section returns empty string and empty_section warning', async () => {
    await seedKV('section:empty', '## Personality\n\n## Goals\nBecome stronger.')
    const res = await callTool('get_lore_section', { key: 'section:empty', sections: ['Personality'] })
    expect(res.result.sections['Personality']).toBe('')
    expect(res.result.warnings.some((w: string) => w.includes('empty_section'))).toBe(true)
  })

  it('no ## headings: returns not_found and no_sections_found warning', async () => {
    await seedKV('section:flat', 'This is just a paragraph of text with no structure.')
    const res = await callTool('get_lore_section', { key: 'section:flat', sections: ['Personality'] })
    expect(res.result.sections).toEqual({})
    expect(res.result.warnings).toContain('no_sections_found')
    expect(res.result.not_found).toContain('Personality')
  })

  it('fallback to # headings when no ## headings exist', async () => {
    await seedKV('section:single-hash', '# Title\nSome preamble.\n# Another\nMore text.')
    const res = await callTool('get_lore_section', { key: 'section:single-hash', sections: ['Title'] })
    expect(res.result.sections['Title']).toBe('Some preamble.')
  })

  it('### headings are section boundaries alongside ## headings', async () => {
    await seedKV('section:sub', '## Personality\n### Strengths\nBrave.\n### Weaknesses\nImpulsive.\n## Goals\nGo home.')
    const res = await callTool('get_lore_section', { key: 'section:sub', sections: ['Strengths', 'Weaknesses', 'Goals'] })
    expect(res.result.sections['Strengths']).toBe('Brave.')
    expect(res.result.sections['Weaknesses']).toBe('Impulsive.')
    expect(res.result.sections['Goals']).toBe('Go home.')
  })

  it('special characters in section name match exactly', async () => {
    await seedKV('section:special', '## Weight-1 (Predator Drive):\n0.85')
    const res = await callTool('get_lore_section', { key: 'section:special', sections: ['Weight-1 (Predator Drive)'] })
    expect(res.result.sections['Weight-1 (Predator Drive)']).toContain('0.85')
  })

  it('substring does not cause false match (Goals vs Goals (Completed))', async () => {
    await seedKV('section:substring', '## Goals\nShort term.\n## Goals (Completed)\nDone.')
    const res = await callTool('get_lore_section', { key: 'section:substring', sections: ['Goals'] })
    expect(res.result.sections['Goals']).toBe('Short term.')
    expect(res.result.sections['Goals (Completed)']).toBeUndefined()
  })

  it('last section runs to EOF correctly', async () => {
    await seedKV('section:last', '## Section A\nContent A\n## Section B\nContent B')
    const res = await callTool('get_lore_section', { key: 'section:last', sections: ['Section B'] })
    expect(res.result.sections['Section B']).toBe('Content B')
  })

  it('duplicate section: first non-empty wins, duplicate_section warning added', async () => {
    await seedKV('section:dup', '## Notes\nFirst note.\n## Personality\nKind.\n## Notes\nSecond note.')
    const res = await callTool('get_lore_section', { key: 'section:dup', sections: ['Notes'] })
    expect(res.result.sections['Notes']).toBe('First note.')
    expect(res.result.warnings.some((w: string) => w.includes('duplicate_section'))).toBe(true)
  })

  it('duplicate section: skips empty first occurrence, returns first non-empty, no empty_section warning', async () => {
    await seedKV('section:dup-empty-first', '## Notes\n## Personality\nKind.\n## Notes\nSecond note.')
    const res = await callTool('get_lore_section', { key: 'section:dup-empty-first', sections: ['Notes'] })
    expect(res.result.sections['Notes']).toBe('Second note.')
    expect(res.result.warnings.some((w: string) => w.includes('duplicate_section'))).toBe(true)
    expect(res.result.warnings.some((w: string) => w.includes('empty_section'))).toBe(false)
  })

  it('duplicate section: all empty → returns "", warns both duplicate_section and empty_section', async () => {
    await seedKV('section:dup-all-empty', '## Notes\n## Notes\n## Personality\nKind.')
    const res = await callTool('get_lore_section', { key: 'section:dup-all-empty', sections: ['Notes'] })
    expect(res.result.sections['Notes']).toBe('')
    expect(res.result.warnings.some((w: string) => w.includes('duplicate_section'))).toBe(true)
    expect(res.result.warnings.some((w: string) => w.includes('empty_section'))).toBe(true)
  })

  it('zero sections requested: sections={}, not_found=[], no_sections_requested warning', async () => {
    await seedKV('section:zero', '## Personality\nCurious.')
    const res = await callTool('get_lore_section', { key: 'section:zero', sections: [] })
    expect(res.result.sections).toEqual({})
    expect(res.result.not_found).toEqual([])
    expect(res.result.warnings).toContain('no_sections_requested')
  })

  it('unicode and emoji in section name', async () => {
    await seedKV('section:unicode', "## État d'Esprit 😤\nFrustrated and hopeful.")
    const res = await callTool('get_lore_section', { key: 'section:unicode', sections: ["État d'Esprit 😤"] })
    expect(res.result.sections["État d'Esprit 😤"]).toContain('Frustrated and hopeful')
  })

  it('non-existent key returns key_not_found error in result', async () => {
    const res = await callTool('get_lore_section', { key: 'character:does-not-exist-99999', sections: ['Personality'] })
    expect(res.error).toBeUndefined()
    expect(res.result.error).toBe('key_not_found')
    expect(res.result.key).toBe('character:does-not-exist-99999')
  })

  it('consecutive empty sections both get empty_section warnings', async () => {
    await seedKV('section:consecutive', '## Section A\n## Section B\n## Section C\nReal content at last.')
    const res = await callTool('get_lore_section', { key: 'section:consecutive', sections: ['Section A', 'Section B', 'Section C'] })
    expect(res.result.sections['Section A']).toBe('')
    expect(res.result.sections['Section B']).toBe('')
    expect(res.result.sections['Section C']).toBe('Real content at last.')
    const emptyWarnings = (res.result.warnings as string[]).filter(w => w.includes('empty_section'))
    expect(emptyWarnings).toHaveLength(2)
  })

  it('mixed request: found sections returned, missing in not_found', async () => {
    await seedKV('section:mixed', '## Personality\nCurious.\n## Goals\nFind truth.')
    const res = await callTool('get_lore_section', { key: 'section:mixed', sections: ['Personality', 'Inventory', 'Goals'] })
    expect(res.result.sections['Personality']).toBe('Curious.')
    expect(res.result.sections['Goals']).toBe('Find truth.')
    expect(res.result.not_found).toEqual(['Inventory'])
  })

  it('very long section returns full content without truncation', async () => {
    const longContent = 'Very long content. '.repeat(5000)
    await seedKV('section:long', `## Notes\n${longContent}\n## End\nDone.`)
    const res = await callTool('get_lore_section', { key: 'section:long', sections: ['Notes'] })
    expect((res.result.sections['Notes'] as string).length).toBeGreaterThan(50000)
    expect(res.result.sections['Notes']).not.toContain('Done.')
  })

  it('mixed # and ## headings: both are boundaries, sections accessible at any level', async () => {
    await seedKV('section:mixed-hash', '# Title Block\nSome preamble text.\n\n## Section A\nContent.')
    const res = await callTool('get_lore_section', { key: 'section:mixed-hash', sections: ['Section A', 'Title Block'] })
    expect(res.result.sections['Section A']).toBe('Content.')
    expect(res.result.sections['Title Block']).toBe('Some preamble text.')
    expect(res.result.not_found).not.toContain('Section A')
  })

  it('strict mode does not strip trailing colon', async () => {
    await seedKV('section:strict', '## Personality:\nCurious.')
    const res = await callTool('get_lore_section', { key: 'section:strict', sections: ['Personality'], mode: 'strict' })
    // In strict mode, "Personality" does NOT match "Personality:" — colon is not stripped
    expect(res.result.not_found).toContain('Personality')
  })

  it('strict mode matches when heading and request are identical (case-insensitive)', async () => {
    await seedKV('section:strict-match', '## Personality\nCurious.')
    const res = await callTool('get_lore_section', { key: 'section:strict-match', sections: ['PERSONALITY'], mode: 'strict' })
    expect(res.result.sections['PERSONALITY']).toBe('Curious.')
  })

  it('result includes version from lore metadata', async () => {
    await seedKV('section:version', '## Notes\nSome notes.')
    const res = await callTool('get_lore_section', { key: 'section:version', sections: ['Notes'] })
    expect(res.result.version).toBe(1)
  })

  it('result includes key', async () => {
    await seedKV('section:key-check', '## Notes\nSome notes.')
    const res = await callTool('get_lore_section', { key: 'section:key-check', sections: ['Notes'] })
    expect(res.result.key).toBe('section:key-check')
  })
})

// ── increment_topic_field ─────────────────────────────────────────────────────

describe('increment_topic_field', () => {
  beforeEach(() => seedKV('character:counter-test', '**days_remaining:** 10\n**status:** active'))

  it('decrements field value', async () => {
    const res = await callTool('increment_topic_field', {
      key: 'character:counter-test',
      field_path: 'days_remaining',
      increment: -1,
      reason: 'daily-decrement',
    })
    expect(res.result.metadata.old_value).toBe(10)
    expect(res.result.metadata.new_value).toBe(9)
    expect(res.result.metadata.version).toBe(2)
  })

  it('handles accelerated negative increment', async () => {
    const res = await callTool('increment_topic_field', {
      key: 'character:counter-test',
      field_path: 'days_remaining',
      increment: -3,
      reason: 'accelerated-decay',
    })
    expect(res.result.metadata.new_value).toBe(7)
  })

  it('handles positive increment', async () => {
    const res = await callTool('increment_topic_field', {
      key: 'character:counter-test',
      field_path: 'days_remaining',
      increment: 5,
    })
    expect(res.result.metadata.new_value).toBe(15)
  })

  it('updates the stored text so get_lore reflects the new value', async () => {
    await callTool('increment_topic_field', {
      key: 'character:counter-test',
      field_path: 'days_remaining',
      increment: -1,
    })
    const get = await callTool('get_lore', { query: 'character:counter-test' })
    expect(get.result.text).toContain('**days_remaining:** 9')
  })

  it('returns error when field value is not numeric', async () => {
    const res = await callTool('increment_topic_field', {
      key: 'character:counter-test',
      field_path: 'status',
      increment: 1,
    })
    expect(res.error).toBeDefined()
    expect(res.error.message).toContain('not numeric')
  })

  it('returns error when key does not exist', async () => {
    const res = await callTool('increment_topic_field', {
      key: 'nonexistent:key-99999',
      field_path: 'days_remaining',
    })
    expect(res.error).toBeDefined()
    expect(res.error.message).toContain('not found')
  })
})

// ── increment_topic_field — field not present ─────────────────────────────────

describe('increment_topic_field — field not present in text', () => {
  it('returns error when field_path does not exist in lore text', async () => {
    await seedKV('character:no-field', '**Status:** Active\n**character:** test-subject')
    const res = await callTool('increment_topic_field', {
      key: 'character:no-field',
      field_path: 'days_remaining',
      increment: -1,
    })
    expect(res.error).toBeDefined()
    expect(res.error.code).toBe(-32602)
    expect(res.error.message).toContain('days_remaining')
  })

  it('returns error when text has matching field name but no numeric value', async () => {
    await seedKV('character:non-numeric-field', '**Status:** Test\n**days_remaining:** pending\n**character:** test-subject')
    const res = await callTool('increment_topic_field', {
      key: 'character:non-numeric-field',
      field_path: 'days_remaining',
      increment: -1,
    })
    expect(res.error).toBeDefined()
    expect(res.error.message).toContain('not numeric')
  })
})

// ── extractFieldFromText / updateFieldInText (via increment_topic_field) ──────

describe('field extraction — bullet-style and float formats', () => {
  it('extracts float from plain **Field:** format', async () => {
    await seedKV('character:plain-float', '**Weight-1:** 0.9\n**Status:** active')
    const res = await callTool('increment_topic_field', {
      key: 'character:plain-float',
      field_path: 'Weight-1',
      increment: 0.1,
    })
    expect(res.error).toBeUndefined()
    expect(res.result.metadata.old_value).toBe(0.9)
    expect(res.result.metadata.new_value).toBeCloseTo(1.0)
  })

  it('extracts float from bullet + descriptor format', async () => {
    await seedKV('character:bullet-float', '- **Weight-1 (Aggression/Predator-Drive):** 0.75\n**Status:** active')
    const res = await callTool('increment_topic_field', {
      key: 'character:bullet-float',
      field_path: 'Weight-1',
      increment: 0.1,
    })
    expect(res.error).toBeUndefined()
    expect(res.result.metadata.old_value).toBe(0.75)
    expect(res.result.metadata.new_value).toBeCloseTo(0.85)
  })

  it('preserves bullet + descriptor format when updating', async () => {
    await seedKV('character:preserve-format', '- **Weight-1 (Aggression):** 0.5\n**Status:** active')
    await callTool('increment_topic_field', {
      key: 'character:preserve-format',
      field_path: 'Weight-1',
      increment: 0.2,
    })
    const get = await callTool('get_lore', { query: 'character:preserve-format' })
    // The line should preserve its bullet and descriptor, only the value changes
    expect(get.result.text).toMatch(/- \*\*Weight-1 \(Aggression\):\*\*\s*0\.7/)
  })

  it('extracts numeric value from JSON block format', async () => {
    const jsonLore = '```json\n{\n  "Weight-1": 0.6,\n  "Status": "active"\n}\n```'
    await seedKV('character:json-block', jsonLore)
    const res = await callTool('increment_topic_field', {
      key: 'character:json-block',
      field_path: 'Weight-1',
      increment: 0.1,
    })
    expect(res.error).toBeUndefined()
    expect(res.result.metadata.old_value).toBe(0.6)
    expect(res.result.metadata.new_value).toBeCloseTo(0.7)
  })

  it('stores clean float without IEEE 754 noise', async () => {
    await seedKV('character:float-precision', '**Weight-1:** 0.75\n**Status:** active')
    await callTool('increment_topic_field', {
      key: 'character:float-precision',
      field_path: 'Weight-1',
      increment: 0.1,
    })
    const get = await callTool('get_lore', { query: 'character:float-precision' })
    // Should store 0.85, not 0.8500000000000001
    expect(get.result.text).toContain('**Weight-1:** 0.85')
  })
})

// ── patch_lore ────────────────────────────────────────────────────────────────

describe('patch_lore — replace', () => {
  beforeEach(() => seedKV('test:patch-replace', 'Status: Alive\nDays: 14'))

  it('replaces a unique substring', async () => {
    const res = await callTool('patch_lore', {
      key: 'test:patch-replace',
      operation: 'replace',
      target: 'Status: Alive',
      value: 'Status: Sedated',
    })
    expect(res.result.content[0].text).toContain('Replaced 1 occurrence')
  })

  it('the replacement is reflected in get_lore', async () => {
    await callTool('patch_lore', {
      key: 'test:patch-replace',
      operation: 'replace',
      target: 'Status: Alive',
      value: 'Status: Sedated',
    })
    const get = await callTool('get_lore', { query: 'test:patch-replace' })
    expect(get.result.text).toContain('Status: Sedated')
    expect(get.result.text).not.toContain('Status: Alive')
  })

  it('returns not-found message when target is absent', async () => {
    const res = await callTool('patch_lore', {
      key: 'test:patch-replace',
      operation: 'replace',
      target: 'Nonexistent phrase',
      value: 'X',
    })
    expect(res.result.content[0].text).toContain('not found in')
  })
})

describe('patch_lore — replace with ambiguous target', () => {
  beforeEach(() => seedKV('test:patch-ambig', 'the cat chased the cat'))

  it('refuses when target matches more than once', async () => {
    const res = await callTool('patch_lore', {
      key: 'test:patch-ambig',
      operation: 'replace',
      target: 'the cat',
      value: 'a dog',
    })
    expect(res.result.content[0].text).toContain('Ambiguous')
  })
})

describe('patch_lore — append', () => {
  it('appends to end when no target given', async () => {
    await seedKV('test:patch-append', 'Line 1')
    const res = await callTool('patch_lore', {
      key: 'test:patch-append',
      operation: 'append',
      value: '\nLine 2',
    })
    expect(res.result.content[0].text).toContain('Appended to end')
    const get = await callTool('get_lore', { query: 'test:patch-append' })
    expect(get.result.text).toContain('Line 2')
  })

  it('appends directly after a specific target', async () => {
    await seedKV('test:patch-append-t', 'Header\nBody')
    const res = await callTool('patch_lore', {
      key: 'test:patch-append-t',
      operation: 'append',
      target: 'Header',
      value: '\nSubheader',
    })
    expect(res.result.content[0].text).toContain('Appended after')
    const get = await callTool('get_lore', { query: 'test:patch-append-t' })
    expect(get.result.text).toContain('Subheader')
  })
})

describe('patch_lore — delete_field', () => {
  beforeEach(() => seedKV('test:patch-delete', 'Keep this.\nDelete this.\nKeep that.'))

  it('removes matching substring', async () => {
    const res = await callTool('patch_lore', {
      key: 'test:patch-delete',
      operation: 'delete_field',
      target: 'Delete this.\n',
    })
    expect(res.result.content[0].text).toContain('Deleted 1 occurrence')
  })

  it('the deletion is reflected in get_lore', async () => {
    await callTool('patch_lore', {
      key: 'test:patch-delete',
      operation: 'delete_field',
      target: 'Delete this.\n',
    })
    const get = await callTool('get_lore', { query: 'test:patch-delete' })
    expect(get.result.text).not.toContain('Delete this.')
    expect(get.result.text).toContain('Keep this.')
  })
})

describe('patch_lore — parameter validation', () => {
  beforeEach(() => seedKV('test:patch-val', 'some text here'))

  it('requires target for replace', async () => {
    const res = await callTool('patch_lore', { key: 'test:patch-val', operation: 'replace', value: 'X' })
    expect(res.result.content[0].text).toContain('"target" required')
  })

  it('requires target for delete_field', async () => {
    const res = await callTool('patch_lore', { key: 'test:patch-val', operation: 'delete_field' })
    expect(res.result.content[0].text).toContain('"target" required')
  })

  it('requires value for replace', async () => {
    const res = await callTool('patch_lore', { key: 'test:patch-val', operation: 'replace', target: 'some text' })
    expect(res.result.content[0].text).toContain('"value" required')
  })

  it('requires value for append', async () => {
    const res = await callTool('patch_lore', { key: 'test:patch-val', operation: 'append' })
    expect(res.result.content[0].text).toContain('"value" required')
  })

  it('returns not-found message for nonexistent key', async () => {
    const res = await callTool('patch_lore', {
      key: 'nonexistent:key-99999',
      operation: 'replace',
      target: 'X',
      value: 'Y',
    })
    expect(res.result.content[0].text).toContain('not found')
  })

  it('rejects unknown operation', async () => {
    const res = await callTool('patch_lore', {
      key: 'test:patch-val',
      operation: 'unknown_op',
    })
    expect(res.result.content[0].text).toContain('Unknown operation')
  })
})

// ── restore_lore ──────────────────────────────────────────────────────────────

describe('restore_lore', () => {
  it('returns no-history message when key has never been written', async () => {
    await seedKV('restore:fresh', 'initial text')
    const res = await callTool('restore_lore', { key: 'restore:fresh' })
    expect(res.result.metadata.restored).toBe(false)
    expect(res.result.content[0].text).toContain('No history')
  })

  it('restores to the previous value after one write', async () => {
    await seedKV('restore:target', 'original text')
    await callTool('set_lore', { key: 'restore:target', text: 'overwritten text' })
    const restore = await callTool('restore_lore', { key: 'restore:target' })
    expect(restore.result.metadata.restored).toBe(true)
    const get = await callTool('get_lore', { query: 'restore:target' })
    expect(get.result.text).toBe('original text')
  })

  it('pops the stack — each restore goes one step further back', async () => {
    await seedKV('restore:stack', 'v1')
    await callTool('set_lore', { key: 'restore:stack', text: 'v2' })
    await callTool('set_lore', { key: 'restore:stack', text: 'v3' })
    await callTool('restore_lore', { key: 'restore:stack' })
    const after1 = await callTool('get_lore', { query: 'restore:stack' })
    expect(after1.result.text).toBe('v2')
    await callTool('restore_lore', { key: 'restore:stack' })
    const after2 = await callTool('get_lore', { query: 'restore:stack' })
    expect(after2.result.text).toBe('v1')
  })

  it('reports remaining snapshots in metadata', async () => {
    await seedKV('restore:count', 'a')
    await callTool('set_lore', { key: 'restore:count', text: 'b' })
    await callTool('set_lore', { key: 'restore:count', text: 'c' })
    const res = await callTool('restore_lore', { key: 'restore:count' })
    expect(res.result.metadata.remaining_history).toBe(1)
  })

  it('caps history at 20 — oldest entry is dropped on the 21st write', async () => {
    await seedKV('restore:cap', 'v0')
    for (let i = 1; i <= 21; i++) {
      await callTool('set_lore', { key: 'restore:cap', text: `v${i}` })
    }
    // Restore 20 times — should reach v1 (v0 was evicted)
    for (let i = 0; i < 20; i++) {
      await callTool('restore_lore', { key: 'restore:cap' })
    }
    const get = await callTool('get_lore', { query: 'restore:cap' })
    expect(get.result.text).toBe('v1')
    // One more restore should report no history
    const last = await callTool('restore_lore', { key: 'restore:cap' })
    expect(last.result.metadata.restored).toBe(false)
  })

  it('history is invisible to list_topics', async () => {
    await seedKV('restore:hidden', 'text')
    await callTool('set_lore', { key: 'restore:hidden', text: 'updated' })
    const list = await callTool('list_topics')
    const text = list.result.content[0].text as string
    expect(text).not.toContain('_history:')
  })

  it('works after patch_lore writes', async () => {
    await seedKV('restore:patched', 'Status: Alive\nNotes: clean')
    await callTool('patch_lore', { key: 'restore:patched', operation: 'replace', target: 'Status: Alive', value: 'Status: Dead' })
    await callTool('restore_lore', { key: 'restore:patched' })
    const get = await callTool('get_lore', { query: 'restore:patched' })
    expect(get.result.text).toContain('Status: Alive')
  })

  it('works after increment_topic_field writes', async () => {
    await seedKV('restore:incremented', '**days_remaining:** 10')
    await callTool('increment_topic_field', { key: 'restore:incremented', field_path: 'days_remaining', increment: -3 })
    await callTool('restore_lore', { key: 'restore:incremented' })
    const get = await callTool('get_lore', { query: 'restore:incremented' })
    expect(get.result.text).toContain('**days_remaining:** 10')
  })
})

// ── batch_set_lore ────────────────────────────────────────────────────────────

describe('batch_set_lore', () => {
  it('writes multiple new keys and reports set_count', async () => {
    const res = await callTool('batch_set_lore', {
      entries: [
        { key: 'batch:alpha', text: 'Alpha content' },
        { key: 'batch:beta', text: 'Beta content' },
      ],
    })
    expect(res.result.metadata.total).toBe(2)
    expect(res.result.metadata.set_count).toBe(2)
    expect(res.result.metadata.failed_count).toBe(0)
    expect(res.result.content[0].text).toContain('Saved 2')
    expect(res.result.results['batch:alpha'].ok).toBe(true)
    expect(res.result.results['batch:beta'].ok).toBe(true)
  })

  it('entries are retrievable via get_lore after batch write', async () => {
    await callTool('batch_set_lore', {
      entries: [
        { key: 'batch:verify-a', text: 'Verify A' },
        { key: 'batch:verify-b', text: 'Verify B' },
      ],
    })
    const a = await callTool('get_lore', { query: 'batch:verify-a' })
    expect(a.result.content[0].text).toBe('Verify A')
    const b = await callTool('get_lore', { query: 'batch:verify-b' })
    expect(b.result.content[0].text).toBe('Verify B')
  })

  it('increments version when overwriting an existing key', async () => {
    await seedKV('batch:existing', 'original text')
    const res = await callTool('batch_set_lore', {
      entries: [{ key: 'batch:existing', text: 'updated text' }],
    })
    expect(res.result.results['batch:existing'].version).toBe(2)
    const get = await callTool('get_lore', { query: 'batch:existing' })
    expect(get.result.text).toBe('updated text')
  })

  it('pushes history for overwritten keys', async () => {
    await seedKV('batch:hist', 'v1 text')
    await callTool('batch_set_lore', { entries: [{ key: 'batch:hist', text: 'v2 text' }] })
    const restore = await callTool('restore_lore', { key: 'batch:hist' })
    expect(restore.result.metadata.restored).toBe(true)
    const get = await callTool('get_lore', { query: 'batch:hist' })
    expect(get.result.text).toBe('v1 text')
  })

  it('returns validation error for empty entries array', async () => {
    const res = await callTool('batch_set_lore', { entries: [] })
    expect(res.error).toBeDefined()
    expect(res.error.code).toBe(-32602)
  })

  it('normalizes keys to lowercase', async () => {
    await callTool('batch_set_lore', { entries: [{ key: 'Batch:UPPER', text: 'lower key test' }] })
    const get = await callTool('get_lore', { query: 'batch:upper' })
    expect(get.result.content[0].text).toBe('lower key test')
  })
})

// ── batch_mutate ──────────────────────────────────────────────────────────────

describe('batch_mutate', () => {
  it('applies an increment mutation and returns old/new values', async () => {
    await seedKV('mutate:counter', '**days_remaining:** 10\n**status:** active')
    const res = await callTool('batch_mutate', {
      mutations: [{ key: 'mutate:counter', action: 'increment', field_path: 'days_remaining', increment: -1, reason: 'test-decrement' }],
    })
    expect(res.result.metadata.ok_count).toBe(1)
    expect(res.result.metadata.failed_count).toBe(0)
    expect(res.result.results[0].ok).toBe(true)
    expect(res.result.results[0].old_value).toBe(10)
    expect(res.result.results[0].new_value).toBe(9)
  })

  it('increment is reflected in KV', async () => {
    await seedKV('mutate:kv-check', '**days_remaining:** 5')
    await callTool('batch_mutate', {
      mutations: [{ key: 'mutate:kv-check', action: 'increment', field_path: 'days_remaining', increment: -2 }],
    })
    const get = await callTool('get_lore', { query: 'mutate:kv-check' })
    expect(get.result.text).toContain('**days_remaining:** 3')
  })

  it('applies a patch replace mutation', async () => {
    await seedKV('mutate:patch-test', 'Status: Alive\nNotes: none')
    const res = await callTool('batch_mutate', {
      mutations: [{ key: 'mutate:patch-test', action: 'patch', operation: 'replace', target: 'Status: Alive', value: 'Status: Sedated' }],
    })
    expect(res.result.results[0].ok).toBe(true)
    const get = await callTool('get_lore', { query: 'mutate:patch-test' })
    expect(get.result.text).toContain('Status: Sedated')
    expect(get.result.text).not.toContain('Status: Alive')
  })

  it('applies a patch append mutation', async () => {
    await seedKV('mutate:append-test', 'Line 1')
    await callTool('batch_mutate', {
      mutations: [{ key: 'mutate:append-test', action: 'patch', operation: 'append', value: '\nLine 2' }],
    })
    const get = await callTool('get_lore', { query: 'mutate:append-test' })
    expect(get.result.text).toContain('Line 2')
  })

  it('applies two mutations to the same key sequentially', async () => {
    await seedKV('mutate:double', 'Status: Alive\n**count:** 5')
    const res = await callTool('batch_mutate', {
      mutations: [
        { key: 'mutate:double', action: 'patch', operation: 'replace', target: 'Status: Alive', value: 'Status: Sedated' },
        { key: 'mutate:double', action: 'increment', field_path: 'count', increment: -1 },
      ],
    })
    expect(res.result.metadata.ok_count).toBe(2)
    const get = await callTool('get_lore', { query: 'mutate:double' })
    expect(get.result.text).toContain('Status: Sedated')
    expect(get.result.text).toContain('**count:** 4')
  })

  it('reports failure for missing key', async () => {
    const res = await callTool('batch_mutate', {
      mutations: [{ key: 'nonexistent:key-99999', action: 'increment', field_path: 'days_remaining' }],
    })
    expect(res.result.results[0].ok).toBe(false)
    expect(res.result.results[0].message).toContain('not found')
    expect(res.result.metadata.failed_count).toBe(1)
  })

  it('reports failure for non-numeric increment field', async () => {
    await seedKV('mutate:non-numeric', '**status:** active')
    const res = await callTool('batch_mutate', {
      mutations: [{ key: 'mutate:non-numeric', action: 'increment', field_path: 'status' }],
    })
    expect(res.result.results[0].ok).toBe(false)
    expect(res.result.results[0].message).toContain('not numeric')
  })

  it('reports failure for ambiguous patch target', async () => {
    await seedKV('mutate:ambig', 'cat cat cat')
    const res = await callTool('batch_mutate', {
      mutations: [{ key: 'mutate:ambig', action: 'patch', operation: 'replace', target: 'cat', value: 'dog' }],
    })
    expect(res.result.results[0].ok).toBe(false)
    expect(res.result.results[0].message).toContain('ambiguous')
  })

  it('continues applying remaining mutations after a failure', async () => {
    await seedKV('mutate:mixed', 'Status: Alive')
    const res = await callTool('batch_mutate', {
      mutations: [
        { key: 'nonexistent:missing', action: 'increment', field_path: 'x' },
        { key: 'mutate:mixed', action: 'patch', operation: 'replace', target: 'Status: Alive', value: 'Status: Dead' },
      ],
    })
    expect(res.result.metadata.ok_count).toBe(1)
    expect(res.result.metadata.failed_count).toBe(1)
    const get = await callTool('get_lore', { query: 'mutate:mixed' })
    expect(get.result.text).toContain('Status: Dead')
  })

  it('returns validation error for empty mutations array', async () => {
    const res = await callTool('batch_mutate', { mutations: [] })
    expect(res.error).toBeDefined()
    expect(res.error.code).toBe(-32602)
  })

  it('pushes history for mutated keys', async () => {
    await seedKV('mutate:hist', 'Status: Alive')
    await callTool('batch_mutate', {
      mutations: [{ key: 'mutate:hist', action: 'patch', operation: 'replace', target: 'Status: Alive', value: 'Status: Dead' }],
    })
    const restore = await callTool('restore_lore', { key: 'mutate:hist' })
    expect(restore.result.metadata.restored).toBe(true)
    const get = await callTool('get_lore', { query: 'mutate:hist' })
    expect(get.result.text).toContain('Status: Alive')
  })
})

// ── batch_mutate — content text summary ───────────────────────────────────────

describe('batch_mutate — content[0].text summary', () => {
  it('reports "Applied N mutations." when all succeed', async () => {
    await seedKV('mutate:sum-alpha', 'Alpha batch content.')
    await seedKV('mutate:sum-beta', 'Beta batch content.')
    const res = await callTool('batch_mutate', {
      mutations: [
        { key: 'mutate:sum-alpha', action: 'patch', operation: 'replace', target: 'Alpha batch content.', value: 'Alpha mutated.' },
        { key: 'mutate:sum-beta', action: 'patch', operation: 'append', value: '\nAppended line.' },
      ],
    })
    expect(res.result.content[0].text).toContain('Applied 2')
    expect(res.result.metadata.ok_count).toBe(2)
    expect(res.result.metadata.failed_count).toBe(0)
  })

  it('reports "Applied X/Y mutations. N failed" on partial failure', async () => {
    await seedKV('mutate:sum-partial', 'Status: Alive')
    const res = await callTool('batch_mutate', {
      mutations: [
        { key: 'nonexistent:sum-missing', action: 'increment', field_path: 'days_remaining' },
        { key: 'mutate:sum-partial', action: 'patch', operation: 'replace', target: 'Status: Alive', value: 'Status: Dead' },
      ],
    })
    expect(res.result.content[0].text).toContain('Applied 1/2')
    expect(res.result.content[0].text).toContain('failed')
    expect(res.result.metadata.ok_count).toBe(1)
    expect(res.result.metadata.failed_count).toBe(1)
  })

  it('reports "Applied 1 mutation." (singular) when exactly one succeeds', async () => {
    await seedKV('mutate:sum-single', 'Note: initial')
    const res = await callTool('batch_mutate', {
      mutations: [
        { key: 'mutate:sum-single', action: 'patch', operation: 'replace', target: 'Note: initial', value: 'Note: updated' },
      ],
    })
    expect(res.result.content[0].text).toMatch(/Applied 1 mutation\./)
  })
})

// ── batch_set_lore + batch_mutate integration ─────────────────────────────────

describe('batch_set_lore + batch_mutate integration', () => {
  it('writes two entries then mutates both: replace on one, append on the other', async () => {
    const alphaKey = 'integration:batch-alpha'
    const betaKey = 'integration:batch-beta'

    const setRes = await callTool('batch_set_lore', {
      entries: [
        { key: alphaKey, text: 'Alpha batch content.' },
        { key: betaKey, text: 'Beta batch content.' },
      ],
    })
    expect(setRes.result.content[0].text).toContain('Saved 2')

    const alphaGet = await callTool('get_lore', { query: alphaKey })
    expect(alphaGet.result.content[0].text).toContain('Alpha batch content')

    const mutRes = await callTool('batch_mutate', {
      mutations: [
        { key: alphaKey, action: 'patch', operation: 'replace', target: 'Alpha batch content.', value: 'Alpha mutated.' },
        { key: betaKey, action: 'patch', operation: 'append', value: '\nAppended line.' },
      ],
    })
    expect(mutRes.result.content[0].text).toContain('Applied 2')
    expect(mutRes.result.metadata.ok_count).toBe(2)

    const alphaVerify = await callTool('get_lore', { query: alphaKey })
    expect(alphaVerify.result.content[0].text).toContain('Alpha mutated')
    expect(alphaVerify.result.content[0].text).not.toContain('Alpha batch content')

    const betaVerify = await callTool('get_lore', { query: betaKey })
    expect(betaVerify.result.content[0].text).toContain('Appended line')
  })
})

// ── append_to_section ─────────────────────────────────────────────────────────

describe('append_to_section', () => {
  it('appends to end of populated section (default position)', async () => {
    await seedKV('ats:populated', '## Personality\nCurious and kind.\n## Goals\nFind truth.')
    const res = await callTool('append_to_section', { key: 'ats:populated', section: 'Personality', text: 'Loyal to companions.' })
    expect(res.result.action).toBe('appended')
    expect(res.result.position).toBe('end')
    const get = await callTool('get_lore', { query: 'ats:populated' })
    expect(get.result.text).toContain('Curious and kind. Loyal to companions.')
    expect(get.result.text).toContain('## Goals\nFind truth.')
  })

  it('prepends to start of section', async () => {
    await seedKV('ats:prepend', '## Personality\nCurious and kind.\n## Goals\nFind truth.')
    const res = await callTool('append_to_section', { key: 'ats:prepend', section: 'Personality', text: 'A former novice. ', position: 'start' })
    expect(res.result.action).toBe('prepended')
    const get = await callTool('get_lore', { query: 'ats:prepend' })
    expect(get.result.text).toContain('A former novice. Curious and kind.')
  })

  it('replaced_empty action when section has no content', async () => {
    await seedKV('ats:empty-sec', '## Notes\n\n## Goals\nFind truth.')
    const res = await callTool('append_to_section', { key: 'ats:empty-sec', section: 'Notes', text: 'First observation.' })
    expect(res.result.action).toBe('replaced_empty')
    const get = await callTool('get_lore', { query: 'ats:empty-sec' })
    expect(get.result.text).toContain('## Notes\nFirst observation.')
  })

  it('creates section when not found and auto_create is true (default)', async () => {
    await seedKV('ats:create', '## Personality\nCurious.\n## Goals\nFind truth.')
    const res = await callTool('append_to_section', { key: 'ats:create', section: 'Inventory', text: 'rations×3' })
    expect(res.result.action).toBe('created')
    expect(res.result.warnings).toContain('section_created')
    const get = await callTool('get_lore', { query: 'ats:create' })
    expect(get.result.text).toContain('## Inventory\nrations×3')
  })

  it('returns section_not_found when auto_create is false and section missing', async () => {
    await seedKV('ats:no-create', '## Personality\nCurious.')
    const res = await callTool('append_to_section', { key: 'ats:no-create', section: 'Inventory', text: 'rations', auto_create: false })
    expect(res.result.error).toBe('section_not_found')
    expect(res.result.hint).toBeDefined()
  })

  it('targets first occurrence for duplicate section, adds duplicate_section warning', async () => {
    await seedKV('ats:dup', '## Notes\nFirst note.\n## Personality\nKind.\n## Notes\nSecond note.')
    const res = await callTool('append_to_section', { key: 'ats:dup', section: 'Notes', text: 'Additional.' })
    expect(res.result.warnings).toContain('duplicate_section')
    const text = (await callTool('get_lore', { query: 'ats:dup' })).result.text as string
    expect(text).toContain('First note.')
    expect(text).toContain('Additional.')
    // Second Notes section untouched
    const secondIdx = text.indexOf('## Notes', text.indexOf('## Notes') + 1)
    expect(text.slice(secondIdx)).toContain('Second note.')
    expect(text.slice(secondIdx)).not.toContain('Additional.')
  })

  it('handles last section running to EOF without trailing heading', async () => {
    await seedKV('ats:eof', '## Section A\nContent A\n## Section B\nContent B')
    const res = await callTool('append_to_section', { key: 'ats:eof', section: 'Section B', text: 'More B.' })
    expect(res.result.action).toBe('appended')
    const text = (await callTool('get_lore', { query: 'ats:eof' })).result.text as string
    expect(text).toContain('Content B')
    expect(text).toContain('More B.')
    expect(text).toContain('## Section A\nContent A')
  })

  it('text starting with newline inserts as new paragraph', async () => {
    await seedKV('ats:newpara', '## Notes\nLine one.\nLine two.')
    await callTool('append_to_section', { key: 'ats:newpara', section: 'Notes', text: '\n\nLine three.' })
    const text = (await callTool('get_lore', { query: 'ats:newpara' })).result.text as string
    expect(text).toContain('Line two.\n\nLine three.')
  })

  it('appending a single word adds a space between existing text and new text', async () => {
    await seedKV('ats:word', '## Personality\nBrave.')
    await callTool('append_to_section', { key: 'ats:word', section: 'Personality', text: 'Loyal.' })
    const text = (await callTool('get_lore', { query: 'ats:word' })).result.text as string
    expect(text).toContain('Brave. Loyal.')
  })

  it('empty text returns empty_text error without mutating entry', async () => {
    await seedKV('ats:empty-text', '## Personality\nCurious.')
    const res = await callTool('append_to_section', { key: 'ats:empty-text', section: 'Personality', text: '' })
    expect(res.result.error).toBe('empty_text')
    expect((await callTool('get_lore', { query: 'ats:empty-text' })).result.text).toBe('## Personality\nCurious.')
  })

  it('whitespace-only text returns empty_text error', async () => {
    await seedKV('ats:ws-text', '## Personality\nCurious.')
    const res = await callTool('append_to_section', { key: 'ats:ws-text', section: 'Personality', text: '   ' })
    expect(res.result.error).toBe('empty_text')
  })

  it('very long append succeeds without truncation', async () => {
    const longText = 'word '.repeat(2000).trim()
    await seedKV('ats:long', '## Notes\nFirst.')
    const res = await callTool('append_to_section', { key: 'ats:long', section: 'Notes', text: '\n' + longText })
    expect(res.result.action).toBe('appended')
    const text = (await callTool('get_lore', { query: 'ats:long' })).result.text as string
    expect(text.length).toBeGreaterThan(longText.length)
    expect(text).toContain('word word word')
  })

  it('section name with special characters (parens, hyphens) matches correctly', async () => {
    await seedKV('ats:special', '## Weight-1 (Predator Drive):\n0.85')
    const res = await callTool('append_to_section', { key: 'ats:special', section: 'Weight-1 (Predator Drive)', text: ' Updated: 0.90' })
    expect(res.result.action).toBe('appended')
    const text = (await callTool('get_lore', { query: 'ats:special' })).result.text as string
    expect(text).toContain('0.85 Updated: 0.90')
  })

  it('substring section name does not false-match longer name', async () => {
    await seedKV('ats:substr', '## Goals\nShort term.\n## Goals (Completed)\nDone.')
    await callTool('append_to_section', { key: 'ats:substr', section: 'Goals', text: ' New goal.' })
    const text = (await callTool('get_lore', { query: 'ats:substr' })).result.text as string
    expect(text).toContain('Short term. New goal.')
    expect(text).toContain('## Goals (Completed)\nDone.')
  })

  it('trailing colon on heading is stripped for matching', async () => {
    await seedKV('ats:colon', '## Personality:\nCurious.')
    const res = await callTool('append_to_section', { key: 'ats:colon', section: 'Personality', text: ' Loyal.' })
    expect(res.result.action).toBe('appended')
    expect((await callTool('get_lore', { query: 'ats:colon' })).result.text).toContain('Curious. Loyal.')
  })

  it('no ## headings + auto_create true creates section at end', async () => {
    await seedKV('ats:no-headings', 'Just a flat paragraph with no structure.')
    const res = await callTool('append_to_section', { key: 'ats:no-headings', section: 'Personality', text: 'Curious.', auto_create: true })
    expect(res.result.action).toBe('created')
    expect((await callTool('get_lore', { query: 'ats:no-headings' })).result.text).toContain('## Personality\nCurious.')
  })

  it('no ## headings + auto_create false returns section_not_found', async () => {
    await seedKV('ats:no-headings-nc', 'Just flat text.')
    const res = await callTool('append_to_section', { key: 'ats:no-headings-nc', section: 'Personality', text: 'Curious.', auto_create: false })
    expect(res.result.error).toBe('section_not_found')
  })

  it('unicode and emoji in section name match correctly', async () => {
    await seedKV('ats:unicode', "## État d'Esprit 😤\nFrustrated.")
    const res = await callTool('append_to_section', { key: 'ats:unicode', section: "État d'Esprit 😤", text: ' And hopeful.' })
    expect(res.result.action).toBe('appended')
    expect((await callTool('get_lore', { query: 'ats:unicode' })).result.text).toContain('Frustrated. And hopeful.')
  })

  it('text containing ## strings is stored as literal content, not parsed as section boundaries', async () => {
    await seedKV('ats:hash-in-text', '## Notes\nFirst note.')
    await callTool('append_to_section', { key: 'ats:hash-in-text', section: 'Notes', text: '\n## This is NOT a heading\nJust content.' })
    const text = (await callTool('get_lore', { query: 'ats:hash-in-text' })).result.text as string
    expect(text).toContain('## This is NOT a heading')
    expect(text).toContain('Just content.')
    expect(text.startsWith('## Notes\n')).toBe(true)
  })

  it('non-existent key returns key_not_found error', async () => {
    const res = await callTool('append_to_section', { key: 'character:does-not-exist-ats-99999', section: 'Personality', text: 'Text.' })
    expect(res.result.error).toBe('key_not_found')
  })

  it('consecutive appends accumulate correctly (no stale-cache issue)', async () => {
    await seedKV('ats:consec', '## Notes\nFirst.')
    await callTool('append_to_section', { key: 'ats:consec', section: 'Notes', text: ' Second.' })
    await callTool('append_to_section', { key: 'ats:consec', section: 'Notes', text: ' Third.' })
    expect((await callTool('get_lore', { query: 'ats:consec' })).result.text).toContain('First. Second. Third.')
  })

  it('auto-created section is placed after all existing content including trailing loose text', async () => {
    await seedKV('ats:trailing', '## Section A\nContent.\n\nTrailing loose text without a heading.')
    const res = await callTool('append_to_section', { key: 'ats:trailing', section: 'NewSection', text: 'New content.' })
    expect(res.result.action).toBe('created')
    const text = (await callTool('get_lore', { query: 'ats:trailing' })).result.text as string
    expect(text).toContain('Trailing loose text without a heading.')
    expect(text).toContain('## NewSection\nNew content.')
    expect(text.indexOf('## NewSection')).toBeGreaterThan(text.indexOf('Trailing loose text'))
  })

  it('response shape has key, section, action, position, new_version, bytes_added, warnings', async () => {
    await seedKV('ats:shape', '## Notes\nExisting.')
    const res = await callTool('append_to_section', { key: 'ats:shape', section: 'Notes', text: ' More.' })
    expect(res.result.key).toBe('ats:shape')
    expect(res.result.section).toBe('Notes')
    expect(res.result.action).toBe('appended')
    expect(res.result.position).toBe('end')
    expect(res.result.new_version).toBe(2)
    expect(typeof res.result.bytes_added).toBe('number')
    expect(res.result.bytes_added).toBeGreaterThan(0)
    expect(Array.isArray(res.result.warnings)).toBe(true)
  })

  it('mutation is reversible via restore_lore', async () => {
    await seedKV('ats:restore', '## Notes\nOriginal content.')
    await callTool('append_to_section', { key: 'ats:restore', section: 'Notes', text: ' Appended.' })
    await callTool('restore_lore', { key: 'ats:restore' })
    expect((await callTool('get_lore', { query: 'ats:restore' })).result.text).toBe('## Notes\nOriginal content.')
  })
})

// ── move_entity ───────────────────────────────────────────────────────────────

describe('move_entity', () => {
  it('updates Location field and returns success', async () => {
    await seedKV('character:traveler', '**Location:** location:old-town\n**Status:** Active')
    const res = await callTool('move_entity', { entity_key: 'character:traveler', new_location_key: 'location:new-city' })
    expect(res.error).toBeUndefined()
    expect(res.result.metadata.new_location).toBe('location:new-city')
    const lore = await callTool('get_lore', { query: 'character:traveler' })
    expect(lore.result.text).toContain('location:new-city')
    expect(lore.result.text).not.toContain('location:old-town')
  })

  it('updates location indexes so get_location_occupants reflects the move', async () => {
    await seedKV('character:mover', '**Location:** location:room-a\n**Status:** Active')
    await callTool('move_entity', { entity_key: 'character:mover', new_location_key: 'location:room-b' })
    const oldLoc = await callTool('get_location_occupants', { location_key: 'location:room-a' })
    expect(oldLoc.result.occupants).toHaveLength(0)
    const newLoc = await callTool('get_location_occupants', { location_key: 'location:room-b' })
    expect(newLoc.result.occupants.map((o: { key: string }) => o.key)).toContain('character:mover')
  })

  it('pushes history before writing', async () => {
    await seedKV('character:hist-mover', '**Location:** location:start\n**Status:** Active')
    await callTool('move_entity', { entity_key: 'character:hist-mover', new_location_key: 'location:end' })
    const restore = await callTool('restore_lore', { key: 'character:hist-mover' })
    expect(restore.result.metadata.restored).toBe(true)
    const lore = await callTool('get_lore', { query: 'character:hist-mover' })
    expect(lore.result.text).toContain('location:start')
  })

  it('returns error for nonexistent entity', async () => {
    const res = await callTool('move_entity', { entity_key: 'character:ghost-9999', new_location_key: 'location:void' })
    expect(res.error).toBeDefined()
    expect(res.error.code).toBe(-32602)
  })
})
