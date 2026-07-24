/**
 * Claims System - Cross-tick resource locking and conflict resolution
 *
 * Implements #440 §3.3 (Resource Locking) and #444 (Cross-tick claims + conflict resolution)
 * Enables predators to claim characters for multi-tick projects (e.g., Shaper tenderizing)
 * and resolves conflicts when multiple events target the same resource in a single tick.
 */

import type { AppBindings } from '../../types'
import { getCharacter, updateCharacter } from '../handlers/character-manage'
import { syncCharacterToKv } from './character-sync'

// Priority tiers for conflict resolution
export type Priority = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'

// Flagged event interface for conflict resolution
export interface FlaggedEvent {
  id: string
  eventType: string
  priority: Priority
  targetKey: string
  sourceEntityKey: string
  payload: unknown
  resourceLocks: string[]
}

// Conflict resolution result types
export type ResolutionResult =
  | { status: 'resolved'; event: FlaggedEvent }
  | { status: 'modified'; event: FlaggedEvent; modification: EventModification }
  | { status: 'deferred'; event: FlaggedEvent; retryAt: string }

export interface EventModification {
  originalTarget: string
  newTarget?: string
  narrativeContext: string
  conflictWith: {
    claimerKey: string
    claimedAt: string
    claimedUntil: string
  }
}

/**
 * Get claim information for a character
 */
export async function getClaim(
  env: AppBindings,
  db: D1Database,
  targetKey: string,
): Promise<{ claimedBy: string | null; claimedUntil: string | null; claimedAt: string | null }> {
  const char = await getCharacter(env, db, targetKey)
  if (!char) {
    throw new Error(`Character not found: ${targetKey}`)
  }

  return {
    claimedBy: char.claimed_by as string | null,
    claimedUntil: char.claimed_until as string | null,
    claimedAt: char.claimed_at as string | null,
  }
}

/**
 * Set a claim on a character with validation
 *
 * @param env - App bindings
 * @param db - D1 database
 * @param targetKey - Character to claim (lore key)
 * @param claimerKey - Entity claiming the character (lore key)
 * @param until - When the claim expires (in-game datetime)
 * @param tickTimestamp - Current tick timestamp (in-game datetime)
 * @param allowSelfClaim - Whether to allow self-claiming
 * @returns true if claim was set, false if claim was rejected
 */
export async function setClaim(
  env: AppBindings,
  db: D1Database,
  targetKey: string,
  claimerKey: string,
  until: string,
  tickTimestamp: string,
  allowSelfClaim: boolean = false,
): Promise<{ success: boolean; conflict?: { claimerKey: string; claimedUntil: string } }> {
  // Validate claimer key
  if (!claimerKey || claimerKey.trim() === '') {
    throw new Error('Claimed_by cannot be empty')
  }

  // Check for self-claiming
  if (!allowSelfClaim && targetKey === claimerKey) {
    throw new Error('Self-claiming is not allowed')
  }

  const char = await getCharacter(env, db, targetKey)
  if (!char) {
    throw new Error(`Character not found: ${targetKey}`)
  }

  // Fast-path rejection based on the read above — avoids a wasted write in
  // the common (non-racing) case.
  if (char.claimed_by && char.claimed_until) {
    const now = new Date(tickTimestamp)
    const claimedUntil = new Date(char.claimed_until as string)

    if (claimedUntil > now) {
      // Active claim exists - reject with conflict information
      return {
        success: false,
        conflict: {
          claimerKey: char.claimed_by as string,
          claimedUntil: char.claimed_until as string,
        },
      }
    }
  }

  const charId = char.id as string
  const now = new Date().toISOString()

  // Atomic conditional write: the WHERE guard re-checks "no active claim" in
  // the same statement as the write, closing the read-then-write race between
  // the check above and this write. Without it, two concurrent setClaim calls
  // can both pass the check above and both write — the second silently
  // overwriting the first while both callers see { success: true }.
  const result = await db
    .prepare(
      `UPDATE characters SET claimed_by = ?, claimed_until = ?, claimed_at = ?, updated_at = ?
       WHERE id = ? AND (claimed_by IS NULL OR claimed_until <= ?)`,
    )
    .bind(claimerKey, until, tickTimestamp, now, charId, tickTimestamp)
    .run()

  if ((result.meta?.changes ?? 0) === 0) {
    // Lost the race: another claim was set between our read and this write.
    // Re-fetch so the conflict we report reflects the claim that actually won.
    const current = await getCharacter(env, db, targetKey)
    return {
      success: false,
      conflict: {
        claimerKey: current?.claimed_by as string,
        claimedUntil: current?.claimed_until as string,
      },
    }
  }

  await syncCharacterToKv(env, charId)
  return { success: true }
}

/**
 * Clear a claim on a character
 */
export async function clearClaim(
  env: AppBindings,
  db: D1Database,
  targetKey: string,
): Promise<void> {
  await updateCharacter(env, db, targetKey, {
    claimed_by: null,
    claimed_until: null,
    claimed_at: null,
  })
}

/**
 * Check if a claim is stale (expired)
 */
export function isStaleClaim(claimedUntil: string | null, currentTickTime: string): boolean {
  if (!claimedUntil) return true

  const now = new Date(currentTickTime)
  const claimedUntilDate = new Date(claimedUntil)
  return claimedUntilDate <= now
}

/**
 * Resolve conflicts between flagged events targeting the same resource
 *
 * @param events - Array of flagged events to resolve
 * @param currentTickTime - Current tick timestamp (in-game datetime)
 * @param env - App bindings
 * @param db - D1 database
 * @returns Array of resolution results
 */
export async function resolveTickConflicts(
  events: FlaggedEvent[],
  currentTickTime: string,
  env: AppBindings,
  db: D1Database,
): Promise<ResolutionResult[]> {
  // Group events by target resource
  const eventsByTarget = new Map<string, FlaggedEvent[]>()
  for (const event of events) {
    for (const lock of event.resourceLocks) {
      if (!eventsByTarget.has(lock)) {
        eventsByTarget.set(lock, [])
      }
      eventsByTarget.get(lock)!.push(event)
    }
  }

  const results: ResolutionResult[] = []

  // Process each target resource. Even a lone event on a target must still be
  // checked against an active claim below — it can't shortcut straight to
  // "resolved" just because nothing else is competing for the same lock this
  // tick.
  for (const [targetKey, targetEvents] of eventsByTarget) {
    // Sort events by priority then FIFO
    const sortedEvents = [...targetEvents].sort((a, b) => {
      // First by priority
      const priorityOrder: Record<Priority, number> = {
        CRITICAL: 0,
        HIGH: 1,
        MEDIUM: 2,
        LOW: 3,
      }
      if (priorityOrder[a.priority] !== priorityOrder[b.priority]) {
        return priorityOrder[a.priority] - priorityOrder[b.priority]
      }

      // Then by event ID (FIFO)
      return a.id.localeCompare(b.id)
    })

    // Get claim information for the target
    const claim = await getClaim(env, db, targetKey)
    const hasActiveClaim = claim.claimedBy && !isStaleClaim(claim.claimedUntil, currentTickTime)

    // Process events in priority order
    for (let i = 0; i < sortedEvents.length; i++) {
      const event = sortedEvents[i]

      if (i === 0) {
        // Highest priority event - always resolves
        if (hasActiveClaim) {
          // If the event source matches the claimer, it's "locked by me"
          if (event.sourceEntityKey === claim.claimedBy) {
            results.push({ status: 'resolved', event })
          } else {
            // Conflict with existing claim - modify the event
            results.push({
              status: 'modified',
              event,
              modification: {
                originalTarget: targetKey,
                narrativeContext: `The target was already claimed by ${claim.claimedBy}`,
                conflictWith: {
                  claimerKey: claim.claimedBy || '',
                  claimedAt: claim.claimedAt || '',
                  claimedUntil: claim.claimedUntil || '',
                },
              },
            })
          }
        } else {
          // No active claim - resolve normally
          results.push({ status: 'resolved', event })
        }
      } else {
        // Lower priority events - check for conflicts
        if (hasActiveClaim) {
          // Conflict with existing claim
          results.push({
            status: 'modified',
            event,
            modification: {
              originalTarget: targetKey,
              narrativeContext: `The target was already claimed by ${claim.claimedBy}`,
              conflictWith: {
                claimerKey: claim.claimedBy || '',
                claimedAt: claim.claimedAt || '',
                claimedUntil: claim.claimedUntil || '',
              },
            },
          })
        } else {
          // Conflict with higher priority event - defer
          results.push({
            status: 'deferred',
            event,
            retryAt: currentTickTime, // Retry next tick
          })
        }
      }
    }
  }

  return results
}

// Death-clearing (#445 Phase 3) only reconciles claims made by *creatures*.
// Creature claims use the claimant's creature_key, which follows the repo's
// lore-key namespace convention (`character:`, `setup:`, … → `creature:`). A
// claim whose claimed_by is not `creature:`-prefixed (e.g. a faction claim) is
// never touched here — only a creature that has been removed from
// creature_ai_state leaves a claim we are entitled to clear.
export const CREATURE_KEY_PREFIX = 'creature:'

/**
 * Clear claims left dangling by a dead or removed predator (#445 Phase 3).
 *
 * Runs at the start of creature_ai_tick: any character whose `claimed_by` is a
 * `creature:`-namespaced key that no longer corresponds to a live row in
 * `creature_ai_state` (for this world) has its claim released. This is the
 * proactive counterpart to `resolveTickConflicts`'s reactive stale-claim check
 * (which only treats an *expired* `claimed_until` as unclaimed) — a claim by a
 * creature that was deleted mid-project would otherwise pin its prey forever.
 *
 * Only creature-namespaced claims are considered, so faction/other claims are
 * left untouched.
 *
 * @returns the character keys whose claims were cleared
 */
export async function clearDeadPredatorClaims(
  env: AppBindings,
  db: D1Database,
  worldId: string,
): Promise<{ cleared: string[] }> {
  // Live creatures for this world → the set of claimant keys still valid.
  const { results: liveRows } = (await db
    .prepare(
      'SELECT creature_key FROM creature_ai_state WHERE world_id = ? AND creature_key IS NOT NULL',
    )
    .bind(worldId)
    .all()) as { results: Array<{ creature_key: string }> }
  const liveKeys = new Set(liveRows.map((r) => r.creature_key))

  // Every currently-claimed character (characters are not world-scoped in the
  // schema, so we filter to creature-namespaced claims instead).
  const { results: claimedRows } = (await db
    .prepare('SELECT id, claimed_by FROM characters WHERE claimed_by IS NOT NULL')
    .bind()
    .all()) as { results: Array<{ id: string; claimed_by: string }> }

  const cleared: string[] = []
  for (const row of claimedRows) {
    if (!row.claimed_by.startsWith(CREATURE_KEY_PREFIX)) continue
    if (liveKeys.has(row.claimed_by)) continue
    await clearClaim(env, db, row.id)
    cleared.push(row.id)
  }
  return { cleared }
}
