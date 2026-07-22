import { describe, callTool, seedKV, env } from './support/helpers'
import { expect, it } from 'vitest'
import { parseKvEntry } from '@/lib/lore'

describe('Archetype fixtures and entity_manage.generate', () => {
  // Seed common Holmgard archetypes
  const seedArchetypes = async () => {
    const archetypes = {
      'archetype:human-guard': `**Name:** Human Guard
**Entity-Type:** human
**Classification:** Material
**Weight-1:** 0.55
**Weight-2:** 0.45
**Status:** Roaming
**Sensory-Profile:** Alert
**Yield-Grade:** B
**State-Stages:** intact → wounded → incapacitated → death
**Description:** A trained human soldier or guard, alert but vulnerable.`,

      'archetype:human-merchant': `**Name:** Human Merchant
**Entity-Type:** human
**Classification:** Material
**Weight-1:** 0.35
**Weight-2:** 0.25
**Status:** Trading
**Sensory-Profile:** Observant
**Yield-Grade:** C
**State-Stages:** intact → frightened → cooperative → fled
**Description:** A trader or merchant, focused on commerce and profit.`,

      'archetype:human-traveler': `**Name:** Human Traveler
**Entity-Type:** human
**Classification:** Material
**Weight-1:** 0.45
**Weight-2:** 0.40
**Status:** Wandering
**Sensory-Profile:** Cautious
**Yield-Grade:** B
**State-Stages:** intact → wary → fleeing → lost
**Description:** A wanderer or pilgrim traversing the roads.`,

      'archetype:human-herbalist': `**Name:** Human Herbalist
**Entity-Type:** human
**Classification:** Material
**Weight-1:** 0.30
**Weight-2:** 0.20
**Status:** Harvesting
**Sensory-Profile:** Focused
**Yield-Grade:** D
**State-Stages:** intact → startled → defensive → fled
**Description:** A healer or herb-gatherer, skilled but frail.`,

      'archetype:human-ferryman': `**Name:** Human Ferryman
**Entity-Type:** human
**Classification:** Material
**Weight-1:** 0.50
**Weight-2:** 0.35
**Status:** At-Water
**Sensory-Profile:** Attentive
**Yield-Grade:** B
**State-Stages:** intact → alarmed → abandoning-vessel → drowned
**Description:** A boatman or ferryman tied to a waterway.`,

      'archetype:human-village-elder': `**Name:** Human Village Elder
**Entity-Type:** human
**Classification:** Material
**Weight-1:** 0.25
**Weight-2:** 0.15
**Status:** Settled
**Sensory-Profile:** Knowing
**Yield-Grade:** C
**State-Stages:** intact → concerned → protective → fled
**Description:** An elder or authority figure bound to a settlement.`,

      'archetype:shaper-stalker': `**Name:** Shaper Stalker
**Entity-Type:** shaper
**Classification:** Predator
**Weight-1:** 0.85
**Weight-2:** 0.70
**Status:** Hunting
**Sensory-Profile:** Predatory
**Yield-Grade:** AA
**State-Stages:** intact → injured → desperate → death
**Description:** An uplifted stalker shaper, apex predator with tactical intelligence.`,

      'archetype:shaper-broodmother': `**Name:** Shaper Broodmother
**Entity-Type:** shaper
**Classification:** Apex
**Weight-1:** 0.90
**Weight-2:** 0.80
**Status:** Nesting
**Sensory-Profile:** Maternal-Apex
**Yield-Grade:** S
**State-Stages:** intact → threatened → raging → defeated
**Description:** A reproductive apex shaper, fiercely protective of her brood.`,

      'archetype:material-prey-generic': `**Name:** Generic Material Prey
**Entity-Type:** generic
**Classification:** Material
**Weight-1:** 0.20
**Weight-2:** 0.10
**Status:** Grazing
**Sensory-Profile:** Basic
**Yield-Grade:** E
**State-Stages:** intact → startled → fleeing → captured
**Description:** A simple, unremarkable creature for bulk processing.`,
    }

    for (const [key, text] of Object.entries(archetypes)) {
      await seedKV(key, text)
    }
  }

  it('seeds all common archetypes into KV', async () => {
    await seedArchetypes()

    // Verify each archetype exists
    const keys = [
      'archetype:human-guard',
      'archetype:human-merchant',
      'archetype:human-traveler',
      'archetype:human-herbalist',
      'archetype:human-ferryman',
      'archetype:human-village-elder',
      'archetype:shaper-stalker',
      'archetype:shaper-broodmother',
      'archetype:material-prey-generic',
    ]

    for (const key of keys) {
      const raw = await env.LORE_DB.get(key)
      expect(raw, `Archetype ${key} should exist in KV`).not.toBeNull()
      const parsed = parseKvEntry(raw!)
      expect(parsed.text).toContain('**Weight-1:**')
      expect(parsed.text).toContain('**Status:**')
    }
  })

  it('generates entity from human-guard archetype', async () => {
    await seedArchetypes()

    const res = await callTool('entity_manage', {
      action: 'generate',
      archetype_key: 'archetype:human-guard',
    })

    expect(res.result).toBeDefined()
    expect(res.result.entity_key).toMatch(/^entity:human-guard-\d+$/)
    expect(res.result.archetype_key).toBe('archetype:human-guard')
    expect(res.result.entity_text).toContain('**Weight-1:** 0.55')
  })

  it('generates entity with location-based threat adjustment', async () => {
    await seedArchetypes()
    await seedKV(
      'location:danger-zone',
      '**Name:** Danger Zone\n**Danger-Level:** 0.5',
    )

    const res = await callTool('entity_manage', {
      action: 'generate',
      archetype_key: 'archetype:human-merchant',
      location_key: 'location:danger-zone',
    })

    expect(res.result).toBeDefined()
    expect(res.result.location_key).toBe('location:danger-zone')
    // Entity's Weight-1 should be adjusted: 0.35 + (0.5 * 0.05) = 0.375
    expect(res.result.entity_text).toContain('**Weight-1:**')
    // Verify the text includes location and archetype markers
    expect(res.result.entity_text).toContain('**Location:** location:danger-zone')
    expect(res.result.entity_text).toContain('**Archetype:** archetype:human-merchant')
  })

  it('generates entity from shaper archetype', async () => {
    await seedArchetypes()

    const res = await callTool('entity_manage', {
      action: 'generate',
      archetype_key: 'archetype:shaper-stalker',
    })

    expect(res.result).toBeDefined()
    expect(res.result.entity_key).toMatch(/^entity:shaper-stalker-\d+$/)
    // Shaper stalker has high weight — verify it's preserved
    expect(res.result.entity_text).toContain('**Weight-1:** 0.85')
  })

  it('returns error when archetype does not exist', async () => {
    const res = await callTool('entity_manage', {
      action: 'generate',
      archetype_key: 'archetype:nonexistent-phantom',
    })

    expect(res.error).toBeDefined()
    expect(res.error.code).toBe(-32602)
    expect(res.error.message).toContain('Archetype')
    expect(res.error.message).toContain('not found')
  })

  it('stores generated entity in KV with metadata', async () => {
    await seedArchetypes()

    const res = await callTool('entity_manage', {
      action: 'generate',
      archetype_key: 'archetype:human-guard',
    })

    const entityKey = res.result.entity_key
    const raw = await env.LORE_DB.get(entityKey)
    expect(raw).not.toBeNull()

    const parsed = parseKvEntry(raw!)
    expect(parsed.meta.generated_from).toBe('archetype:human-guard')
    expect(parsed.text).toContain('**Generated-At:**')
  })
})