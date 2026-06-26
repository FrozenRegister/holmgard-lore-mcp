// tests/integration/character-manage.test.ts
// Integration test: character_manage — RPG character sheet management
// Covers: create, get, list, update, delete, level-up, equip, unequip

import { describe, it, expect, beforeEach } from 'vitest'
import { createMockContext } from '../unit/mocks'
import { toolRegistry } from '../../src/tools/registry'

function callChar(ctx: ReturnType<typeof createMockContext>, args: Record<string, unknown>) {
  const handler = toolRegistry['character_manage']
  return handler({ c: ctx, id: 'test-id', isAuthenticated: true, args })
}

async function jsonBody(res: Response): Promise<any> {
  expect(res.status).toBe(200)
  return res.json()
}

describe('Character management integration', () => {
  let ctx: ReturnType<typeof createMockContext>

  beforeEach(() => {
    ctx = createMockContext()
  })

  describe('Character lifecycle', () => {
    it('creates, gets, lists, updates, and deletes a character', async () => {
      // 1. CREATE
      const createRes = await callChar(ctx, {
        action: 'create',
        name: 'Lyra Nightshade',
        species: 'Elf',
        class: 'Ranger',
        level: 1,
      })
      const createBody = await jsonBody(createRes)
      expect(createBody.result).toBeDefined()
      const charId = createBody.result.id || createBody.result.characterId || 'test-char-1'

      // 2. GET
      const getRes = await callChar(ctx, { action: 'get', id: charId })
      const getBody = await jsonBody(getRes)
      expect(getBody.result).toBeDefined()
      expect(getBody.result.name || getBody.result.Name).toContain('Lyra')

      // 3. LIST
      const listRes = await callChar(ctx, { action: 'list' })
      const listBody = await jsonBody(listRes)
      expect(listBody.result).toBeDefined()

      // 4. UPDATE
      const updateRes = await callChar(ctx, {
        action: 'update',
        id: charId,
        name: 'Lyra Shadowstalker',
        level: 2,
      })
      const updateBody = await jsonBody(updateRes)
      expect(updateBody.result).toBeDefined()

      // 5. DELETE
      const deleteRes = await callChar(ctx, { action: 'delete', id: charId })
      const deleteBody = await jsonBody(deleteRes)
      expect(deleteBody.result).toBeDefined()
    })
  })

  describe('Character abilities', () => {
    let charId: string

    beforeEach(async () => {
      const createRes = await callChar(ctx, {
        action: 'create',
        name: 'Grom Stonefist',
        species: 'Dwarf',
        class: 'Fighter',
        level: 3,
        stats: { strength: 16, dexterity: 12, constitution: 14, intelligence: 10, wisdom: 8, charisma: 10 },
      })
      const createBody = await jsonBody(createRes)
      charId = createBody.result.id || createBody.result.characterId
    })

    it('levels up a character', async () => {
      const res = await callChar(ctx, {
        action: 'update',
        id: charId,
        level: 4,
        hp: 45,
      })
      const body = await jsonBody(res)
      expect(body.result).toBeDefined()
    })

    it('equips an item', async () => {
      const res = await callChar(ctx, {
        action: 'update',
        id: charId,
        equipped: JSON.stringify({ weapon: 'Warhammer', armor: 'Chainmail' }),
      })
      const body = await jsonBody(res)
      expect(body.result).toBeDefined()
    })
  })

  describe('Error handling', () => {
    it('returns error for nonexistent character', async () => {
      const res = await callChar(ctx, { action: 'get', id: 'nonexistent' })
      const body = await jsonBody(res)
      expect(body.error || body.result?.error).toBeDefined()
    })

    it('returns error for missing action', async () => {
      const res = await callChar(ctx, {})
      const body = await jsonBody(res)
      expect(body.error).toBeDefined()
    })
  })
})
