// Pure unit tests for the creature AI behaviour trees (#445, #440 Phase 3 §3.6).
// No D1 — feralTick / shaperTick / creatureAiTick take a creature row + a
// per-tick snapshot and return a description of what changed.
import { describe } from '../support/helpers'
import { expect, it } from 'vitest'
import {
  feralTick,
  shaperTick,
  creatureAiTick,
  hexDistance,
  stepToward,
  isActiveTime,
  nearestLivePrey,
  type CreatureAiState,
  type CreatureTickSnapshot,
  type PreySnapshot,
} from '@/rpg/utils/creature-ai'

function makeCreature(overrides: Partial<CreatureAiState> = {}): CreatureAiState {
  return {
    id: 'c1',
    world_id: 'w1',
    creature_key: 'creature:panther',
    predator_taxonomy: 'feral',
    home_nest_q: 0,
    home_nest_r: 0,
    territory_radius: 4,
    hunger: 0,
    creative_drive: 0,
    aggression: 0.5,
    activity_pattern: 'always',
    movement_speed: 2,
    stealth: 0.5,
    perception: 0.5,
    current_state: 'patrolling',
    current_hex_q: 0,
    current_hex_r: 0,
    target_hex_q: null,
    target_hex_r: null,
    atelier_hex_q: null,
    atelier_hex_r: null,
    yield_preference: null,
    ...overrides,
  }
}

function snap(overrides: Partial<CreatureTickSnapshot> = {}): CreatureTickSnapshot {
  return { isDaytime: true, prey: [], currentTickTime: '2187-01-10T00:00:00.000Z', ...overrides }
}

describe('creature-ai pure helpers', () => {
  it('hexDistance computes axial→cube distance', () => {
    expect(hexDistance(0, 0, 0, 0)).toBe(0)
    expect(hexDistance(0, 0, 2, 0)).toBe(2)
    expect(hexDistance(0, 0, 2, 2)).toBe(4)
  })

  it('stepToward: no move when already at target or zero speed', () => {
    expect(stepToward(3, 3, 3, 3, 2)).toEqual({ q: 3, r: 3 })
    expect(stepToward(0, 0, 5, 0, 0)).toEqual({ q: 0, r: 0 })
  })

  it('stepToward: partial step when speed < distance', () => {
    expect(stepToward(0, 0, 5, 0, 1)).toEqual({ q: 1, r: 0 })
  })

  it('stepToward: reaches target when speed >= distance', () => {
    expect(stepToward(0, 0, 2, 0, 5)).toEqual({ q: 2, r: 0 })
  })

  it('isActiveTime respects activity pattern', () => {
    expect(isActiveTime('nocturnal', true)).toBe(false)
    expect(isActiveTime('nocturnal', false)).toBe(true)
    expect(isActiveTime('diurnal', true)).toBe(true)
    expect(isActiveTime('diurnal', false)).toBe(false)
    expect(isActiveTime('always', true)).toBe(true)
    expect(isActiveTime('crepuscular', false)).toBe(true)
    expect(isActiveTime(null, true)).toBe(true)
  })

  it('nearestLivePrey skips dead + out-of-range prey and picks the closest', () => {
    const prey: PreySnapshot[] = [
      { key: 'dead', q: 0, r: 0, hp: 0 },
      { key: 'far', q: 9, r: 0 },
      { key: 'near', q: 2, r: 0 },
      { key: 'live-null-hp', q: 3, r: 0, hp: null },
    ]
    const found = nearestLivePrey(0, 0, prey, 3)
    expect(found?.prey.key).toBe('near')
    expect(found?.distance).toBe(2)
    expect(nearestLivePrey(0, 0, [], 3)).toBeNull()
  })
})

describe('feralTick', () => {
  it('rests and conserves hunger when out of phase (nocturnal by day)', () => {
    const c = makeCreature({ activity_pattern: 'nocturnal', hunger: 50 })
    const r = feralTick(c, snap({ isDaytime: true }))
    expect(r.currentState).toBe('resting')
    expect(r.hunger).toBe(45)
    expect(r.moved).toBe(false)
    expect(r.changed).toBe(true)
  })

  it('wakes a resting creature to patrol when back in phase', () => {
    const c = makeCreature({ current_state: 'resting', hunger: 10 })
    const r = feralTick(c, snap())
    expect(r.currentState).toBe('patrolling')
    expect(r.hunger).toBe(20) // +HUNGER_RATE
  })

  it('a fleeing creature completes its flight and resumes patrol', () => {
    const c = makeCreature({ current_state: 'fleeing', hunger: 30 })
    const r = feralTick(c, snap())
    expect(r.currentState).toBe('patrolling')
    expect(r.moved).toBe(true)
  })

  it('patrolling + hungry + prey in range → begins hunting', () => {
    const c = makeCreature({ hunger: 75 })
    const r = feralTick(c, snap({ prey: [{ key: 'deer', q: 2, r: 0 }] }))
    expect(r.currentState).toBe('hunting')
    expect(r.targetHexQ).toBe(2)
    expect(r.targetHexR).toBe(0)
  })

  it('patrolling + hungry but no prey in range → keeps patrolling', () => {
    const c = makeCreature({ hunger: 75 })
    const r = feralTick(c, snap({ prey: [{ key: 'deer', q: 9, r: 0 }] }))
    expect(r.currentState).toBe('patrolling')
  })

  it('desperation (hunger > 90) widens the search radius', () => {
    const c = makeCreature({ hunger: 95 })
    // distance 4 — beyond the normal range 2, inside the doubled range 4.
    const r = feralTick(c, snap({ prey: [{ key: 'deer', q: 2, r: 2 }] }))
    expect(r.currentState).toBe('hunting')
  })

  it('sated patrolling only pounces on prey sharing its hex', () => {
    const onHex = feralTick(
      makeCreature({ hunger: 40 }),
      snap({ prey: [{ key: 'rabbit', q: 0, r: 0 }] }),
    )
    expect(onHex.currentState).toBe('hunting')
    const nearby = feralTick(
      makeCreature({ hunger: 40 }),
      snap({ prey: [{ key: 'rabbit', q: 2, r: 0 }] }),
    )
    expect(nearby.currentState).toBe('patrolling')
  })

  it('hunting moves toward prey and flags an encounter at melee range', () => {
    const c = makeCreature({ current_state: 'hunting', hunger: 80, movement_speed: 3 })
    const r = feralTick(c, snap({ prey: [{ key: 'deer', q: 2, r: 0 }] }))
    expect(r.currentHexQ).toBe(2)
    expect(r.flaggedEvent).toBeDefined()
    expect(r.flaggedEvent?.eventType).toBe('creature_hunt')
    expect(r.flaggedEvent?.resourceLocks).toEqual(['deer'])
    expect(r.flaggedEvent?.priority).toBe('HIGH')
    expect(r.moved).toBe(true)
  })

  it('hunting closes distance without reaching melee', () => {
    const c = makeCreature({ current_state: 'hunting', hunger: 80, movement_speed: 1 })
    const r = feralTick(c, snap({ prey: [{ key: 'deer', q: 5, r: 0 }] }))
    expect(r.flaggedEvent).toBeUndefined()
    expect(r.currentState).toBe('hunting')
    expect(r.moved).toBe(true)
  })

  it('hunting with target lost while standing on the kill hex → feeds', () => {
    const c = makeCreature({
      current_state: 'hunting',
      hunger: 80,
      current_hex_q: 3,
      current_hex_r: 3,
      target_hex_q: 3,
      target_hex_r: 3,
    })
    const r = feralTick(c, snap({ prey: [] }))
    expect(r.currentState).toBe('feeding')
  })

  it('hunting with target lost away from any kill → patrols', () => {
    const c = makeCreature({
      current_state: 'hunting',
      hunger: 80,
      current_hex_q: 3,
      current_hex_r: 3,
      target_hex_q: 9,
      target_hex_r: 9,
    })
    const r = feralTick(c, snap({ prey: [] }))
    expect(r.currentState).toBe('patrolling')
  })

  it('feeding sheds hunger and returns to patrol once sated', () => {
    const stillFeeding = feralTick(makeCreature({ current_state: 'feeding', hunger: 30 }), snap())
    expect(stillFeeding.currentState).toBe('feeding')
    expect(stillFeeding.hunger).toBe(10)
    const done = feralTick(makeCreature({ current_state: 'feeding', hunger: 10 }), snap())
    expect(done.currentState).toBe('patrolling')
    expect(done.hunger).toBe(0)
  })

  it('an unpositioned creature cannot detect prey', () => {
    const c = makeCreature({ hunger: 80, current_hex_q: null, current_hex_r: null })
    const r = feralTick(c, snap({ prey: [{ key: 'deer', q: 0, r: 0 }] }))
    expect(r.currentState).toBe('patrolling')
  })

  it('falls back to the creature id when creature_key is null', () => {
    const c = makeCreature({ creature_key: null })
    const r = feralTick(c, snap())
    expect(r.summary).toContain('c1')
  })

  it('treats a null current_state as patrolling', () => {
    const c = makeCreature({ current_state: null, hunger: 0 })
    const r = feralTick(c, snap())
    expect(r.currentState).toBe('patrolling')
  })
})

describe('shaperTick', () => {
  const shaper = (o: Partial<CreatureAiState> = {}) =>
    makeCreature({ predator_taxonomy: 'shaper', creature_key: 'creature:shaper', ...o })

  it('builds creative drive while patrolling with nothing to work', () => {
    const r = shaperTick(shaper({ current_state: 'patrolling', creative_drive: 0 }), snap())
    expect(r.creativeDrive).toBe(10)
    expect(r.currentState).toBe('patrolling')
  })

  it('inspired + prey in range → begins stalking', () => {
    const r = shaperTick(
      shaper({ current_state: 'patrolling', creative_drive: 45 }),
      snap({ prey: [{ key: 'subject', q: 2, r: 0 }] }),
    )
    expect(r.currentState).toBe('stalking')
    expect(r.targetHexQ).toBe(2)
  })

  it('inspired but no prey → keeps pacing', () => {
    const r = shaperTick(shaper({ current_state: 'patrolling', creative_drive: 45 }), snap())
    expect(r.currentState).toBe('patrolling')
  })

  it('prefers prey matching its yield preference over the nearest', () => {
    const r = shaperTick(
      shaper({
        current_state: 'patrolling',
        creative_drive: 45,
        territory_radius: 8,
        yield_preference: 'grade-a',
      }),
      snap({
        prey: [
          { key: 'closer', q: 1, r: 0, yieldGrade: 'grade-b' },
          { key: 'preferred', q: 3, r: 0, yieldGrade: 'grade-a' },
        ],
      }),
    )
    expect(r.currentState).toBe('stalking')
    expect(r.targetHexQ).toBe(3) // the grade-a subject, though farther
  })

  it('falls back to nearest when no prey matches the yield preference', () => {
    const r = shaperTick(
      shaper({
        current_state: 'patrolling',
        creative_drive: 45,
        territory_radius: 8,
        yield_preference: 'grade-z',
      }),
      snap({
        prey: [
          { key: 'closer', q: 1, r: 0, yieldGrade: 'grade-b' },
          { key: 'farther', q: 3, r: 0, yieldGrade: 'grade-a' },
        ],
      }),
    )
    expect(r.targetHexQ).toBe(1)
  })

  it('stalking with the subject lost → returns to patrol', () => {
    const r = shaperTick(shaper({ current_state: 'stalking' }), snap({ prey: [] }))
    expect(r.currentState).toBe('patrolling')
  })

  it('stalking closes distance without seizing', () => {
    const r = shaperTick(
      shaper({ current_state: 'stalking', movement_speed: 1 }),
      snap({ prey: [{ key: 'subject', q: 3, r: 0 }] }),
    )
    expect(r.currentState).toBe('stalking')
    expect(r.moved).toBe(true)
    expect(r.claim).toBeUndefined()
  })

  it('stalking to melee seizes prey: sets claim, flags encounter, begins tenderizing', () => {
    const r = shaperTick(
      shaper({ current_state: 'stalking', movement_speed: 3 }),
      snap({ prey: [{ key: 'subject', q: 2, r: 0 }] }),
    )
    expect(r.currentState).toBe('tenderizing')
    expect(r.claim?.targetKey).toBe('subject')
    expect(r.claim?.until).toBe('2187-01-13T00:00:00.000Z')
    expect(r.flaggedEvent?.eventType).toBe('creature_tenderize')
    expect(r.flaggedEvent?.resourceLocks).toEqual(['subject'])
  })

  it('tenderizing hauls a claimed subject toward the atelier', () => {
    const r = shaperTick(
      shaper({
        current_state: 'tenderizing',
        atelier_hex_q: 5,
        atelier_hex_r: 5,
        movement_speed: 2,
      }),
      snap({ prey: [{ key: 'subject', q: 0, r: 0, claimedBy: 'creature:shaper' }] }),
    )
    expect(r.currentState).toBe('tenderizing')
    expect(r.moved).toBe(true)
    expect(r.claim?.targetKey).toBe('subject')
  })

  it('tenderizing works in place once at the atelier', () => {
    const r = shaperTick(
      shaper({
        current_state: 'tenderizing',
        current_hex_q: 5,
        current_hex_r: 5,
        atelier_hex_q: 5,
        atelier_hex_r: 5,
      }),
      snap({ prey: [{ key: 'subject', q: 5, r: 5, claimedBy: 'creature:shaper' }] }),
    )
    expect(r.moved).toBe(false)
    expect(r.summary).toContain('atelier')
  })

  it('tenderizing with no atelier works the subject in place', () => {
    const r = shaperTick(
      shaper({ current_state: 'tenderizing' }),
      snap({ prey: [{ key: 'subject', q: 0, r: 0, claimedBy: 'creature:shaper' }] }),
    )
    expect(r.moved).toBe(false)
    expect(r.claim?.targetKey).toBe('subject')
  })

  it('tenderizing with the subject gone → returns to patrol', () => {
    const r = shaperTick(shaper({ current_state: 'tenderizing' }), snap({ prey: [] }))
    expect(r.currentState).toBe('patrolling')
  })

  it('an unpositioned shaper cannot stalk', () => {
    const r = shaperTick(
      shaper({
        current_state: 'patrolling',
        creative_drive: 45,
        current_hex_q: null,
        current_hex_r: null,
      }),
      snap({ prey: [{ key: 'subject', q: 0, r: 0 }] }),
    )
    expect(r.currentState).toBe('patrolling')
  })
})

describe('creatureAiTick dispatch', () => {
  it('routes feral to feralTick', () => {
    const r = creatureAiTick(makeCreature({ predator_taxonomy: 'feral' }), snap())
    expect(r.taxonomy).toBe('feral')
    expect(r.changed).toBe(true)
  })

  it('routes shaper to shaperTick', () => {
    const r = creatureAiTick(makeCreature({ predator_taxonomy: 'shaper' }), snap())
    expect(r.creativeDrive).toBe(10)
  })

  it('parasitic is a documented no-op stub', () => {
    const r = creatureAiTick(makeCreature({ predator_taxonomy: 'parasitic' }), snap())
    expect(r.changed).toBe(false)
    expect(r.summary).toContain('parasitic')
  })

  it('environmental is a documented no-op stub', () => {
    const r = creatureAiTick(makeCreature({ predator_taxonomy: 'environmental' }), snap())
    expect(r.changed).toBe(false)
    expect(r.summary).toContain('environmental')
  })

  it('an unknown taxonomy is an inert no-op (uses id when key is null)', () => {
    const r = creatureAiTick(
      makeCreature({ predator_taxonomy: 'eldritch', creature_key: null }),
      snap(),
    )
    expect(r.changed).toBe(false)
    expect(r.summary).toContain('unknown taxonomy')
    expect(r.summary).toContain('c1')
  })
})
