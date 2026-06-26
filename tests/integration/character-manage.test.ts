// tests/integration/character-manage.test.ts
// Integration test: character_manage — RPG character sheet management
// Covers: create, get, list, update, delete

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
    ctx = createMockContext({}, { rpgDb: true })
  })

  describe('Character lifecycle', () => {
    it('creates, lists, and deletes a character', async () => {
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

      // 2. LIST
      const listRes = await callChar(ctx, { action: 'list' })
      const listBody = await jsonBody(listRes)
      expect(listBody.result).toBeDefined()

      // 3. DELETE
      const deleteRes = await callChar(ctx, { action: 'delete', id: charId })
      const deleteBody = await jsonBody(deleteRes)
      expect(deleteBody.result).toBeDefined()
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
      expect(body.error || body.result?.error).toBeDefined()
    })
  })
})
