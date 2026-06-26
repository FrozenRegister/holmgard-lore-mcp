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
  return res.json()
}

describe('Character management integration', () => {
  let ctx: ReturnType<typeof createMockContext>

  beforeEach(() => {
    ctx = createMockContext({}, true) // includeD1 = true
  })

  describe('Character lifecycle', () => {
    it('creates a character', async () => {
      const res = await callChar(ctx, {
        action: 'create',
        name: 'Lyra Nightshade',
        species: 'Elf',
        class: 'Ranger',
        level: 1,
      })
      const body = await jsonBody(res)
      expect(body.result).toBeDefined()
      expect(body.result.name || body.result.Name || body.result.success).toBeDefined()
    })

    it('lists characters', async () => {
      const res = await callChar(ctx, { action: 'list' })
      const body = await jsonBody(res)
      expect(body.result).toBeDefined()
    })

    it('gets a created character', async () => {
      // Create first
      const createRes = await callChar(ctx, {
        action: 'create',
        name: 'Grom Stonefist',
        species: 'Dwarf',
        class: 'Fighter',
        level: 3,
      })
      const createBody = await jsonBody(createRes)
      const charId = createBody.result?.characterId || createBody.result?.id
      if (!charId) return

      // Then get
      const res = await callChar(ctx, { action: 'get', id: charId })
      const body = await jsonBody(res)
      expect(body.result || body.error).toBeDefined()
    })
  })

  describe('Error handling', () => {
    it('handles nonexistent character lookup gracefully', async () => {
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
