// Tests for the extended dice-rolling engine (percentile/Fudge/reroll/success
// dice, critical hit detection, get_history, and discoverability). See issue #209.
import { describe } from './helpers'
import { SELF, env } from 'cloudflare:test'
import { expect, it, beforeEach } from 'vitest'
import { setupRpgDb } from './setup-d1'

describe('Dice notation extensions', () => {
  beforeEach(async () => {
    await setupRpgDb(env.RPG_DB)
  })

  async function callTool(name: string, args: Record<string, unknown>) {
    const res = await SELF.fetch('http://example.com/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': 'test-api-key-xyz' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    })
    const json = await res.json() as Record<string, any>
    const text = json.result?.content?.[0]?.text
    return text ? JSON.parse(text) : json
  }

  // ── new notation ─────────────────────────────────────────────────────────────

  it('rolls percentile dice (d%) in range 1-100', async () => {
    for (let i = 0; i < 20; i++) {
      const r = await callTool('rpg', { sub: 'math', action: 'roll', expression: 'd%' })
      expect(r.success).toBe(true)
      expect(r.total).toBeGreaterThanOrEqual(1)
      expect(r.total).toBeLessThanOrEqual(100)
    }
  })

  it('rolls Fudge dice (dF) with each die in [-1, 1] and total in range', async () => {
    const r = await callTool('rpg', { sub: 'math', action: 'roll', expression: '4dF' })
    expect(r.success).toBe(true)
    expect(r.rolls.length).toBe(4)
    for (const die of r.rolls) expect([-1, 0, 1]).toContain(die)
    expect(r.total).toBeGreaterThanOrEqual(-4)
    expect(r.total).toBeLessThanOrEqual(4)
  })

  it('reroll-once (r1) triggers deterministically on a 1-sided die and logs the reroll', async () => {
    // 1d1 always rolls a natural 1 (only possible face), forcing the r1 branch
    // every time without needing a seeded RNG.
    const r = await callTool('rpg', { sub: 'math', action: 'roll', expression: '1d1r1' })
    expect(r.success).toBe(true)
    expect(r.total).toBe(1)
    expect(r.steps.some((s: string) => s.includes('Rerolled a 1'))).toBe(true)
  })

  it('reroll-once meaningfully lowers the probability of ending on a 1 vs. a plain die', async () => {
    const withReroll = await callTool('rpg', { sub: 'math', action: 'probability', expression: '1d6r1', target: 1, comparison: 'eq' })
    // Plain 1d6 has a 1/6 (~0.167) chance of a 1; with a single reroll-on-1 it
    // drops to ~1/36 (~0.028) — assert it's well below the un-rerolled rate.
    expect(withReroll.probability).toBeLessThan(0.12)
  })

  it('counts successes for a success-threshold pool (5d10>7)', async () => {
    const r = await callTool('rpg', { sub: 'math', action: 'roll', expression: '5d10>7' })
    expect(r.success).toBe(true)
    expect(r.successes).toBeGreaterThanOrEqual(0)
    expect(r.successes).toBeLessThanOrEqual(5)
    expect(r.total).toBe(r.successes)
  })

  it('composes exploding dice with success counting (3d6!>4)', async () => {
    const r = await callTool('rpg', { sub: 'math', action: 'roll', expression: '3d6!>4' })
    expect(r.success).toBe(true)
    expect(r.rolls.length).toBeGreaterThanOrEqual(3)
  })

  // ── validation rejections ────────────────────────────────────────────────────

  it('rejects a success threshold combined with a flat modifier', async () => {
    const r = await callTool('rpg', { sub: 'math', action: 'roll', expression: '2d6+3>7' })
    expect(r.error).toBe(true)
  })

  it('rejects exploding Fudge dice', async () => {
    const r = await callTool('rpg', { sub: 'math', action: 'roll', expression: '4dF!' })
    expect(r.error).toBe(true)
  })

  it('rejects a success threshold on percentile or Fudge dice', async () => {
    const percentile = await callTool('rpg', { sub: 'math', action: 'roll', expression: 'd%>50' })
    expect(percentile.error).toBe(true)
    const fudge = await callTool('rpg', { sub: 'math', action: 'roll', expression: '4dF>1' })
    expect(fudge.error).toBe(true)
  })

  it('rejects a malformed expression on both roll and probability', async () => {
    const roll = await callTool('rpg', { sub: 'math', action: 'roll', expression: 'not-dice' })
    expect(roll.error).toBe(true)
    const probability = await callTool('rpg', { sub: 'math', action: 'probability', expression: 'not-dice', target: 10 })
    expect(probability.error).toBe(true)
  })

  it('rejects an expression with a valid die head but a malformed suffix', async () => {
    const r = await callTool('rpg', { sub: 'math', action: 'roll', expression: '2d6xyz' })
    expect(r.error).toBe(true)
  })

  it('supports drop-lowest (dl) and drop-highest (dh) notation', async () => {
    const dl = await callTool('rpg', { sub: 'math', action: 'roll', expression: '4d6dl1' })
    expect(dl.success).toBe(true)
    expect(dl.rolls.length).toBe(4)
    expect(dl.steps.some((s: string) => s.includes('Dropped lowest'))).toBe(true)

    const dh = await callTool('rpg', { sub: 'math', action: 'roll', expression: '4d6dh1' })
    expect(dh.success).toBe(true)
    expect(dh.rolls.length).toBe(4)
    expect(dh.steps.some((s: string) => s.includes('Dropped highest'))).toBe(true)
  })

  it('reroll-once applies to Fudge dice too', async () => {
    // 30 Fudge dice makes it astronomically unlikely (~5e-6) that none rolls a
    // natural 1 (+), forcing the fudge branch of the reroll-once logic without
    // needing a seeded RNG.
    const r = await callTool('rpg', { sub: 'math', action: 'roll', expression: '30dFr1' })
    expect(r.success).toBe(true)
    expect(r.steps.some((s: string) => s.includes('Rerolled a 1'))).toBe(true)
  })

  // ── critical hit / fumble ────────────────────────────────────────────────────

  it('flags critical success/failure across repeated 1d20 rolls, and omits it for ineligible expressions', async () => {
    const seen = new Set<string>()
    for (let i = 0; i < 150; i++) {
      const r = await callTool('rpg', { sub: 'math', action: 'roll', expression: '1d20' })
      expect('critical' in r).toBe(true)
      seen.add(String(r.critical))
    }
    expect(seen.has('success')).toBe(true)
    expect(seen.has('failure')).toBe(true)

    const pool = await callTool('rpg', { sub: 'math', action: 'roll', expression: '8d20' })
    expect('critical' in pool).toBe(false)
    const flat = await callTool('rpg', { sub: 'math', action: 'roll', expression: '2d6+3' })
    expect('critical' in flat).toBe(false)
    const percentile = await callTool('rpg', { sub: 'math', action: 'roll', expression: 'd%' })
    expect('critical' in percentile).toBe(false)
    const fudge = await callTool('rpg', { sub: 'math', action: 'roll', expression: '4dF' })
    expect('critical' in fudge).toBe(false)
    const plainPair = await callTool('rpg', { sub: 'math', action: 'roll', expression: '2d20' })
    expect('critical' in plainPair).toBe(false)
  })

  it('is critical-eligible for advantage (2d20kh1) and disadvantage (2d20kl1)', async () => {
    const advantage = await callTool('rpg', { sub: 'math', action: 'roll', expression: '2d20kh1' })
    expect('critical' in advantage).toBe(true)
    const disadvantage = await callTool('rpg', { sub: 'math', action: 'roll', expression: '2d20kl1' })
    expect('critical' in disadvantage).toBe(true)
  })

  // ── get_history ──────────────────────────────────────────────────────────────

  it('get_history round-trips session_id and metadata for a roll', async () => {
    const rolled = await callTool('rpg', { sub: 'math', action: 'roll', expression: '2d6+3', sessionId: 'dice-session-1' })
    const history = await callTool('rpg', { sub: 'math', action: 'get_history', sessionId: 'dice-session-1' })
    expect(history.success).toBe(true)
    expect(history.count).toBe(1)
    expect(history.calculations[0].session_id).toBe('dice-session-1')
    expect(history.calculations[0].metadata.kind).toBe('roll')
    expect(history.calculations[0].id).toBe(rolled.calculationId)
  })

  it('get_history filters by kind', async () => {
    await callTool('rpg', { sub: 'math', action: 'roll', expression: '1d20', sessionId: 'dice-session-2' })
    await callTool('rpg', { sub: 'math', action: 'probability', expression: '1d20', target: 15, sessionId: 'dice-session-2' })

    const rollsOnly = await callTool('rpg', { sub: 'math', action: 'get_history', sessionId: 'dice-session-2', kind: 'roll' })
    expect(rollsOnly.count).toBe(1)
    expect(rollsOnly.calculations[0].metadata.kind).toBe('roll')

    const probabilityOnly = await callTool('rpg', { sub: 'math', action: 'get_history', sessionId: 'dice-session-2', kind: 'probability' })
    expect(probabilityOnly.count).toBe(1)
    expect(probabilityOnly.calculations[0].metadata.kind).toBe('probability')
  })

  it('get_history looks up a single calculation by calculationId', async () => {
    const rolled = await callTool('rpg', { sub: 'math', action: 'roll', expression: '1d8' })
    const r = await callTool('rpg', { sub: 'math', action: 'get_history', calculationId: rolled.calculationId })
    expect(r.success).toBe(true)
    expect(r.calculation.id).toBe(rolled.calculationId)
  })

  it('get_history 404s for an unknown calculationId', async () => {
    const r = await callTool('rpg', { sub: 'math', action: 'get_history', calculationId: 'nonexistent' })
    expect(r.error).toBe(true)
  })

  it('get_history returns an empty list for a session with no rolls', async () => {
    const r = await callTool('rpg', { sub: 'math', action: 'get_history', sessionId: 'nonexistent-session' })
    expect(r.success).toBe(true)
    expect(r.count).toBe(0)
  })

  it('get_history with no filters returns recent calculations up to limit', async () => {
    await callTool('rpg', { sub: 'math', action: 'roll', expression: '1d6' })
    await callTool('rpg', { sub: 'math', action: 'roll', expression: '1d8' })
    const r = await callTool('rpg', { sub: 'math', action: 'get_history', limit: 1 })
    expect(r.success).toBe(true)
    expect(r.calculations.length).toBe(1)
  })

  // ── discoverability ──────────────────────────────────────────────────────────

  it('search_tools finds the rpg tool by "dice"', async () => {
    const r = await callTool('search_tools', { query: 'dice' })
    expect(r.success).toBe(true)
    expect(r.matches.some((m: any) => m.name === 'rpg')).toBe(true)
  })

  it('load_tool_schema resolves math_manage as a discovery-only schema doc', async () => {
    const r = await callTool('load_tool_schema', { toolName: 'math_manage' })
    expect(r.success).toBe(true)
    expect(r.schema.inputSchema.properties.expression).toBeDefined()
  })
})
