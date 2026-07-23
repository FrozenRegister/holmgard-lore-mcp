import { describe, it, expect } from 'vitest'
import { coerceTransportArgs } from '@/lib/coerce-transport-args'

describe('coerceTransportArgs (#505)', () => {
  it('coerces a stringified boolean', () => {
    expect(coerceTransportArgs({ merge: 'true' })).toEqual({ merge: true })
    expect(coerceTransportArgs({ merge: 'false' })).toEqual({ merge: false })
  })

  it('coerces stringified integers and floats, including negatives', () => {
    expect(coerceTransportArgs({ movementCost: '42' })).toEqual({ movementCost: 42 })
    expect(coerceTransportArgs({ weight: '0.7' })).toEqual({ weight: 0.7 })
    expect(coerceTransportArgs({ elevation: '-5' })).toEqual({ elevation: -5 })
  })

  it('coerces a stringified array of objects', () => {
    const input = { hexes: '[{"q":0,"r":0},{"q":1,"r":0}]' }
    expect(coerceTransportArgs(input)).toEqual({
      hexes: [
        { q: 0, r: 0 },
        { q: 1, r: 0 },
      ],
    })
  })

  it('coerces a stringified nested object', () => {
    const input = { exits: '{"north":"room-2","south":null}' }
    expect(coerceTransportArgs(input)).toEqual({ exits: { north: 'room-2', south: null } })
  })

  it('coerces a stringified null', () => {
    expect(coerceTransportArgs({ value: 'null' })).toEqual({ value: null })
  })

  it('recurses through double-stringified array elements', () => {
    // Array whose own elements were independently stringified before the
    // array itself was stringified.
    const input = { costs: '["1","2","true"]' }
    expect(coerceTransportArgs(input)).toEqual({ costs: [1, 2, true] })
  })

  it('leaves ordinary prose strings untouched', () => {
    const input = { text: 'The road forks north toward the ridge.' }
    expect(coerceTransportArgs(input)).toEqual(input)
  })

  it('leaves non-numeric id-like strings untouched', () => {
    const input = { key: 'character:test-npc' }
    expect(coerceTransportArgs(input)).toEqual(input)
  })

  it('leaves malformed JSON-looking strings untouched', () => {
    const input = { note: '[unterminated array' }
    expect(coerceTransportArgs(input)).toEqual(input)
  })

  it('leaves an empty string untouched', () => {
    expect(coerceTransportArgs({ note: '' })).toEqual({ note: '' })
  })

  it('leaves already-correct types untouched', () => {
    const input = { count: 3, active: true, tags: ['a', 'b'], meta: { x: 1 } }
    expect(coerceTransportArgs(input)).toEqual(input)
  })

  it('leaves null and non-object/array/string scalars untouched', () => {
    expect(coerceTransportArgs(null)).toBeNull()
    expect(coerceTransportArgs(5)).toBe(5)
    expect(coerceTransportArgs(true)).toBe(true)
  })

  it('recurses into nested objects and arrays of objects', () => {
    const input = {
      attributes: { 'weight-1': '0.7', merge: 'true' },
      items: [{ id: 'a', qty: '3' }],
    }
    expect(coerceTransportArgs(input)).toEqual({
      attributes: { 'weight-1': 0.7, merge: true },
      items: [{ id: 'a', qty: 3 }],
    })
  })
})
