import { describe, rpc, callTool, callToolWithApiKey, seedKV, ADMIN_SECRET, parseEncounterTable } from './helpers'
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
})
