/**
 * Claims System - Cross-tick resource locking and conflict resolution
 *
 * Implements #440 §3.3 (Resource Locking) and #444 (Cross-tick claims + conflict resolution)
 * Enables predators to claim characters for multi-tick projects (e.g., Shaper tenderizing)
 * and resolves conflicts when multiple events target the same resource in a single tick.
 */

import type { AppBindings } from '../../types'
import { getCharacter, updateCharacter } from '../handlers/character-manage'

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
  targetKey: string
): Promise<{ claimedBy: string | null; claimedUntil: string | null; claimedAt: string | null }> {
  const char = await getCharacter(env, db, targetKey)
  if (!char) {
    throw new Error(`Character not found: ${targetKey}`)
  }

  return {
    claimedBy: char.claimed_by as string | null,
    claimedUntil: char.claimed_until as string | null,
    claimedAt: char.claimed_at as string | null
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
  allowSelfClaim: boolean = false
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

  // Check for existing active claim
  if (char.claimed_by && char.claimed_until) {
    const now = new Date(tickTimestamp)
    const claimedUntil = new Date(char.claimed_until as string)

    if (claimedUntil > now) {
      // Active claim exists - reject with conflict information
      return {
        success: false,
        conflict: {
          claimerKey: char.claimed_by as string,
          claimedUntil: char.claimed_until as string
        }
      }
    }
  }

  // Set the claim
  await updateCharacter(env, db, targetKey, {
    claimed_by: claimerKey,
    claimed_until: until,
    claimed_at: tickTimestamp
  })

  return { success: true }
}

/**
 * Clear a claim on a character
 */
export async function clearClaim(
  env: AppBindings,
  db: D1Database,
  targetKey: string
): Promise<void> {
  await updateCharacter(env, db, targetKey, {
    claimed_by: null,
    claimed_until: null,
    claimed_at: null
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
  db: D1Database
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

  // Process each target with multiple events
  for (const [targetKey, targetEvents] of eventsByTarget) {
    if (targetEvents.length === 1) {
      // No conflict - resolve normally
      results.push({ status: 'resolved', event: targetEvents[0] })
      continue
    }

    // Sort events by priority then FIFO
    const sortedEvents = [...targetEvents].sort((a, b) => {
      // First by priority
      const priorityOrder: Record<Priority, number> = {
        CRITICAL: 0,
        HIGH: 1,
        MEDIUM: 2,
        LOW: 3
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
                  claimedUntil: claim.claimedUntil || ''
                }
              }
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
                claimedUntil: claim.claimedUntil || ''
              }
            }
          })
        } else {
          // Conflict with higher priority event - defer
          results.push({
            status: 'deferred',
            event,
            retryAt: currentTickTime // Retry next tick
          })
        }
      }
    }
  }

  return results
}

/**
 * Clear claims for dead or removed predators
 *
 * @param _env - App bindings
 * @param _db - D1 database
 * @param _currentTickTime - Current tick timestamp
 */
export function clearDeadPredatorClaims(
  _env: AppBindings,
  _db: D1Database,
  _currentTickTime: string
): void {
  // This will be implemented in Phase 3 (creature AI)
  // For now, we rely on the stale-claim check in resolveTickConflicts
  console.log('clearDeadPredatorClaims: Phase 3 implementation pending')
}
