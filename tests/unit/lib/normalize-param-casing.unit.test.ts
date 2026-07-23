import { describe, it, expect } from 'vitest'
import { normalizeParamCasing } from '@/lib/normalize-param-casing'

describe('normalizeParamCasing (#511)', () => {
  it('adds a camelCase alias for a snake_case key', () => {
    expect(normalizeParamCasing({ world_id: 'world:calder' })).toEqual({
      world_id: 'world:calder',
      worldId: 'world:calder',
    })
  })

  it('adds a snake_case alias for a camelCase key', () => {
    expect(normalizeParamCasing({ worldId: 'world:calder' })).toEqual({
      worldId: 'world:calder',
      world_id: 'world:calder',
    })
  })

  it('bridges multiple distinct keys in one call', () => {
    expect(
      normalizeParamCasing({ entity_key: 'character:kat', locationKey: 'location:tavern' }),
    ).toEqual({
      entity_key: 'character:kat',
      entityKey: 'character:kat',
      locationKey: 'location:tavern',
      location_key: 'location:tavern',
    })
  })

  it('does not overwrite a value already explicitly provided for the alias key', () => {
    expect(normalizeParamCasing({ world_id: 'snake-value', worldId: 'camel-value' })).toEqual({
      world_id: 'snake-value',
      worldId: 'camel-value',
    })
  })

  it('leaves keys with no casing counterpart untouched (no underscore, no uppercase)', () => {
    expect(normalizeParamCasing({ sub: 'world_map', action: 'get_tile', q: 0, r: 0 })).toEqual({
      sub: 'world_map',
      action: 'get_tile',
      q: 0,
      r: 0,
    })
  })

  it('preserves non-string values on both the original and aliased keys', () => {
    expect(normalizeParamCasing({ elevation_min: 10 })).toEqual({
      elevation_min: 10,
      elevationMin: 10,
    })
  })

  it('handles an empty args object', () => {
    expect(normalizeParamCasing({})).toEqual({})
  })
})
