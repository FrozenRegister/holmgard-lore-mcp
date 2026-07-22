import { describe, rpc, callTool, callToolWithApiKey, seedKV, ADMIN_SECRET, parseEncounterTable } from './support/helpers'
import { SELF, env } from 'cloudflare:test'
import { expect, it, beforeEach } from 'vitest'

describe('set_goal', () => {
  it('adds a Goal:<id> field to an entity', async () => {
    await seedKV('character:hero', 'Hero is brave.\n**Status:** Active')
    const res = await callTool('continuity_manage', { action: 'set_goal', entity_key: 'character:hero', goal_id: 'find-artifact', description: 'Find the ancient artifact', status: 'active' })
    expect(res.error).toBeUndefined()
    expect(res.result.metadata.goal_id).toBe('find-artifact')
    expect(res.result.metadata.status).toBe('active')
    const lore = await callTool('lore_manage', { action: 'get', query: 'character:hero' })
    expect(lore.result.text).toContain('Goal:find-artifact')
    expect(lore.result.text).toContain('active')
  })

  it('updates an existing goal in place', async () => {
    await seedKV('character:warrior', '**Status:** Active\n**Goal:main-quest:** active | Defeat the dragon')
    await callTool('continuity_manage', { action: 'set_goal', entity_key: 'character:warrior', goal_id: 'main-quest', description: 'Defeat the dragon', status: 'blocked', obstacle: 'No sword' })
    const lore = await callTool('lore_manage', { action: 'get', query: 'character:warrior' })
    expect(lore.result.text).toContain('blocked')
    expect(lore.result.text).toContain('No sword')
  })

  it('stores parent goal reference when provided', async () => {
    await seedKV('character:explorer', '**Status:** Active')
    await callTool('continuity_manage', { action: 'set_goal', entity_key: 'character:explorer', goal_id: 'find-exit', description: 'Find exit', parent: 'escape' })
    const lore = await callTool('lore_manage', { action: 'get', query: 'character:explorer' })
    expect(lore.result.text).toContain('parent: escape')
  })

  it('returns error for nonexistent entity', async () => {
    const res = await callTool('continuity_manage', { action: 'set_goal', entity_key: 'character:ghost-9999', goal_id: 'find-peace', description: 'Find peace' })
    expect(res.error).toBeDefined()
    expect(res.error.code).toBe(-32602)
  })

  it('rejects invalid params (missing goal_id)', async () => {
    const res = await callTool('continuity_manage', { action: 'set_goal', entity_key: 'character:hero', description: 'Find the ancient artifact' })
    expect(res.error).toBeDefined()
    expect(res.error.code).toBe(-32602)
    expect(res.error.data.example).toBeDefined()
  })

  it('accepts entity_name, goal_name, and goal_description as aliases', async () => {
    await seedKV('character:hero', 'Hero is brave.\n**Status:** Active')
    const res = await callTool('continuity_manage', { action: 'set_goal', entity_name: 'character:hero', goal_name: 'find-artifact', goal_description: 'Find the ancient artifact' })
    expect(res.error).toBeUndefined()
    expect(res.result.metadata.goal_id).toBe('find-artifact')
  })
})

describe('check_continuity', () => {
  it('finds dangling character references', async () => {
    await seedKV('character:wanderer', '**Status:** Active\nShe knows character:nonexistent-person-xyz.')
    const res = await callTool('continuity_manage', { action: 'check_continuity', checks: ['dangling'] })
    expect(res.error).toBeUndefined()
    const findings = res.result.findings as Array<{ check: string; key: string }>
    expect(findings.some(f => f.check === 'dangling' && f.key === 'character:wanderer')).toBe(true)
  })

  it('returns clean when no dangling refs', async () => {
    await seedKV('character:clean-one', '**Status:** Active\nNo problematic references here.')
    const res = await callTool('continuity_manage', { action: 'check_continuity', scope: 'character:clean-one', checks: ['dangling'] })
    expect(res.result.content[0].text).toContain('No continuity issues found.')
  })

  it('severity_floor=error filters out warn-level findings', async () => {
    await seedKV('character:sev-test', 'Mentions character:nonexistent-sev-xyz')
    const res = await callTool('continuity_manage', { action: 'check_continuity', checks: ['dangling'], severity_floor: 'error' })
    // dangling refs are warn severity — should be filtered out when floor is error
    const findings = res.result.findings as Array<{ severity: string }>
    expect(findings.filter(f => f.severity === 'warn')).toHaveLength(0)
  })

  it('detects missing location on character', async () => {
    await seedKV('character:lost-soul', '**Status:** Active\n**Location:** location:ghost-town-xyz-9999')
    const res = await callTool('continuity_manage', { action: 'check_continuity', checks: ['occupancy'] })
    const findings = res.result.findings as Array<{ check: string }>
    expect(findings.some(f => f.check === 'occupancy')).toBe(true)
  })

  it('rejects a genuinely invalid severity_floor value', async () => {
    const res = await callTool('continuity_manage', { action: 'check_continuity', severity_floor: 'catastrophic' })
    expect(res.error).toBeDefined()
    expect(res.error.code).toBe(-32602)
    expect(res.error.data.example).toBeDefined()
  })

  it('accepts "medium" as an alias for severity_floor=warn', async () => {
    await seedKV('character:sev-alias-test', 'Mentions character:nonexistent-alias-xyz')
    const res = await callTool('continuity_manage', { action: 'check_continuity', checks: ['dangling'], severity_floor: 'medium' })
    expect(res.error).toBeUndefined()
    const findings = res.result.findings as Array<{ severity: string; key: string }>
    expect(findings.some(f => f.key === 'character:sev-alias-test' && f.severity === 'warn')).toBe(true)
  })

  describe('auto_fix', () => {
    it('removes dangling test-key references', async () => {
      await seedKV('character:autofix-test-ref', '**Status:** Active\n**Active-Scene:** scene:test-abandoned-run')
      const res = await callTool('continuity_manage', { action: 'check_continuity', checks: ['dangling'], auto_fix: true })
      expect(res.error).toBeUndefined()
      expect(res.result.fixed).toBe(1)
      const fixes = res.result.fixes as Array<{ key: string; action: string }>
      expect(fixes.some(f => f.key === 'character:autofix-test-ref' && f.action === 'removed_test_reference')).toBe(true)
      const lore = await callTool('lore_manage', { action: 'get', query: 'character:autofix-test-ref' })
      expect(lore.result.text).not.toContain('scene:test-abandoned-run')
    })

    it('auto-corrects an unambiguous typo against an existing key', async () => {
      await seedKV('character:eira-holt', '**Status:** Active')
      await seedKV('character:autofix-typo', '**Status:** Active\nAllied with character:eira-holtt.')
      const res = await callTool('continuity_manage', { action: 'check_continuity', checks: ['dangling'], auto_fix: true })
      expect(res.result.fixed).toBeGreaterThanOrEqual(1)
      const fixes = res.result.fixes as Array<{ key: string; action: string; detail: string }>
      expect(fixes.some(f => f.key === 'character:autofix-typo' && f.action === 'typo_correction')).toBe(true)
      const lore = await callTool('lore_manage', { action: 'get', query: 'character:autofix-typo' })
      expect(lore.result.text).toContain('character:eira-holt')
      expect(lore.result.text).not.toContain('character:eira-holtt')
    })

    it('skips as ambiguous when multiple close-match candidates exist', async () => {
      await seedKV('character:autofix-amba', '**Status:** Active')
      await seedKV('character:autofix-ambb', '**Status:** Active')
      await seedKV('character:autofix-ambiguous', '**Status:** Active\nMentions character:autofix-amb.')
      const res = await callTool('continuity_manage', { action: 'check_continuity', checks: ['dangling'], auto_fix: true })
      const skips = res.result.skips as Array<{ key: string; reason: string }>
      expect(skips.some(s => s.key === 'character:autofix-ambiguous' && s.reason.includes('ambiguous'))).toBe(true)
    })

    it('falls back an occupancy issue to location:unknown when no close match exists', async () => {
      await seedKV('character:autofix-occupancy', '**Status:** Active\n**Location:** location:zzz-totally-nonexistent-place')
      const res = await callTool('continuity_manage', { action: 'check_continuity', checks: ['occupancy'], auto_fix: true })
      expect(res.result.fixed).toBe(1)
      const lore = await callTool('lore_manage', { action: 'get', query: 'character:autofix-occupancy' })
      expect(lore.result.text).toContain('**Location:** location:unknown')
    })

    it('auto-corrects an unambiguous occupancy typo against an existing location', async () => {
      await seedKV('location:marsh-end', 'A muddy tidal flat.')
      await seedKV('character:autofix-occupancy-typo', '**Status:** Active\n**Location:** location:marsh-emd')
      const res = await callTool('continuity_manage', { action: 'check_continuity', checks: ['occupancy'], auto_fix: true })
      expect(res.result.fixed).toBe(1)
      const fixes = res.result.fixes as Array<{ key: string; action: string }>
      expect(fixes.some(f => f.key === 'character:autofix-occupancy-typo' && f.action === 'typo_correction')).toBe(true)
      const lore = await callTool('lore_manage', { action: 'get', query: 'character:autofix-occupancy-typo' })
      expect(lore.result.text).toContain('**Location:** location:marsh-end')
    })

    it('skips an occupancy issue as ambiguous when multiple close-match locations exist', async () => {
      await seedKV('location:marsh-enda', 'A muddy tidal flat, eastern bank.')
      await seedKV('location:marsh-endb', 'A muddy tidal flat, western bank.')
      await seedKV('character:autofix-occupancy-ambiguous', '**Status:** Active\n**Location:** location:marsh-end')
      const res = await callTool('continuity_manage', { action: 'check_continuity', checks: ['occupancy'], auto_fix: true })
      expect(res.result.fixed).toBe(0)
      const skips = res.result.skips as Array<{ key: string; reason: string }>
      expect(skips.some(s => s.key === 'character:autofix-occupancy-ambiguous' && s.reason.includes('ambiguous'))).toBe(true)
    })

    it('skips a dangling reference with no confident match as unfixable', async () => {
      await seedKV('character:autofix-nomatch', '**Status:** Active\nMentions character:zzz-wholly-unrelated-reference-999.')
      const res = await callTool('continuity_manage', { action: 'check_continuity', checks: ['dangling'], auto_fix: true })
      expect(res.result.fixed).toBe(0)
      const skips = res.result.skips as Array<{ key: string; reason: string }>
      expect(skips.some(s => s.key === 'character:autofix-nomatch' && s.reason === 'no confident match found')).toBe(true)
    })

    it('skips knowledge and inventory findings as requiring manual review', async () => {
      await seedKV('character:autofix-inv', '**Status:** Active\n**Inventory:** item:autofix-missing-item')
      const res = await callTool('continuity_manage', { action: 'check_continuity', checks: ['inventory'], auto_fix: true })
      expect(res.result.fixed).toBe(0)
      const skips = res.result.skips as Array<{ key: string; check: string; reason: string }>
      expect(skips.some(s => s.key === 'character:autofix-inv' && s.check === 'inventory' && s.reason.includes('entity-by-entity'))).toBe(true)
    })

    it('auto-fixed entries are reversible via restore_lore', async () => {
      await seedKV('character:autofix-restore', '**Status:** Active\n**Active-Scene:** scene:test-restore-me')
      await callTool('continuity_manage', { action: 'check_continuity', checks: ['dangling'], auto_fix: true })
      await callTool('lore_manage', { action: 'restore', key: 'character:autofix-restore' })
      const lore = await callTool('lore_manage', { action: 'get', query: 'character:autofix-restore' })
      expect(lore.result.text).toContain('scene:test-restore-me')
    })
  })
})
