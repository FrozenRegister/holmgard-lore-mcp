// Real-world lat/lon <-> hex-axial (q, r) placement helper for the Gotland
// waypoint movement feature (#328).
//
// This is deliberately NOT a general N-point affine-fit/GCP calibration.
// Because this feature is *defining* an initial hex layout (not fitting a
// transform to independently-chosen hex positions), a single origin point +
// a single km-per-hex scale is sufficient: every other waypoint's (q, r) is
// derived directly from its real lat/lon. The km math reuses world-map.ts's
// existing hexToPixel formula verbatim, substituting kilometers for pixels:
//   x = size * (SQRT3 * q + (SQRT3 / 2) * r)
//   y = size * 1.5 * r
//
// Lat/lon -> km uses a local flat-earth approximation (equirectangular
// projection about the origin latitude), which is accurate enough at
// Gotland's ~150km extent — the authoritative travel distance always comes
// from the precomputed waypoint_distances table, never from hex position;
// hex position is for narrative/visual placement and the free-movement
// fallback only.

const SQRT3 = Math.sqrt(3)
const KM_PER_DEGREE_LAT = 111.32

export interface GeoOrigin {
  originLat: number
  originLon: number
  kmPerHex: number
}

export interface HexCoord {
  q: number
  r: number
}

export interface LatLon {
  lat: number
  lon: number
}

export function latLonToKm(point: LatLon, origin: Pick<GeoOrigin, 'originLat' | 'originLon'>): { xKm: number; yKm: number } {
  const originLatRad = (origin.originLat * Math.PI) / 180
  const xKm = (point.lon - origin.originLon) * KM_PER_DEGREE_LAT * Math.cos(originLatRad)
  const yKm = (origin.originLat - point.lat) * KM_PER_DEGREE_LAT
  return { xKm, yKm }
}

export function kmToLatLon(xKm: number, yKm: number, origin: Pick<GeoOrigin, 'originLat' | 'originLon'>): LatLon {
  const originLatRad = (origin.originLat * Math.PI) / 180
  const lon = origin.originLon + xKm / (KM_PER_DEGREE_LAT * Math.cos(originLatRad))
  const lat = origin.originLat - yKm / KM_PER_DEGREE_LAT
  return { lat, lon }
}

export function latLonToHex(point: LatLon, origin: GeoOrigin): HexCoord {
  const { xKm, yKm } = latLonToKm(point, origin)
  const r = yKm / (origin.kmPerHex * 1.5)
  const q = xKm / (origin.kmPerHex * SQRT3) - r / 2
  return { q: Math.round(q), r: Math.round(r) }
}

export function hexToLatLon(hex: HexCoord, origin: GeoOrigin): LatLon {
  const xKm = origin.kmPerHex * (SQRT3 * hex.q + (SQRT3 / 2) * hex.r)
  const yKm = origin.kmPerHex * 1.5 * hex.r
  return kmToLatLon(xKm, yKm, origin)
}
