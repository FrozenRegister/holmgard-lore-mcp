import { describe, it, expect } from 'vitest'
import { resolveAlias, ACTION_ALIASES } from './action-aliases'

describe('resolveAlias (#404 Tier 2)', () => {
  it('rewrites character.place_character to spawn.place_character', () => {
    expect(resolveAlias('character', 'place_character')).toEqual({ sub: 'spawn', action: 'place_character' })
  })

  it('rewrites character.move_hex to travel.move_hex', () => {
    expect(resolveAlias('character', 'move_hex')).toEqual({ sub: 'travel', action: 'move_hex' })
  })

  it('rewrites world_map.move_hex to travel.move_hex', () => {
    expect(resolveAlias('world_map', 'move_hex')).toEqual({ sub: 'travel', action: 'move_hex' })
  })

  it('rewrites party.place_character to spawn.place_character', () => {
    expect(resolveAlias('party', 'place_character')).toEqual({ sub: 'spawn', action: 'place_character' })
  })

  it('leaves an unaliased action on a sub with other aliases unchanged', () => {
    expect(resolveAlias('character', 'create')).toEqual({ sub: 'character', action: 'create' })
  })

  it('leaves a sub with no aliases at all unchanged', () => {
    expect(resolveAlias('math', 'roll')).toEqual({ sub: 'math', action: 'roll' })
  })

  it('leaves an unrecognized sub unchanged', () => {
    expect(resolveAlias('not-a-real-sub', 'anything')).toEqual({ sub: 'not-a-real-sub', action: 'anything' })
  })

  it('every alias target resolves to a real handler sub, not another alias source', () => {
    const targetSubs = new Set(Object.keys(ACTION_ALIASES))
    for (const subAliases of Object.values(ACTION_ALIASES)) {
      for (const { sub } of Object.values(subAliases)) {
        expect(targetSubs.has(sub)).toBe(false)
      }
    }
  })
})
