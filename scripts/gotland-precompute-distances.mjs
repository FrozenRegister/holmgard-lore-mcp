#!/usr/bin/env node
// Offline, one-time precomputation of real foot-routing distances between
// Gotland's proposed initial waypoint set (#328). Run manually — this is
// NEVER invoked from the Worker's request path (see the "no live routing
// calls" decision in docs/gotland-waypoint-movement.md and migration 0021's
// header comment).
//
// Usage: node scripts/gotland-precompute-distances.mjs
//
// Reads schema/seed-data/gotland-waypoints.json (name/lat/lon/kind), calls
// the free OSRM demo instance's foot-routing profile for every ordered pair,
// and writes schema/seed-data/gotland-distance-matrix.json. Also derives and
// writes back each waypoint's (q, r) hex coordinate using the same
// origin+scale transform waypoint-manage.ts uses at runtime (geo-transform.ts),
// so the checked-in seed file always ships both real coordinates and their
// derived hex position together.
//
// No route found is represented as distanceKm: null, routeSource:
// 'osrm_foot_v1_no_route' — this is how waypoint-manage.ts's
// getWaypointDistance surfaces a structured "blocked" response, not a tool
// error. (In practice, OSRM's foot profile finds a route across every pair
// in the initial 4-waypoint Gotland set, including Fårösund — apparently
// via the free ferry crossing — so this seed data alone doesn't exercise
// the null case; a deliberately-unrouted pair is covered by unit tests.)

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const WAYPOINTS_PATH = join(__dirname, '..', 'schema', 'seed-data', 'gotland-waypoints.json')
const MATRIX_PATH = join(__dirname, '..', 'schema', 'seed-data', 'gotland-distance-matrix.json')

const OSRM_BASE = 'https://router.project-osrm.org/route/v1/foot'

// Origin = Visby at hex (0, 0). Must match waypoint-manage.ts's calibrate
// defaults used for this campaign's world_state row.
const ORIGIN = { originLat: 57.6349, originLon: 18.2948, kmPerHex: 3 }
const SQRT3 = Math.sqrt(3)
const KM_PER_DEGREE_LAT = 111.32

function latLonToHex(lat, lon, origin) {
  const originLatRad = (origin.originLat * Math.PI) / 180
  const xKm = (lon - origin.originLon) * KM_PER_DEGREE_LAT * Math.cos(originLatRad)
  const yKm = (origin.originLat - lat) * KM_PER_DEGREE_LAT
  const r = yKm / (origin.kmPerHex * 1.5)
  const q = xKm / (origin.kmPerHex * SQRT3) - r / 2
  return { q: Math.round(q), r: Math.round(r) }
}

async function fetchRouteDistanceKm(from, to) {
  const url = `${OSRM_BASE}/${from.lon},${from.lat};${to.lon},${to.lat}?overview=false`
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const body = await res.json()
    if (body.code !== 'Ok' || !body.routes?.[0]) return null
    return body.routes[0].distance / 1000
  } catch {
    return null
  }
}

async function main() {
  const waypoints = JSON.parse(readFileSync(WAYPOINTS_PATH, 'utf-8'))

  for (const wp of waypoints) {
    const hex = latLonToHex(wp.lat, wp.lon, ORIGIN)
    wp.q = hex.q
    wp.r = hex.r
  }
  writeFileSync(WAYPOINTS_PATH, JSON.stringify(waypoints, null, 2) + '\n')
  console.log(`Wrote derived hex coordinates for ${waypoints.length} waypoints to ${WAYPOINTS_PATH}`)

  const matrix = []
  for (const from of waypoints) {
    for (const to of waypoints) {
      if (from.name === to.name) continue
      const distanceKm = await fetchRouteDistanceKm(from, to)
      matrix.push({
        from: from.name,
        to: to.name,
        distanceKm,
        routeSource: distanceKm === null ? 'osrm_foot_v1_no_route' : 'osrm_foot_v1',
      })
      console.log(`${from.name} -> ${to.name}: ${distanceKm === null ? 'NO ROUTE' : distanceKm.toFixed(2) + ' km'}`)
      // Small delay between requests — one-time manual run against the free
      // community OSRM demo instance, not a production dependency.
      await new Promise(r => setTimeout(r, 300))
    }
  }
  writeFileSync(MATRIX_PATH, JSON.stringify(matrix, null, 2) + '\n')
  console.log(`Wrote ${matrix.length} pairwise distances to ${MATRIX_PATH}`)
}

main()
