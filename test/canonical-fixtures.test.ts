import { expect, it, beforeEach } from 'vitest'
import { describe, callTool, seedKV } from './utils'

// ── Canonical IF state-engine test cases ──────────────────────────────────────
//
// These fixtures mirror the canonical entity formats used by the story AI:
// entity:/location:/scene:/faction: key prefixes, YAML-style nested field lists,
// integer-scale Weight-N fields (5–95), and embedded Stage-N-of-M status strings.
// Tests verify that tools parse these formats correctly.

describe('canonical fixture — entity:subject-alpha (active Stage-2-of-4)', () => {
  const ALPHA_LORE = [
    '# Entity: Subject Alpha',
    'Alias: Alpha',
    'Age: 24',
    'Gender: Female',
    'Status: Active, Stage-2-of-4',
    'Location: processing-chamber-primary',
    '',
    '## Weights',
    'Weight-1 (Drive): 30',
    'Weight-2 (Vulnerability): 55',
    '',
    '## Sensory Profile',
    'Temperature-Range: 36-38°C',
    'Scent-Profile: elevated-cortisol, salt, botanical-residue',
    'Texture-Profile: soft-tissue, minimal-callus, healed-scar-tissue-left-shoulder',
    'Sound-Signature: elevated-respiration, occasional-vocalization-distress',
    'Visual-Descriptors: lean-musculature, fair-integument, copper-cranial-filament',
    '',
    '## State Machine',
    'State-Machine: standard-multi-stage-processing',
    'Current-Stage: 2',
    'Total-Stages: 4',
    'Stage-Names: [preparation, engagement, processing, integration]',
    'Timeline-Value: 12',
    'Timeline-Unit: hours',
    'Thread: primary-processing-cycle',
    '',
    '## Inventory',
    'Inventory:',
    '- item: provision-pack-dried',
    '  quantity: 1',
    '  condition: partial',
    '- item: ornamental-blade',
    '  quantity: 1',
    '  condition: display-only',
    '- item: botanical-sachet',
    '  quantity: 2',
    '  condition: intact',
    '',
    '## Relationships',
    'Relationships:',
    '- target: entity:subject-beta',
    '  type: bonded-pair',
    '  affinity: 85',
    '  status: separated',
    '- target: faction:traveling-performers',
    '  type: member',
    '  rank: junior',
    '  standing: good',
    '',
    '## Skills',
    'Tracking: 0.2',
    'Negotiation: 0.4',
    'Physical-Resistance: 0.3',
    'Perception: 0.5',
  ].join('\n')

  beforeEach(() => seedKV('entity:subject-alpha', ALPHA_LORE))

  it('stores and retrieves full canonical lore verbatim', async () => {
    const res = await callTool('get_lore', { query: 'entity:subject-alpha' })
    expect(res.result.content[0].text).toBe(ALPHA_LORE)
  })

  it('advance_state_stage reads embedded Stage-2-of-4 in Status and advances to Stage-3-of-4', async () => {
    const res = await callTool('advance_state_stage', { entity_key: 'entity:subject-alpha' })
    expect(res.result.advanced).toBe(true)
    expect(res.result.old_stage).toBe(2)
    expect(res.result.new_stage).toBe(3)
    expect(res.result.total_stages).toBe(4)
    expect(res.result.is_terminal).toBe(false)
    const lore = await callTool('get_lore', { query: 'entity:subject-alpha' })
    expect(lore.result.text).toContain('Stage-3-of-4')
    expect(lore.result.text).not.toContain('Stage-2-of-4')
  })

  it('resolve_interaction normalizes integer Weight-1:85/Weight-2:55 from ## Weights section', async () => {
    await seedKV('entity:actor-stub', [
      '## Weights',
      'Weight-1 (Drive): 85',
      'Weight-2 (Vulnerability): 10',
      'State-Level: 0',
    ].join('\n'))
    const res = await callTool('resolve_interaction', {
      entity_a_id: 'entity:actor-stub',
      entity_b_id: 'entity:subject-alpha',
      action_type: 'process',
    })
    expect(res.error).toBeUndefined()
    expect(res.result.metadata.weight_1_raw).toBe(85)
    expect(res.result.metadata.weight_2_raw).toBe(55)
    expect(res.result.metadata.weight_1).toBeCloseTo(0.85, 5)
    expect(res.result.metadata.weight_2).toBeCloseTo(0.55, 5)
    // P = 0.85 - 0.55*0.3 = 0.685
    expect(res.result.metadata.probability).toBeCloseTo(0.685, 3)
  })

  it('thread_tick finds entity:subject-alpha via Thread field in ## State Machine section', async () => {
    const res = await callTool('thread_tick', { thread_id: 'primary-processing-cycle' })
    expect(res.result.metadata.entities_ticked).toBe(1)
    const lore = await callTool('get_lore', { query: 'entity:subject-alpha' })
    expect(lore.result.text).toContain('Timeline-Value: 11')
  })

  it('get_sensory_profile reads Sound-Signature and Visual-Descriptors from canonical section', async () => {
    const res = await callTool('get_sensory_profile', { entity_key: 'entity:subject-alpha' })
    expect(res.error).toBeUndefined()
    expect(res.result.profile.sound_signature).toContain('elevated-respiration')
    expect(res.result.profile.visual_descriptors).toContain('lean-musculature')
  })

  it('search_lore finds entity:subject-alpha by stage string', async () => {
    const res = await callTool('search_lore', { query: 'Stage-2-of-4' })
    expect(res.result.metadata.match_count).toBeGreaterThan(0)
    const keys = res.result.results.map((r: { key: string }) => r.key)
    expect(keys).toContain('entity:subject-alpha')
  })
})

describe('canonical fixture — entity:actor-primary (predator/driver, Weight-1:85)', () => {
  const ACTOR_LORE = [
    '# Entity: Actor Primary',
    'Alias: The Director',
    'Age: Unknown',
    'Gender: Female',
    'Status: Active, Processing',
    'Location: processing-chamber-primary',
    '',
    '## Weights',
    'Weight-1 (Drive): 85',
    'Weight-2 (Vulnerability): 10',
    '',
    '## Sensory Profile',
    'Temperature-Range: 38-42°C',
    'Scent-Profile: metabolic-heat, copper, enzymatic-secretion',
    'Texture-Profile: dense-musculature, smooth-integument, thermal-radiance',
    'Sound-Signature: low-frequency-resonance, rhythmic-internal-movement',
    'Visual-Descriptors: significant-scale, bioluminescent-markings, predator-morphology',
    '',
    '## State Machine',
    'State-Machine: sustained-processing',
    'Current-Stage: 2',
    'Total-Stages: 3',
    'Stage-Names: [acquisition, processing, integration]',
    'Timeline-Value: 8',
    'Timeline-Unit: hours',
    'Thread: primary-processing-cycle',
    '',
    '## Faction',
    'Faction: processing-guild',
    'Rank: director',
    'Specialization: multi-stage-processing',
    '',
    '## Skills',
    'Processing-Efficiency: 0.9',
    'Sensory-Acuity: 0.85',
    'Output-Optimization: 0.8',
    'Patience: 0.3',
  ].join('\n')

  beforeEach(() => seedKV('entity:actor-primary', ACTOR_LORE))

  it('stores and retrieves full canonical lore verbatim', async () => {
    const res = await callTool('get_lore', { query: 'entity:actor-primary' })
    expect(res.result.content[0].text).toBe(ACTOR_LORE)
  })

  it('analyze_utility entity_role=actor uses Weight-1:85 (normalizes to 0.85)', async () => {
    const res = await callTool('analyze_utility', {
      entity_id: 'entity:actor-primary',
      utility_vector: 'GASTRIC',
      entity_role: 'actor',
    })
    expect(res.error).toBeUndefined()
    expect(res.result.entity_role).toBe('actor')
    const w1Entry = res.result.breakdown.find((b: any) => /Weight-1/i.test(b.field))
    if (w1Entry) {
      expect(w1Entry.raw_value).toBe(85)
      expect(w1Entry.effective_value).toBeCloseTo(0.85, 2)
    }
  })

  it('thread_tick on primary-processing-cycle decrements actor Timeline-Value', async () => {
    const res = await callTool('thread_tick', { thread_id: 'primary-processing-cycle' })
    expect(res.result.metadata.entities_ticked).toBe(1)
    const lore = await callTool('get_lore', { query: 'entity:actor-primary' })
    expect(lore.result.text).toContain('Timeline-Value: 7')
  })

  it('thread_tick ticks both actor and subject when both share the same thread', async () => {
    await seedKV('entity:subject-alpha', [
      'Status: Active, Stage-2-of-4',
      'Thread: primary-processing-cycle',
      'Timeline-Value: 12',
    ].join('\n'))
    const res = await callTool('thread_tick', { thread_id: 'primary-processing-cycle' })
    expect(res.result.metadata.entities_ticked).toBe(2)
  })
})

describe('canonical fixture — entity:subject-beta (Stage-3-of-4, modified-consciousness)', () => {
  const BETA_LORE = [
    '# Entity: Subject Beta',
    'Alias: Beta',
    'Age: 26',
    'Gender: Female',
    'Status: Stage-3-of-4, Modified-Consciousness',
    'Location: processing-chamber-secondary',
    '',
    '## Weights',
    'Weight-1 (Drive): 10',
    'Weight-2 (Vulnerability): 75',
    '',
    '## State Machine',
    'State-Machine: standard-multi-stage-processing',
    'Current-Stage: 3',
    'Total-Stages: 4',
    'Stage-Names: [preparation, engagement, processing, integration]',
    'Timeline-Value: 48',
    'Timeline-Unit: hours',
    'Thread: secondary-processing-cycle',
    '',
    '## Relationships',
    'Relationships:',
    '- target: entity:subject-alpha',
    '  type: bonded-pair',
    '  affinity: 90',
    '  status: separated-unaware',
    '- target: entity:actor-primary',
    '  type: processor-subject',
    '  affinity: 70',
    '  status: bonded-processing',
  ].join('\n')

  beforeEach(() => seedKV('entity:subject-beta', BETA_LORE))

  it('stores and retrieves full canonical lore verbatim', async () => {
    const res = await callTool('get_lore', { query: 'entity:subject-beta' })
    expect(res.result.content[0].text).toBe(BETA_LORE)
  })

  it('advance_state_stage reads Stage-3-of-4 from Status and advances to Stage-4-of-4 (terminal)', async () => {
    const res = await callTool('advance_state_stage', { entity_key: 'entity:subject-beta' })
    expect(res.result.advanced).toBe(true)
    expect(res.result.old_stage).toBe(3)
    expect(res.result.new_stage).toBe(4)
    expect(res.result.total_stages).toBe(4)
    expect(res.result.is_terminal).toBe(true)
    const lore = await callTool('get_lore', { query: 'entity:subject-beta' })
    expect(lore.result.text).toContain('Stage-4-of-4')
  })

  it('resolve_interaction: diminished Weight-1:10 yields very low probability (~0.04)', async () => {
    await seedKV('entity:passive-target', 'Weight-2: 20')
    const res = await callTool('resolve_interaction', {
      entity_a_id: 'entity:subject-beta',
      entity_b_id: 'entity:passive-target',
      action_type: 'resist',
    })
    expect(res.error).toBeUndefined()
    expect(res.result.metadata.weight_1_raw).toBe(10)
    expect(res.result.metadata.weight_1).toBeCloseTo(0.10, 5)
    // P = 0.10 - 0.20*0.3 = 0.04
    expect(res.result.metadata.probability).toBeCloseTo(0.04, 3)
  })

  it('thread_tick on secondary-processing-cycle decrements subject-beta Timeline-Value', async () => {
    const res = await callTool('thread_tick', { thread_id: 'secondary-processing-cycle' })
    expect(res.result.metadata.entities_ticked).toBe(1)
    const lore = await callTool('get_lore', { query: 'entity:subject-beta' })
    expect(lore.result.text).toContain('Timeline-Value: 47')
  })
})

describe('canonical fixture — location:transit-hub-north (YAML exits + encounter table)', () => {
  const TRANSIT_HUB_LORE = [
    '# Location: Northern Transit Hub',
    'Type: threshold-zone',
    'Danger-Level: moderate',
    'Status: active',
    '',
    '## Exits',
    'Exits:',
    '- target: location:processing-chamber-primary',
    '  travel-cost: 2-hours',
    '  danger: high',
    '  requirement: tracking-skill-0.3',
    '- target: location:settlement-fringe',
    '  travel-cost: 30-minutes',
    '  danger: low',
    '  requirement: none',
    '- target: location:deep-forest',
    '  travel-cost: 4-hours',
    '  danger: very-high',
    '  requirement: tracking-skill-0.5',
    '',
    '## Environmental Properties',
    'Temperature: 22-28°C',
    'Humidity: high',
    'Light-Level: low',
    'Ambient-Scent: decay, damp-earth, fungal-spore',
    'Ambient-Sound: distant-movement, settling-earth, water-drip',
    '',
    '## Encounter Table',
    'Encounter-Table:',
    '- entity-type: scout-entity',
    '  weight: 40',
    '  threat-level: moderate',
    '  behavior: patrolling',
    '- entity-type: minor-entity',
    '  weight: 30',
    '  threat-level: low',
    '  behavior: fleeing',
    '- entity-type: rival-actor',
    '  weight: 20',
    '  threat-level: high',
    '  behavior: territorial',
    '- entity-type: neutral-traveler',
    '  weight: 10',
    '  threat-level: none',
    '  behavior: passing-through',
  ].join('\n')

  beforeEach(() => seedKV('location:transit-hub-north', TRANSIT_HUB_LORE))

  it('stores and retrieves full canonical lore verbatim', async () => {
    const res = await callTool('get_lore', { query: 'location:transit-hub-north' })
    expect(res.result.content[0].text).toBe(TRANSIT_HUB_LORE)
  })

  it('get_reachable_locations parses YAML-style Exits list and returns all three destinations', async () => {
    const res = await callTool('get_reachable_locations', { origin_key: 'location:transit-hub-north' })
    expect(res.error).toBeUndefined()
    expect(res.result.locations).toHaveLength(3)
    const keys = res.result.locations.map((l: { key: string }) => l.key)
    expect(keys).toContain('location:processing-chamber-primary')
    expect(keys).toContain('location:settlement-fringe')
    expect(keys).toContain('location:deep-forest')
  })

  it('search_lore finds location by encounter type keyword', async () => {
    const res = await callTool('search_lore', { query: 'scout-entity' })
    expect(res.result.metadata.match_count).toBeGreaterThan(0)
    const keys = res.result.results.map((r: { key: string }) => r.key)
    expect(keys).toContain('location:transit-hub-north')
  })
})

describe('canonical fixture — scene:threshold-discovery (YAML choice tree)', () => {
  const SCENE_LORE = [
    '# Scene: Threshold Discovery',
    'Thread: primary-processing-cycle',
    'Location: location:processing-chamber-primary',
    'Status: active',
    '',
    '## Scene State',
    'Active-Entity: entity:subject-alpha',
    'Environmental-Conditions: low-light, organic-decay-scent, distant-rhythmic-sound',
    'Time: night, approximately 11pm',
    '',
    '## Choices',
    'Choices:',
    '- id: investigate-sound',
    '  label: "Follow the rhythmic sound deeper into the chamber"',
    '  requirements: perception: 0.3',
    '',
    '- id: search-perimeter',
    '  label: "Search the chamber perimeter for tracks or traces"',
    '  requirements: tracking: 0.2',
    '',
    '- id: call-out',
    '  label: "Call out into the darkness"',
    '  requirements: none',
    '',
    '- id: retreat',
    '  label: "Withdraw and find another approach"',
    '  requirements: none',
    '',
    '## Scene Flags',
    'first-visit: true',
    'evidence-collected: false',
    'actor-alerted: false',
  ].join('\n')

  beforeEach(() => seedKV('scene:threshold-discovery', SCENE_LORE))

  it('stores and retrieves full canonical scene lore verbatim', async () => {
    const res = await callTool('get_lore', { query: 'scene:threshold-discovery' })
    expect(res.result.content[0].text).toBe(SCENE_LORE)
  })

  it('activate_scene loads scene and returns all four choice IDs', async () => {
    const res = await callTool('activate_scene', { scene_key: 'scene:threshold-discovery' })
    expect(res.error).toBeUndefined()
    expect(res.result.scene_key).toBe('scene:threshold-discovery')
    const choices = res.result.available_choices as string[]
    expect(choices).toContain('investigate-sound')
    expect(choices).toContain('search-perimeter')
    expect(choices).toContain('call-out')
    expect(choices).toContain('retreat')
  })
})

describe('canonical fixture — faction:processing-guild (hierarchy + standing system)', () => {
  const GUILD_LORE = [
    '# Faction: Processing Guild',
    'Type: operational-hierarchy',
    'Status: active',
    'Location: processing-chamber-primary',
    '',
    '## Hierarchy',
    'Ranks:',
    '- title: director',
    '  members: [entity:actor-primary]',
    '  authority: supreme',
    '- title: senior-operator',
    '  members: [entity:actor-secondary]',
    '  authority: high',
    '',
    '## Standing System',
    'Reputation-Tiers: [hostile, suspicious, neutral, accepted, favored, exalted]',
    'Default-Reputation: neutral',
    '',
    '## Member Records',
    'Member-Records:',
    '- entity: entity:actor-primary',
    '  rank: director',
    '  specialization: multi-stage-processing',
    '  yield-history: exemplary',
  ].join('\n')

  const ACTOR_STUB = [
    '# Entity: Actor Primary',
    'Faction: processing-guild',
    'Rank: director',
    'Weight-1 (Drive): 85',
  ].join('\n')

  beforeEach(async () => {
    await seedKV('faction:processing-guild', GUILD_LORE)
    await seedKV('entity:actor-primary', ACTOR_STUB)
  })

  it('stores and retrieves faction lore verbatim', async () => {
    const res = await callTool('get_lore', { query: 'faction:processing-guild' })
    expect(res.result.content[0].text).toBe(GUILD_LORE)
  })

  it('get_faction_standing detects actor-primary as member (slug appears in faction text)', async () => {
    const res = await callTool('get_faction_standing', {
      entity_key: 'entity:actor-primary',
      faction_key: 'faction:processing-guild',
    })
    expect(res.error).toBeUndefined()
    expect(res.result.standing.is_member).toBe(true)
    expect(res.result.standing.rank).toBe('director')
  })

  it('get_faction_standing returns non-member for entity not in guild text', async () => {
    await seedKV('entity:outsider', 'Faction: rival-guild')
    const res = await callTool('get_faction_standing', {
      entity_key: 'entity:outsider',
      faction_key: 'faction:processing-guild',
    })
    expect(res.result.standing.is_member).toBe(false)
  })
})

describe('canonical fixture — thread comparison: primary vs secondary processing cycle', () => {
  beforeEach(async () => {
    await seedKV('entity:subject-alpha', [
      '# Entity: Subject Alpha',
      'Status: Active, Stage-2-of-4',
      'Thread: primary-processing-cycle',
      'Timeline-Value: 12',
      'Current-Date: cycle-day-1',
    ].join('\n'))
    await seedKV('entity:subject-beta', [
      '# Entity: Subject Beta',
      'Status: Stage-3-of-4, Modified-Consciousness',
      'Thread: secondary-processing-cycle',
      'Timeline-Value: 48',
      'Current-Date: cycle-day-3',
    ].join('\n'))
  })

  it('get_thread_comparison reports one entity per thread and correct timeline offset', async () => {
    const res = await callTool('get_thread_comparison', {
      thread_a: 'primary-processing-cycle',
      thread_b: 'secondary-processing-cycle',
    })
    expect(res.error).toBeUndefined()
    expect(res.result.thread_a.entity_count).toBe(1)
    expect(res.result.thread_b.entity_count).toBe(1)
    // avg(12) vs avg(48) → offset = 36
    expect(res.result.timeline_offset).toBeCloseTo(36, 0)
  })

  it('check_convergence returns can_converge=false when threads share no Current-Date', async () => {
    const res = await callTool('check_convergence', {
      thread_a: 'primary-processing-cycle',
      thread_b: 'secondary-processing-cycle',
    })
    expect(res.error).toBeUndefined()
    expect(res.result.can_converge).toBe(false)
    expect(res.result.shared_dates).toHaveLength(0)
  })

  it('check_convergence returns can_converge=true when threads share a Current-Date', async () => {
    await seedKV('entity:subject-alpha', [
      'Thread: primary-processing-cycle',
      'Timeline-Value: 12',
      'Current-Date: convergence-point',
    ].join('\n'))
    await seedKV('entity:subject-beta', [
      'Thread: secondary-processing-cycle',
      'Timeline-Value: 48',
      'Current-Date: convergence-point',
    ].join('\n'))
    const res = await callTool('check_convergence', {
      thread_a: 'primary-processing-cycle',
      thread_b: 'secondary-processing-cycle',
    })
    expect(res.result.can_converge).toBe(true)
    expect(res.result.shared_dates).toContain('convergence-point')
  })
})

describe('canonical fixture — template:standard-subject as generate_entity archetype', () => {
  const TEMPLATE_LORE = [
    '# Template: Standard Subject Entity',
    'Type: subject-archetype',
    'Category: baseline-humanoid',
    '',
    '## Default Weights',
    'Weight-1 (Drive): 30',
    'Weight-2 (Vulnerability): 55',
    '',
    '## Default Sensory',
    'Temperature-Range: 36-38°C',
    'Scent-Profile: baseline-mammalian, variable-cortisol',
    'Sound-Signature: standard-respiration',
    'Visual-Descriptors: bipedal-humanoid, variable-pigmentation',
    '',
    '## State Machine Assignment',
    'State-Machine: standard-multi-stage-processing',
    'Current-Stage: 1',
    'Total-Stages: 4',
  ].join('\n')

  beforeEach(() => seedKV('template:standard-subject', TEMPLATE_LORE))

  it('stores and retrieves template lore verbatim', async () => {
    const res = await callTool('get_lore', { query: 'template:standard-subject' })
    expect(res.result.content[0].text).toBe(TEMPLATE_LORE)
  })

  it('generate_entity creates a new entity from the template archetype', async () => {
    const res = await callTool('generate_entity', { archetype_key: 'template:standard-subject' })
    expect(res.error).toBeUndefined()
    expect(res.result.entity_key).toMatch(/^entity:standard-subject-\d+$/)
    expect(res.result.entity_text).toContain('Weight-1')
    expect(res.result.metadata.written).toBe(1)
  })

  it('generated entity is retrievable and inherits integer weight values', async () => {
    const gen = await callTool('generate_entity', { archetype_key: 'template:standard-subject' })
    const lore = await callTool('get_lore', { query: gen.result.entity_key })
    expect(lore.error).toBeUndefined()
    expect(lore.result.text).toContain('30')
    expect(lore.result.text).toContain('55')
  })
})

describe('canonical fixture — sensory profile with Temperature-Range and Scent-Profile field names', () => {
  it('get_sensory_profile reads Sound-Signature and Visual-Descriptors from canonical ## Sensory Profile section', async () => {
    await seedKV('entity:sensory-canonical', [
      '## Sensory Profile',
      'Temperature-Range: 36-38°C',
      'Scent-Profile: elevated-cortisol, salt',
      'Texture-Profile: soft-tissue, minimal-callus',
      'Sound-Signature: elevated-respiration, occasional-vocalization',
      'Visual-Descriptors: lean-musculature, fair-integument',
    ].join('\n'))
    const res = await callTool('get_sensory_profile', { entity_key: 'entity:sensory-canonical' })
    expect(res.error).toBeUndefined()
    expect(res.result.profile.sound_signature).toContain('elevated-respiration')
    expect(res.result.profile.visual_descriptors).toContain('lean-musculature')
  })

  it('get_sensory_profile maps Temperature-Range field to temperature profile slot', async () => {
    await seedKV('entity:temp-range-entity', [
      'Temperature-Range: 38-42°C',
      'Sound-Signature: low-frequency-resonance',
    ].join('\n'))
    const res = await callTool('get_sensory_profile', { entity_key: 'entity:temp-range-entity' })
    expect(res.error).toBeUndefined()
    const temp = res.result.profile.temperature
    expect(temp).toBeTruthy()
    expect(temp).toContain('38')
  })

  it('get_sensory_profile maps Scent-Profile field to scent profile slot', async () => {
    await seedKV('entity:scent-profile-entity', [
      'Scent-Profile: metabolic-heat, copper, enzymatic-secretion',
      'Sound-Signature: low-resonance',
    ].join('\n'))
    const res = await callTool('get_sensory_profile', { entity_key: 'entity:scent-profile-entity' })
    expect(res.error).toBeUndefined()
    const scent = res.result.profile.scent
    expect(scent).toBeTruthy()
    expect(scent).toContain('metabolic-heat')
  })
})

describe('canonical fixture — get_location_occupants with entity: prefix keys', () => {
  it('finds entity:subject-alpha and entity:actor-primary at processing-chamber-primary', async () => {
    await seedKV('entity:subject-alpha', [
      'Status: Active, Stage-2-of-4',
      'Location: processing-chamber-primary',
      'Weight-1 (Drive): 30',
    ].join('\n'))
    await seedKV('entity:actor-primary', [
      'Status: Active, Processing',
      'Location: processing-chamber-primary',
      'Weight-1 (Drive): 85',
    ].join('\n'))
    await seedKV('entity:subject-beta', [
      'Status: Stage-3-of-4',
      'Location: processing-chamber-secondary',
    ].join('\n'))
    const res = await callTool('get_location_occupants', { location_key: 'processing-chamber-primary' })
    expect(res.error).toBeUndefined()
    const keys = res.result.occupants.map((o: { key: string }) => o.key)
    expect(keys).toContain('entity:subject-alpha')
    expect(keys).toContain('entity:actor-primary')
    expect(keys).not.toContain('entity:subject-beta')
  })
})

describe('canonical fixture — integer weight boundary values (5 min, 95 max)', () => {
  it('Weight-1:5 (minimum drive) normalizes to 0.05', async () => {
    await seedKV('entity:min-drive', 'Weight-1 (Drive): 5\nState-Level: 0')
    await seedKV('entity:passive', 'Weight-2: 0')
    const res = await callTool('resolve_interaction', {
      entity_a_id: 'entity:min-drive',
      entity_b_id: 'entity:passive',
      action_type: 'test',
    })
    expect(res.error).toBeUndefined()
    expect(res.result.metadata.weight_1_raw).toBe(5)
    expect(res.result.metadata.weight_1).toBeCloseTo(0.05, 5)
  })

  it('Weight-1:95 (maximum drive) normalizes to 0.95', async () => {
    await seedKV('entity:max-drive', 'Weight-1 (Drive): 95\nState-Level: 0')
    await seedKV('entity:strong-resist', 'Weight-2 (Vulnerability): 95')
    const res = await callTool('resolve_interaction', {
      entity_a_id: 'entity:max-drive',
      entity_b_id: 'entity:strong-resist',
      action_type: 'test',
    })
    expect(res.error).toBeUndefined()
    expect(res.result.metadata.weight_1_raw).toBe(95)
    expect(res.result.metadata.weight_1).toBeCloseTo(0.95, 5)
    expect(res.result.metadata.weight_2_raw).toBe(95)
    expect(res.result.metadata.weight_2).toBeCloseTo(0.95, 5)
    // P = 0.95 - 0.95*0.3 = 0.665
    expect(res.result.metadata.probability).toBeCloseTo(0.665, 3)
  })

  it('skill values (0.0–1.0 range) in Skills section are not further normalized', async () => {
    await seedKV('entity:skill-range-a', 'Weight-1: 0.5\nState-Level: 0')
    await seedKV('entity:skill-range-b', 'Weight-2: 0.3')
    const res = await callTool('resolve_interaction', {
      entity_a_id: 'entity:skill-range-a',
      entity_b_id: 'entity:skill-range-b',
      action_type: 'test',
    })
    expect(res.error).toBeUndefined()
    // 0.5 is already in [0,1] — no normalization
    expect(res.result.metadata.weight_1).toBe(0.5)
    expect(res.result.metadata.weight_2).toBe(0.3)
  })
})
