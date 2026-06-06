// src/constants.ts

export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Admin-Secret, X-Api-Key',
}

export const HISTORY_DEPTH = 20          // was 5 — deeper protection against bad overwrites
export const CHANGELOG_KEY = '_changelog' // hidden from topic listings, like _history:*
export const CHANGELOG_MAX = 500          // rolling window of write events

export const RATE_LIMIT_WINDOW_MS = 60_000
export const RATE_LIMIT_MAX = 12000
