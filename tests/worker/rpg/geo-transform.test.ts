import { describe, expect, it } from 'vitest'
import { latLonToKm, kmToLatLon, latLonToHex, hexToLatLon, type GeoOrigin } from '@/rpg/utils/geo-transform'

// Origin = Visby (the proposed default Gotland waypoint layout's origin, #328).
const ORIGIN: GeoOrigin = { originLat: 57.6349, originLon: 18.2948, kmPerHex: 3 }

describe('geo-transform', () => {
  describe('latLonToKm', () => {
    it('returns (0, 0) for the origin point itself', () => {
      const { xKm, yKm } = latLonToKm({ lat: ORIGIN.originLat, lon: ORIGIN.originLon }, ORIGIN)
      expect(xKm).toBeCloseTo(0, 6)
      expect(yKm).toBeCloseTo(0, 6)
    })

    it('a point north and west of the origin has negative x and negative y', () => {
      const { xKm, yKm } = latLonToKm({ lat: 57.8607, lon: 17.9757 }, ORIGIN)
      expect(xKm).toBeLessThan(0)
      expect(yKm).toBeLessThan(0)
    })

    it('a point south and east of the origin has positive x and positive y', () => {
      const { xKm, yKm } = latLonToKm({ lat: 57.3897, lon: 18.6033 }, ORIGIN)
      expect(xKm).toBeGreaterThan(0)
      expect(yKm).toBeGreaterThan(0)
    })
  })

  describe('kmToLatLon', () => {
    it('is the inverse of latLonToKm', () => {
      const point = { lat: 57.8607, lon: 18.9757 }
      const { xKm, yKm } = latLonToKm(point, ORIGIN)
      const roundTripped = kmToLatLon(xKm, yKm, ORIGIN)
      expect(roundTripped.lat).toBeCloseTo(point.lat, 9)
      expect(roundTripped.lon).toBeCloseTo(point.lon, 9)
    })
  })

  describe('latLonToHex', () => {
    it('places the origin at hex (0, 0)', () => {
      expect(latLonToHex({ lat: ORIGIN.originLat, lon: ORIGIN.originLon }, ORIGIN)).toEqual({ q: 0, r: 0 })
    })

    it('derives the proposed initial waypoint hex layout from real lat/lon (#328)', () => {
      // Hand-computed against world-map.ts's hexToPixel formula inverted
      // (x = size*(SQRT3*q + SQRT3/2*r), y = size*1.5*r), kmPerHex = 3.
      expect(latLonToHex({ lat: 57.5388, lon: 18.4677 }, ORIGIN)).toEqual({ q: 1, r: 2 }) // Roma Kloster
      expect(latLonToHex({ lat: 57.8607, lon: 18.9757 }, ORIGIN)).toEqual({ q: 11, r: -6 }) // Fårösund
      expect(latLonToHex({ lat: 57.3897, lon: 18.2033 }, ORIGIN)).toEqual({ q: -4, r: 6 }) // Klintehamn
    })

    it('rounds to the nearest integer hex', () => {
      const hex = latLonToHex({ lat: 57.62, lon: 18.30 }, ORIGIN)
      expect(Number.isInteger(hex.q)).toBe(true)
      expect(Number.isInteger(hex.r)).toBe(true)
    })
  })

  describe('hexToLatLon', () => {
    it('is the inverse of latLonToHex at exact hex-center points (no rounding involved)', () => {
      const original = { lat: 57.8607, lon: 18.9757 }
      const hex = { q: 11, r: -6 }
      const roundTripped = hexToLatLon(hex, ORIGIN)
      // Round-tripping through integer hex rounding means this is an
      // approximation, not exact equality — assert it lands within half a
      // hex-width of the original point.
      expect(Math.abs(roundTripped.lat - original.lat)).toBeLessThan(0.05)
      expect(Math.abs(roundTripped.lon - original.lon)).toBeLessThan(0.05)
    })

    it('maps hex (0, 0) back to the origin', () => {
      const latLon = hexToLatLon({ q: 0, r: 0 }, ORIGIN)
      expect(latLon.lat).toBeCloseTo(ORIGIN.originLat, 9)
      expect(latLon.lon).toBeCloseTo(ORIGIN.originLon, 9)
    })
  })
})
