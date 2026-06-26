// tests/integration/character-manage.test.ts
// Integration test: character_manage — RPG character sheet management

import { describe, it, expect, beforeEach } from 'vitest'
import { createMockContext } from '../unit/mocks'
import { toolRegistry } from '../../src/tools/registry'

function callChar(ctx: ReturnType<typeof createMockContext>, args: Record<string, unknown>) {
  const handler = toolRegistry['character_manage']
  return handler({ c: ctx, id: 'test-id', isAuthenticated: true, args })
}

async function jsonBody(res: Response): Promise<any> {
  const body = await res.json()
  return body.result ?? body
}

describe('Character management integration', () => {
  let ctx: ReturnType<typeof createMockContext>

  beforeEach(() => {
    ctx = createMockContext({}, { rpgDb: true })
  })

  describe('Character lifecycle', () => {
    it('creates, lists, updates characters', async () => {
      // 1. CREATE
      const createRes = await callChar(ctx, {
        action: 'create',
        name: 'Lyra Nightshade',
        race: 'Elf',
        characterClass: 'Ranger',
        level: 1,
      })
      const createBody = await jsonBody(createRes)
      expect(createBody.ok).toBe(true)
      expect(createBody.characterId).toBeDefined()
      const charId = createBody.characterId

      // 2. LIST
      const listRes = await callChar(ctx, { action: 'list' })
      const listBody = await jsonBody(listRes)
      expect(listBody.ok).toBe(true)
      expect(listBody.characters).toBeDefined()

      // 3. UPDATE
      const updateRes = await callChar(ctx, {
        action: 'update',
        id: charId,
        name: 'Lyra Shadowstalker',
        level: 2,
      })
      const updateBody = await jsonBody(updateRes)
      expect(updateBody.ok).toBe(true)
    })
  })

  describe('Character abilities', () => {
    let charId = 'test-char-id'

    beforeEach(async () => {
      const createRes = await callChar(ctx, {
        action: 'create',
        name: 'Grom Stonefist',
        race: 'Dwarf',
        characterClass: 'Fighter',
        level: 3,
        stats: { str: 16, dex: 12, con: 14, int: 10, wis: 8, cha: 10 },
      })
      const createBody = await jsonBody(createRes)
      charId = createBody.characterId ?? charId
    })

    it('levels up a character', async () => {
      const res = await callChar(ctx, {
        action: 'level_up',
        id: charId,
      })
      const body = await jsonBody(res)
      expect(body.ok).toBe(true)
    })

    it('adds xp to a character', async () => {
      const res = await callChar(ctx, {
        action: 'add_xp',
        id: charId,
        amount: 500,
      })
      const body = await jsonBody(res)
      expect(body.ok).toBe(true)
    })
  })
})
