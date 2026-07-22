import {
  describe,
  rpc,
  callTool,
  callToolWithApiKey,
  seedKV,
  ADMIN_SECRET,
  parseEncounterTable,
} from './support/helpers'
import { SELF, env } from 'cloudflare:test'
import { expect, it, beforeEach } from 'vitest'

describe('get_lore_section', () => {
  it('exact match returns section content', async () => {
    await seedKV('section:basic', '## Personality\nCurious and kind.\n## Goals\nFind the truth.')
    const res = await callTool('lore_manage', {
      action: 'get_section',
      key: 'section:basic',
      sections: ['Personality'],
    })
    expect(res.error).toBeUndefined()
    expect(res.result.sections['Personality']).toBe('Curious and kind.')
    expect(res.result.not_found).toEqual([])
  })

  it('case-insensitive match in loose mode', async () => {
    await seedKV('section:case', '## PERSONALITY\nCurious and kind.')
    const res = await callTool('lore_manage', {
      action: 'get_section',
      key: 'section:case',
      sections: ['personality'],
    })
    expect(res.result.sections['personality']).toBe('Curious and kind.')
  })

  it('trailing colon stripped in loose mode', async () => {
    await seedKV('section:colon', '## Personality:\nCurious.')
    const res = await callTool('lore_manage', {
      action: 'get_section',
      key: 'section:colon',
      sections: ['Personality'],
    })
    expect(res.result.sections['Personality']).toBe('Curious.')
  })

  it('whitespace collapsed in loose mode', async () => {
    await seedKV('section:spaces', '##   Physical   Profile  \nBroad-shouldered.')
    const res = await callTool('lore_manage', {
      action: 'get_section',
      key: 'section:spaces',
      sections: ['Physical Profile'],
    })
    expect(res.result.sections['Physical Profile']).toBe('Broad-shouldered.')
  })

  it('not_found lists missing sections', async () => {
    await seedKV('section:missing', '## Personality\nCurious.')
    const res = await callTool('lore_manage', {
      action: 'get_section',
      key: 'section:missing',
      sections: ['Inventory'],
    })
    expect(res.result.sections).toEqual({})
    expect(res.result.not_found).toEqual(['Inventory'])
  })

  it('empty section returns empty string and empty_section warning', async () => {
    await seedKV('section:empty', '## Personality\n\n## Goals\nBecome stronger.')
    const res = await callTool('lore_manage', {
      action: 'get_section',
      key: 'section:empty',
      sections: ['Personality'],
    })
    expect(res.result.sections['Personality']).toBe('')
    expect(res.result.warnings.some((w: string) => w.includes('empty_section'))).toBe(true)
  })

  it('no ## headings: returns not_found and no_sections_found warning', async () => {
    await seedKV('section:flat', 'This is just a paragraph of text with no structure.')
    const res = await callTool('lore_manage', {
      action: 'get_section',
      key: 'section:flat',
      sections: ['Personality'],
    })
    expect(res.result.sections).toEqual({})
    expect(res.result.warnings).toContain('no_sections_found')
    expect(res.result.not_found).toContain('Personality')
  })

  it('fallback to # headings when no ## headings exist', async () => {
    await seedKV('section:single-hash', '# Title\nSome preamble.\n# Another\nMore text.')
    const res = await callTool('lore_manage', {
      action: 'get_section',
      key: 'section:single-hash',
      sections: ['Title'],
    })
    expect(res.result.sections['Title']).toBe('Some preamble.')
  })

  it('### headings are section boundaries alongside ## headings', async () => {
    await seedKV(
      'section:sub',
      '## Personality\n### Strengths\nBrave.\n### Weaknesses\nImpulsive.\n## Goals\nGo home.',
    )
    const res = await callTool('lore_manage', {
      action: 'get_section',
      key: 'section:sub',
      sections: ['Strengths', 'Weaknesses', 'Goals'],
    })
    expect(res.result.sections['Strengths']).toBe('Brave.')
    expect(res.result.sections['Weaknesses']).toBe('Impulsive.')
    expect(res.result.sections['Goals']).toBe('Go home.')
  })

  it('special characters in section name match exactly', async () => {
    await seedKV('section:special', '## Weight-1 (Predator Drive):\n0.85')
    const res = await callTool('lore_manage', {
      action: 'get_section',
      key: 'section:special',
      sections: ['Weight-1 (Predator Drive)'],
    })
    expect(res.result.sections['Weight-1 (Predator Drive)']).toContain('0.85')
  })

  it('substring does not cause false match (Goals vs Goals (Completed))', async () => {
    await seedKV('section:substring', '## Goals\nShort term.\n## Goals (Completed)\nDone.')
    const res = await callTool('lore_manage', {
      action: 'get_section',
      key: 'section:substring',
      sections: ['Goals'],
    })
    expect(res.result.sections['Goals']).toBe('Short term.')
    expect(res.result.sections['Goals (Completed)']).toBeUndefined()
  })

  it('last section runs to EOF correctly', async () => {
    await seedKV('section:last', '## Section A\nContent A\n## Section B\nContent B')
    const res = await callTool('lore_manage', {
      action: 'get_section',
      key: 'section:last',
      sections: ['Section B'],
    })
    expect(res.result.sections['Section B']).toBe('Content B')
  })

  it('duplicate section: first non-empty wins, duplicate_section warning added', async () => {
    await seedKV(
      'section:dup',
      '## Notes\nFirst note.\n## Personality\nKind.\n## Notes\nSecond note.',
    )
    const res = await callTool('lore_manage', {
      action: 'get_section',
      key: 'section:dup',
      sections: ['Notes'],
    })
    expect(res.result.sections['Notes']).toBe('First note.')
    expect(res.result.warnings.some((w: string) => w.includes('duplicate_section'))).toBe(true)
  })

  it('duplicate section: skips empty first occurrence, returns first non-empty, no empty_section warning', async () => {
    await seedKV(
      'section:dup-empty-first',
      '## Notes\n## Personality\nKind.\n## Notes\nSecond note.',
    )
    const res = await callTool('lore_manage', {
      action: 'get_section',
      key: 'section:dup-empty-first',
      sections: ['Notes'],
    })
    expect(res.result.sections['Notes']).toBe('Second note.')
    expect(res.result.warnings.some((w: string) => w.includes('duplicate_section'))).toBe(true)
    expect(res.result.warnings.some((w: string) => w.includes('empty_section'))).toBe(false)
  })

  it('duplicate section: all empty → returns "", warns both duplicate_section and empty_section', async () => {
    await seedKV('section:dup-all-empty', '## Notes\n## Notes\n## Personality\nKind.')
    const res = await callTool('lore_manage', {
      action: 'get_section',
      key: 'section:dup-all-empty',
      sections: ['Notes'],
    })
    expect(res.result.sections['Notes']).toBe('')
    expect(res.result.warnings.some((w: string) => w.includes('duplicate_section'))).toBe(true)
    expect(res.result.warnings.some((w: string) => w.includes('empty_section'))).toBe(true)
  })

  it('zero sections requested: sections={}, not_found=[], no_sections_requested warning', async () => {
    await seedKV('section:zero', '## Personality\nCurious.')
    const res = await callTool('lore_manage', {
      action: 'get_section',
      key: 'section:zero',
      sections: [],
    })
    expect(res.result.sections).toEqual({})
    expect(res.result.not_found).toEqual([])
    expect(res.result.warnings).toContain('no_sections_requested')
  })

  it('unicode and emoji in section name', async () => {
    await seedKV('section:unicode', "## État d'Esprit 😤\nFrustrated and hopeful.")
    const res = await callTool('lore_manage', {
      action: 'get_section',
      key: 'section:unicode',
      sections: ["État d'Esprit 😤"],
    })
    expect(res.result.sections["État d'Esprit 😤"]).toContain('Frustrated and hopeful')
  })

  it('non-existent key returns key_not_found error in result', async () => {
    const res = await callTool('lore_manage', {
      action: 'get_section',
      key: 'character:does-not-exist-99999',
      sections: ['Personality'],
    })
    expect(res.error).toBeUndefined()
    expect(res.result.error).toBe('key_not_found')
    expect(res.result.key).toBe('character:does-not-exist-99999')
  })

  it('consecutive empty sections both get empty_section warnings', async () => {
    await seedKV(
      'section:consecutive',
      '## Section A\n## Section B\n## Section C\nReal content at last.',
    )
    const res = await callTool('lore_manage', {
      action: 'get_section',
      key: 'section:consecutive',
      sections: ['Section A', 'Section B', 'Section C'],
    })
    expect(res.result.sections['Section A']).toBe('')
    expect(res.result.sections['Section B']).toBe('')
    expect(res.result.sections['Section C']).toBe('Real content at last.')
    const emptyWarnings = (res.result.warnings as string[]).filter((w) =>
      w.includes('empty_section'),
    )
    expect(emptyWarnings).toHaveLength(2)
  })

  it('mixed request: found sections returned, missing in not_found', async () => {
    await seedKV('section:mixed', '## Personality\nCurious.\n## Goals\nFind truth.')
    const res = await callTool('lore_manage', {
      action: 'get_section',
      key: 'section:mixed',
      sections: ['Personality', 'Inventory', 'Goals'],
    })
    expect(res.result.sections['Personality']).toBe('Curious.')
    expect(res.result.sections['Goals']).toBe('Find truth.')
    expect(res.result.not_found).toEqual(['Inventory'])
  })

  it('very long section returns full content without truncation', async () => {
    const longContent = 'Very long content. '.repeat(5000)
    await seedKV('section:long', `## Notes\n${longContent}\n## End\nDone.`)
    const res = await callTool('lore_manage', {
      action: 'get_section',
      key: 'section:long',
      sections: ['Notes'],
    })
    expect((res.result.sections['Notes'] as string).length).toBeGreaterThan(50000)
    expect(res.result.sections['Notes']).not.toContain('Done.')
  })

  it('mixed # and ## headings: both are boundaries, sections accessible at any level', async () => {
    await seedKV(
      'section:mixed-hash',
      '# Title Block\nSome preamble text.\n\n## Section A\nContent.',
    )
    const res = await callTool('lore_manage', {
      action: 'get_section',
      key: 'section:mixed-hash',
      sections: ['Section A', 'Title Block'],
    })
    expect(res.result.sections['Section A']).toBe('Content.')
    expect(res.result.sections['Title Block']).toBe('Some preamble text.')
    expect(res.result.not_found).not.toContain('Section A')
  })

  it('strict mode does not strip trailing colon', async () => {
    await seedKV('section:strict', '## Personality:\nCurious.')
    const res = await callTool('lore_manage', {
      action: 'get_section',
      key: 'section:strict',
      sections: ['Personality'],
      mode: 'strict',
    })
    // In strict mode, "Personality" does NOT match "Personality:" — colon is not stripped
    expect(res.result.not_found).toContain('Personality')
  })

  it('strict mode matches when heading and request are identical (case-insensitive)', async () => {
    await seedKV('section:strict-match', '## Personality\nCurious.')
    const res = await callTool('lore_manage', {
      action: 'get_section',
      key: 'section:strict-match',
      sections: ['PERSONALITY'],
      mode: 'strict',
    })
    expect(res.result.sections['PERSONALITY']).toBe('Curious.')
  })

  it('result includes version from lore metadata', async () => {
    await seedKV('section:version', '## Notes\nSome notes.')
    const res = await callTool('lore_manage', {
      action: 'get_section',
      key: 'section:version',
      sections: ['Notes'],
    })
    expect(res.result.version).toBe(1)
  })

  it('result includes key', async () => {
    await seedKV('section:key-check', '## Notes\nSome notes.')
    const res = await callTool('lore_manage', {
      action: 'get_section',
      key: 'section:key-check',
      sections: ['Notes'],
    })
    expect(res.result.key).toBe('section:key-check')
  })

  it('suggestions: synonym match for Personality → Psychological Profile', async () => {
    await seedKV(
      'section:syn-test',
      '## Psychological Profile\nKind and curious.\n## Goals\nFind truth.',
    )
    const res = await callTool('lore_manage', {
      action: 'get_section',
      key: 'section:syn-test',
      sections: ['Personality'],
    })
    expect(res.result.sections['Personality']).toBeUndefined()
    expect(res.result.not_found).toContain('Personality')
    expect(res.result.suggestions['Personality']).toBeDefined()
    expect(res.result.suggestions['Personality']).toContain('psychological profile')
  })

  it('suggestions: Levenshtein distance for typos (Backgrond → Background)', async () => {
    await seedKV('section:typo-test', '## Background\nOrigins and heritage.\n## Goals\nFind truth.')
    const res = await callTool('lore_manage', {
      action: 'get_section',
      key: 'section:typo-test',
      sections: ['Backgrond'],
    })
    expect(res.result.sections['Backgrond']).toBeUndefined()
    expect(res.result.not_found).toContain('Backgrond')
    expect(res.result.suggestions['Backgrond']).toBeDefined()
    expect(res.result.suggestions['Backgrond'][0]).toBe('background')
  })

  it('suggestions: Goals → Objectives synonym', async () => {
    await seedKV('section:goals-syn', '## Objectives\nTo learn and grow.\n## Personality\nCurious.')
    const res = await callTool('lore_manage', {
      action: 'get_section',
      key: 'section:goals-syn',
      sections: ['Goals'],
    })
    expect(res.result.not_found).toContain('Goals')
    expect(res.result.suggestions['Goals']).toContain('objectives')
  })

  it('suggestions: Appearance → Physical Description synonym', async () => {
    await seedKV('section:appear-syn', '## Physical Description\nTall and lean.\n## Notes\nWary.')
    const res = await callTool('lore_manage', {
      action: 'get_section',
      key: 'section:appear-syn',
      sections: ['Appearance'],
    })
    expect(res.result.suggestions['Appearance']).toContain('physical description')
  })

  it('suggestions: empty array when no close matches', async () => {
    await seedKV('section:no-match', '## Personality\nKind.\n## Goals\nGrow.')
    const res = await callTool('lore_manage', {
      action: 'get_section',
      key: 'section:no-match',
      sections: ['Xyzzy'],
    })
    expect(res.result.suggestions['Xyzzy']).toBeDefined()
    expect(Array.isArray(res.result.suggestions['Xyzzy'])).toBe(true)
  })

  it('suggestions: limits to top 3 closest matches by Levenshtein', async () => {
    await seedKV(
      'section:many',
      '## Personality\nA\n## Personalityb\nB\n## Personality123\nC\n## Goals\nD\n## Personalityxyz\nE',
    )
    const res = await callTool('lore_manage', {
      action: 'get_section',
      key: 'section:many',
      sections: ['Personalitya'],
    })
    expect(res.result.suggestions['Personalitya'].length).toBeLessThanOrEqual(3)
  })

  it('suggestions: complex Levenshtein matching with multiple typos', async () => {
    await seedKV(
      'section:typo-complex',
      '## Background\nOrigins.\n## Personality\nKind.\n## Appearance\nTall.',
    )
    // Request with multiple typos: "Backgrond" (missing 'u'), should match "Background"
    const res = await callTool('lore_manage', {
      action: 'get_section',
      key: 'section:typo-complex',
      sections: ['Backgrond', 'Persnaolity', 'Apearance'],
    })
    expect(res.result.suggestions['Backgrond']).toBeDefined()
    expect(res.result.suggestions['Backgrond'][0]).toBe('background')
    expect(res.result.suggestions['Persnaolity']).toBeDefined()
    expect(res.result.suggestions['Persnaolity'][0]).toBe('personality')
    expect(res.result.suggestions['Apearance']).toBeDefined()
    expect(res.result.suggestions['Apearance'][0]).toBe('appearance')
  })

  it('suggestions: exercises all paths in Levenshtein for full coverage', async () => {
    await seedKV('section:leven', '## Test\nA\n## Testing\nB\n## Tests\nC')
    // Request sections with varying edit distances to exercise all Levenshtein loops
    const res = await callTool('lore_manage', {
      action: 'get_section',
      key: 'section:leven',
      sections: ['Tst', 'Testin', 'Testings'],
    })
    // All should find suggestions via Levenshtein (lines 246-258 in lore.ts)
    expect(res.result.suggestions['Tst'].length).toBeGreaterThan(0)
    expect(res.result.suggestions['Testin'].length).toBeGreaterThan(0)
    expect(res.result.suggestions['Testings'].length).toBeGreaterThan(0)
  })
})

describe('append_to_section', () => {
  it('appends to end of populated section (default position)', async () => {
    await seedKV('ats:populated', '## Personality\nCurious and kind.\n## Goals\nFind truth.')
    const res = await callTool('lore_manage', {
      action: 'append_section',
      key: 'ats:populated',
      section: 'Personality',
      text: 'Loyal to companions.',
    })
    expect(res.result.action).toBe('appended')
    expect(res.result.position).toBe('end')
    const get = await callTool('lore_manage', { action: 'get', query: 'ats:populated' })
    expect(get.result.text).toContain('Curious and kind. Loyal to companions.')
    expect(get.result.text).toContain('## Goals\nFind truth.')
  })

  it('prepends to start of section', async () => {
    await seedKV('ats:prepend', '## Personality\nCurious and kind.\n## Goals\nFind truth.')
    const res = await callTool('lore_manage', {
      action: 'append_section',
      key: 'ats:prepend',
      section: 'Personality',
      text: 'A former novice. ',
      position: 'start',
    })
    expect(res.result.action).toBe('prepended')
    const get = await callTool('lore_manage', { action: 'get', query: 'ats:prepend' })
    expect(get.result.text).toContain('A former novice. Curious and kind.')
  })

  it('replaced_empty action when section has no content', async () => {
    await seedKV('ats:empty-sec', '## Notes\n\n## Goals\nFind truth.')
    const res = await callTool('lore_manage', {
      action: 'append_section',
      key: 'ats:empty-sec',
      section: 'Notes',
      text: 'First observation.',
    })
    expect(res.result.action).toBe('replaced_empty')
    const get = await callTool('lore_manage', { action: 'get', query: 'ats:empty-sec' })
    expect(get.result.text).toContain('## Notes\nFirst observation.')
  })

  it('creates section when not found and auto_create is true (default)', async () => {
    await seedKV('ats:create', '## Personality\nCurious.\n## Goals\nFind truth.')
    const res = await callTool('lore_manage', {
      action: 'append_section',
      key: 'ats:create',
      section: 'Inventory',
      text: 'rations×3',
    })
    expect(res.result.action).toBe('created')
    expect(res.result.warnings).toContain('section_created')
    const get = await callTool('lore_manage', { action: 'get', query: 'ats:create' })
    expect(get.result.text).toContain('## Inventory\nrations×3')
  })

  it('returns section_not_found when auto_create is false and section missing', async () => {
    await seedKV('ats:no-create', '## Personality\nCurious.')
    const res = await callTool('lore_manage', {
      action: 'append_section',
      key: 'ats:no-create',
      section: 'Inventory',
      text: 'rations',
      auto_create: false,
    })
    expect(res.result.error).toBe('section_not_found')
    expect(res.result.hint).toBeDefined()
  })

  it('targets first occurrence for duplicate section, adds duplicate_section warning', async () => {
    await seedKV('ats:dup', '## Notes\nFirst note.\n## Personality\nKind.\n## Notes\nSecond note.')
    const res = await callTool('lore_manage', {
      action: 'append_section',
      key: 'ats:dup',
      section: 'Notes',
      text: 'Additional.',
    })
    expect(res.result.warnings).toContain('duplicate_section')
    const text = (await callTool('lore_manage', { action: 'get', query: 'ats:dup' })).result
      .text as string
    expect(text).toContain('First note.')
    expect(text).toContain('Additional.')
    // Second Notes section untouched
    const secondIdx = text.indexOf('## Notes', text.indexOf('## Notes') + 1)
    expect(text.slice(secondIdx)).toContain('Second note.')
    expect(text.slice(secondIdx)).not.toContain('Additional.')
  })

  it('handles last section running to EOF without trailing heading', async () => {
    await seedKV('ats:eof', '## Section A\nContent A\n## Section B\nContent B')
    const res = await callTool('lore_manage', {
      action: 'append_section',
      key: 'ats:eof',
      section: 'Section B',
      text: 'More B.',
    })
    expect(res.result.action).toBe('appended')
    const text = (await callTool('lore_manage', { action: 'get', query: 'ats:eof' })).result
      .text as string
    expect(text).toContain('Content B')
    expect(text).toContain('More B.')
    expect(text).toContain('## Section A\nContent A')
  })

  it('text starting with newline inserts as new paragraph', async () => {
    await seedKV('ats:newpara', '## Notes\nLine one.\nLine two.')
    await callTool('lore_manage', {
      action: 'append_section',
      key: 'ats:newpara',
      section: 'Notes',
      text: '\n\nLine three.',
    })
    const text = (await callTool('lore_manage', { action: 'get', query: 'ats:newpara' })).result
      .text as string
    expect(text).toContain('Line two.\n\nLine three.')
  })

  it('appending a single word adds a space between existing text and new text', async () => {
    await seedKV('ats:word', '## Personality\nBrave.')
    await callTool('lore_manage', {
      action: 'append_section',
      key: 'ats:word',
      section: 'Personality',
      text: 'Loyal.',
    })
    const text = (await callTool('lore_manage', { action: 'get', query: 'ats:word' })).result
      .text as string
    expect(text).toContain('Brave. Loyal.')
  })

  it('empty text returns empty_text error without mutating entry', async () => {
    await seedKV('ats:empty-text', '## Personality\nCurious.')
    const res = await callTool('lore_manage', {
      action: 'append_section',
      key: 'ats:empty-text',
      section: 'Personality',
      text: '',
    })
    expect(res.result.error).toBe('empty_text')
    expect(
      (await callTool('lore_manage', { action: 'get', query: 'ats:empty-text' })).result.text,
    ).toBe('## Personality\nCurious.')
  })

  it('whitespace-only text returns empty_text error', async () => {
    await seedKV('ats:ws-text', '## Personality\nCurious.')
    const res = await callTool('lore_manage', {
      action: 'append_section',
      key: 'ats:ws-text',
      section: 'Personality',
      text: '   ',
    })
    expect(res.result.error).toBe('empty_text')
  })

  it('very long append succeeds without truncation', async () => {
    const longText = 'word '.repeat(2000).trim()
    await seedKV('ats:long', '## Notes\nFirst.')
    const res = await callTool('lore_manage', {
      action: 'append_section',
      key: 'ats:long',
      section: 'Notes',
      text: '\n' + longText,
    })
    expect(res.result.action).toBe('appended')
    const text = (await callTool('lore_manage', { action: 'get', query: 'ats:long' })).result
      .text as string
    expect(text.length).toBeGreaterThan(longText.length)
    expect(text).toContain('word word word')
  })

  it('section name with special characters (parens, hyphens) matches correctly', async () => {
    await seedKV('ats:special', '## Weight-1 (Predator Drive):\n0.85')
    const res = await callTool('lore_manage', {
      action: 'append_section',
      key: 'ats:special',
      section: 'Weight-1 (Predator Drive)',
      text: ' Updated: 0.90',
    })
    expect(res.result.action).toBe('appended')
    const text = (await callTool('lore_manage', { action: 'get', query: 'ats:special' })).result
      .text as string
    expect(text).toContain('0.85 Updated: 0.90')
  })

  it('substring section name does not false-match longer name', async () => {
    await seedKV('ats:substr', '## Goals\nShort term.\n## Goals (Completed)\nDone.')
    await callTool('lore_manage', {
      action: 'append_section',
      key: 'ats:substr',
      section: 'Goals',
      text: ' New goal.',
    })
    const text = (await callTool('lore_manage', { action: 'get', query: 'ats:substr' })).result
      .text as string
    expect(text).toContain('Short term. New goal.')
    expect(text).toContain('## Goals (Completed)\nDone.')
  })

  it('trailing colon on heading is stripped for matching', async () => {
    await seedKV('ats:colon', '## Personality:\nCurious.')
    const res = await callTool('lore_manage', {
      action: 'append_section',
      key: 'ats:colon',
      section: 'Personality',
      text: ' Loyal.',
    })
    expect(res.result.action).toBe('appended')
    expect(
      (await callTool('lore_manage', { action: 'get', query: 'ats:colon' })).result.text,
    ).toContain('Curious. Loyal.')
  })

  it('no ## headings + auto_create true creates section at end', async () => {
    await seedKV('ats:no-headings', 'Just a flat paragraph with no structure.')
    const res = await callTool('lore_manage', {
      action: 'append_section',
      key: 'ats:no-headings',
      section: 'Personality',
      text: 'Curious.',
      auto_create: true,
    })
    expect(res.result.action).toBe('created')
    expect(
      (await callTool('lore_manage', { action: 'get', query: 'ats:no-headings' })).result.text,
    ).toContain('## Personality\nCurious.')
  })

  it('no ## headings + auto_create false returns section_not_found', async () => {
    await seedKV('ats:no-headings-nc', 'Just flat text.')
    const res = await callTool('lore_manage', {
      action: 'append_section',
      key: 'ats:no-headings-nc',
      section: 'Personality',
      text: 'Curious.',
      auto_create: false,
    })
    expect(res.result.error).toBe('section_not_found')
  })

  it('unicode and emoji in section name match correctly', async () => {
    await seedKV('ats:unicode', "## État d'Esprit 😤\nFrustrated.")
    const res = await callTool('lore_manage', {
      action: 'append_section',
      key: 'ats:unicode',
      section: "État d'Esprit 😤",
      text: ' And hopeful.',
    })
    expect(res.result.action).toBe('appended')
    expect(
      (await callTool('lore_manage', { action: 'get', query: 'ats:unicode' })).result.text,
    ).toContain('Frustrated. And hopeful.')
  })

  it('text containing ## strings is stored as literal content, not parsed as section boundaries', async () => {
    await seedKV('ats:hash-in-text', '## Notes\nFirst note.')
    await callTool('lore_manage', {
      action: 'append_section',
      key: 'ats:hash-in-text',
      section: 'Notes',
      text: '\n## This is NOT a heading\nJust content.',
    })
    const text = (await callTool('lore_manage', { action: 'get', query: 'ats:hash-in-text' }))
      .result.text as string
    expect(text).toContain('## This is NOT a heading')
    expect(text).toContain('Just content.')
    expect(text.startsWith('## Notes\n')).toBe(true)
  })

  it('non-existent key returns key_not_found error', async () => {
    const res = await callTool('lore_manage', {
      action: 'append_section',
      key: 'character:does-not-exist-ats-99999',
      section: 'Personality',
      text: 'Text.',
    })
    expect(res.result.error).toBe('key_not_found')
  })

  it('consecutive appends accumulate correctly (no stale-cache issue)', async () => {
    await seedKV('ats:consec', '## Notes\nFirst.')
    await callTool('lore_manage', {
      action: 'append_section',
      key: 'ats:consec',
      section: 'Notes',
      text: ' Second.',
    })
    await callTool('lore_manage', {
      action: 'append_section',
      key: 'ats:consec',
      section: 'Notes',
      text: ' Third.',
    })
    expect(
      (await callTool('lore_manage', { action: 'get', query: 'ats:consec' })).result.text,
    ).toContain('First. Second. Third.')
  })

  it('auto-created section is placed after all existing content including trailing loose text', async () => {
    await seedKV('ats:trailing', '## Section A\nContent.\n\nTrailing loose text without a heading.')
    const res = await callTool('lore_manage', {
      action: 'append_section',
      key: 'ats:trailing',
      section: 'NewSection',
      text: 'New content.',
    })
    expect(res.result.action).toBe('created')
    const text = (await callTool('lore_manage', { action: 'get', query: 'ats:trailing' })).result
      .text as string
    expect(text).toContain('Trailing loose text without a heading.')
    expect(text).toContain('## NewSection\nNew content.')
    expect(text.indexOf('## NewSection')).toBeGreaterThan(text.indexOf('Trailing loose text'))
  })

  it('response shape has key, section, action, position, new_version, bytes_added, warnings', async () => {
    await seedKV('ats:shape', '## Notes\nExisting.')
    const res = await callTool('lore_manage', {
      action: 'append_section',
      key: 'ats:shape',
      section: 'Notes',
      text: ' More.',
    })
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
    await callTool('lore_manage', {
      action: 'append_section',
      key: 'ats:restore',
      section: 'Notes',
      text: ' Appended.',
    })
    await callTool('lore_manage', { action: 'restore', key: 'ats:restore' })
    expect(
      (await callTool('lore_manage', { action: 'get', query: 'ats:restore' })).result.text,
    ).toBe('## Notes\nOriginal content.')
  })
})
