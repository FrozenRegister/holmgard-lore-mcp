// src/lib/cache.ts — request-scoped caching utilities

// Cache entry types
interface RequestCache {
  kvListKeys: string[] | null
  kvListMapsKeys: string[] | null
}

// Symbol to store cache on context objects without pollution
const CACHE_SYMBOL = Symbol('RequestCache')

/**
 * Get or initialize a request-scoped cache on a context object.
 * The cache persists for the lifetime of a single HTTP request and is
 * cleared before response is sent.
 */
export function getRequestCache(c: any): RequestCache {
  if (!c[CACHE_SYMBOL]) {
    c[CACHE_SYMBOL] = {
      kvListKeys: null,
      kvListMapsKeys: null,
    }
  }
  return c[CACHE_SYMBOL]
}

/**
 * Clear all caches on a context object.
 * Call this after any mutation (set_lore, delete_lore, patch_lore, etc.)
 * to ensure subsequent reads see the updated KV state.
 */
export function clearRequestCache(c: any): void {
  if (c[CACHE_SYMBOL]) {
    c[CACHE_SYMBOL].kvListKeys = null
    c[CACHE_SYMBOL].kvListMapsKeys = null
  }
}

/**
 * Set the kvList cache to a specific value.
 * Used after successful list operations.
 */
export function setKvListCache(c: any, keys: string[]): void {
  const cache = getRequestCache(c)
  cache.kvListKeys = keys
}

/**
 * Get the cached kvList result, or null if not cached.
 */
export function getKvListCache(c: any): string[] | null {
  const cache = getRequestCache(c)
  return cache.kvListKeys
}

/**
 * Set the kvListMaps cache to a specific value.
 */
export function setKvListMapsCache(c: any, keys: string[]): void {
  const cache = getRequestCache(c)
  cache.kvListMapsKeys = keys
}

/**
 * Get the cached kvListMaps result, or null if not cached.
 */
export function getKvListMapsCache(c: any): string[] | null {
  const cache = getRequestCache(c)
  return cache.kvListMapsKeys
}
