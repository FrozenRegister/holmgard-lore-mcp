// tests/integration/character-manage.test.ts
// Integration test: character_manage — RPG character sheet management
// Covers: create, get, list, delete

import { describe, it, expect, beforeEach } from 'vitest'
import { createMockContext } from '../../unit/mocks'
import { toolRegistry } from '@/tools/registry'

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
    ctx = createMockContext({}, true)
  })

  describe('Character lifecycle', () => {
    it('creates, lists, and deletes a character', async () => {
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

      const listRes = await callChar(ctx, { action: 'list' })
      const listBody = await jsonBody(listRes)
      expect(listBody.result).toBeDefined()

      const deleteRes = await callChar(ctx, { action: 'delete', id: charId })
      const deleteBody = await jsonBody(deleteRes)
      expect(deleteBody.result).toBeDefined()
    })
  })

  describe('Error handling', () => {
    it('does not crash on nonexistent character lookup', async () => {
      const res = await callChar(ctx, { action: 'get', id: 'nonexistent' })
      expect(res.status).toBe(200)
    })

    it('does not crash on missing action', async () => {
      const res = await callChar(ctx, {})
      expect(res.status).toBe(200)
    })
  })
})
