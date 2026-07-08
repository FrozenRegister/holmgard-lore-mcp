import { it, expect, beforeEach } from 'vitest'
import { describe, env } from './helpers'
import { setupRpgDb } from './setup-d1'
import { handleCharacterManage } from '../rpg/handlers/character-manage'
import type { AppBindings } from '../types'

// Helper to parse McpResponse
function parseResponse(mcpResponse: any) {
  const text = mcpResponse.content?.[0]?.text
  if (!text) return { error: true, message: 'No text in response' }
  try {
    return JSON.parse(text)
  } catch {
    return { error: true, message: `Failed to parse: ${text}` }
  }
}

describe('Character Snapshots', () => {
  beforeEach(async () => {
    await setupRpgDb(env.RPG_DB)
  })

  it('creates a snapshot of current character state', async () => {
    const testEnv = env as unknown as AppBindings

    // Create a character
    const createMcpResponse = await handleCharacterManage(testEnv, {
      action: 'create',
      name: 'Theron Blackforge',
      characterClass: 'Paladin',
      race: 'Human',
      level: 5,
      stats: { str: 16, dex: 12, con: 14, int: 10, wis: 13, cha: 11 },
    })

    const createResult = parseResponse(createMcpResponse)
    expect(createResult).toHaveProperty('success', true)
    expect((createResult as any).characterId).toBeDefined()
    const charId = (createResult as any).characterId

    // Snapshot the character
    const snapshotMcpResponse = await handleCharacterManage(testEnv, {
      action: 'snapshot',
      characterId: charId,
      narrativeNote: 'Baseline state at recruitment',
      capturedBy: 'manual',
    })

    const snapshotResult = parseResponse(snapshotMcpResponse)
    expect(snapshotResult).toHaveProperty('success', true)
    expect(snapshotResult).toHaveProperty('actionType', 'snapshot')
    expect((snapshotResult as any).snapshotId).toBeDefined()
    expect((snapshotResult as any).characterId).toBe(charId)
  })

  it('captures state for multiple snapshots of same character', async () => {
    const testEnv = env as unknown as AppBindings

    // Create character
    const createMcpResponse = await handleCharacterManage(testEnv, {
      action: 'create',
      name: 'Elowen Vex',
      characterClass: 'Rogue',
      race: 'Elf',
      level: 3,
      hp: 20,
      maxHp: 20,
    })

    const createResult = parseResponse(createMcpResponse)
    const charId = (createResult as any).characterId

    // First snapshot
    const snap1McpResponse = await handleCharacterManage(testEnv, {
      action: 'snapshot',
      characterId: charId,
      narrativeNote: 'Before combat',
    })

    const snap1Result = parseResponse(snap1McpResponse)
    expect(snap1Result).toHaveProperty('success', true)
    const snap1Id = (snap1Result as any).snapshotId

    // Update character (take damage)
    await handleCharacterManage(testEnv, {
      action: 'update',
      characterId: charId,
      hp: 8,
    })

    // Second snapshot
    const snap2McpResponse = await handleCharacterManage(testEnv, {
      action: 'snapshot',
      characterId: charId,
      narrativeNote: 'After combat, wounded',
    })

    const snap2Result = parseResponse(snap2McpResponse)
    expect(snap2Result).toHaveProperty('success', true)
    const snap2Id = (snap2Result as any).snapshotId

    // Snapshots should have different IDs
    expect(snap1Id).not.toBe(snap2Id)

    // Verify both snapshots exist in database
    const db = testEnv.RPG_DB!
    const snap1Row = await db.prepare('SELECT * FROM character_snapshots WHERE id = ?').bind(snap1Id).first()
    const snap2Row = await db.prepare('SELECT * FROM character_snapshots WHERE id = ?').bind(snap2Id).first()

    expect(snap1Row).toBeDefined()
    expect(snap2Row).toBeDefined()
  })

  it('requires characterId for snapshot action', async () => {
    const testEnv = env as unknown as AppBindings

    const resultMcpResponse = await handleCharacterManage(testEnv, {
      action: 'snapshot',
      // Missing characterId
    })

    const result = parseResponse(resultMcpResponse)
    expect(result).toHaveProperty('error', true)
  })

  it('rejects snapshot for non-existent character', async () => {
    const testEnv = env as unknown as AppBindings

    const resultMcpResponse = await handleCharacterManage(testEnv, {
      action: 'snapshot',
      characterId: 'non-existent-id',
    })

    const result = parseResponse(resultMcpResponse)
    expect(result).toHaveProperty('error', true)
    expect((result as any).message).toContain('not found')
  })

  it('stores stats in snapshot as JSON', async () => {
    const testEnv = env as unknown as AppBindings

    // Create character with specific stats
    const createMcpResponse = await handleCharacterManage(testEnv, {
      action: 'create',
      name: 'Stat Test',
      characterClass: 'Wizard',
      race: 'Human',
      stats: { str: 8, dex: 14, con: 12, int: 16, wis: 13, cha: 10 },
    })

    const createResult = parseResponse(createMcpResponse)
    const charId = (createResult as any).characterId

    // Snapshot
    const snapshotMcpResponse = await handleCharacterManage(testEnv, {
      action: 'snapshot',
      characterId: charId,
    })

    const snapshotResult = parseResponse(snapshotMcpResponse)
    const snapshotId = (snapshotResult as any).snapshotId

    // Verify snapshot in database
    const db = testEnv.RPG_DB!
    const row = await db.prepare('SELECT * FROM character_snapshots WHERE id = ?').bind(snapshotId).first()

    expect(row).toBeDefined()
    const stats = JSON.parse((row as any).stats_json)
    expect(stats).toEqual({ str: 8, dex: 14, con: 12, int: 16, wis: 13, cha: 10 })
  })

  it('stores custom state_json data in snapshot', async () => {
    const testEnv = env as unknown as AppBindings

    // Create character
    const createMcpResponse = await handleCharacterManage(testEnv, {
      action: 'create',
      name: 'Custom State Test',
      characterClass: 'Barbarian',
      race: 'Orc',
    })

    const createResult = parseResponse(createMcpResponse)
    const charId = (createResult as any).characterId

    // Snapshot with custom state
    const customState = {
      limbs: 4,
      conditions: ['exhausted', 'charmed'],
      status: 'intact',
    }

    const snapshotMcpResponse = await handleCharacterManage(testEnv, {
      action: 'snapshot',
      characterId: charId,
      stateJson: customState,
    })

    const snapshotResult = parseResponse(snapshotMcpResponse)
    const snapshotId = (snapshotResult as any).snapshotId

    // Verify custom state stored
    const db = testEnv.RPG_DB!
    const row = await db.prepare('SELECT * FROM character_snapshots WHERE id = ?').bind(snapshotId).first()

    expect(row).toBeDefined()
    const stateJson = JSON.parse((row as any).state_json)
    expect(stateJson).toEqual(customState)
  })

  it('supports snapshot alias names', async () => {
    const testEnv = env as unknown as AppBindings

    // Create character
    const createMcpResponse = await handleCharacterManage(testEnv, {
      action: 'create',
      name: 'Alias Test',
      characterClass: 'Ranger',
      race: 'Human',
    })

    const createResult = parseResponse(createMcpResponse)
    const charId = (createResult as any).characterId

    // Use 'snap' alias
    const snapResultMcpResponse = await handleCharacterManage(testEnv, {
      action: 'snap',
      characterId: charId,
      narrativeNote: 'Using snap alias',
    })

    const snapResult = parseResponse(snapResultMcpResponse)
    expect(snapResult).toHaveProperty('success', true)
    expect((snapResult as any).actionType).toBe('snapshot')

    // Use 'save_state' alias
    const saveResultMcpResponse = await handleCharacterManage(testEnv, {
      action: 'save_state',
      characterId: charId,
      narrativeNote: 'Using save_state alias',
    })

    const saveResult = parseResponse(saveResultMcpResponse)
    expect(saveResult).toHaveProperty('success', true)
    expect((saveResult as any).actionType).toBe('snapshot')
  })
})
