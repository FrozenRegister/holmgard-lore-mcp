// tests/integration/rpg-engine.test.ts
// Integration test: rpg handler — dispatches across 27 sub-systems
// Covers at least one action per sub-system: math, world, character, party, quest,
//   item, inventory, corpse, narrative, secret, theft, aura, improvisation,
//   npc, session, combat, combat_action, combat_map, spawn, strategy, turn,
//   spatial, world_map, batch, travel, perception, scene

import { describe, it, expect, beforeEach } from 'vitest'
import { createMockContext } from '../unit/mocks'
import { toolRegistry } from '../../src/tools/registry'

const LOCATION_KEY = 'location:tavern'
const LOCATION_TEXT = `**Name:** The Rusty Flagon\n**Type:** tavern\n**Description:** A dimly lit tavern with a roaring hearth.`

function callRpg(ctx: ReturnType<typeof createMockContext>, args: Record<string, unknown>) {
  const handler = toolRegistry['rpg']
  return handler({ c: ctx, id: 'test-id', isAuthenticated: true, args })
}

async function jsonBody(res: Response): Promise<any> {
  expect(res.status).toBe(200)
  return res.json()
}

describe('RPG engine integration', () => {
  let ctx: ReturnType<typeof createMockContext>

  beforeEach(() => {
    ctx = createMockContext(
      { [LOCATION_KEY]: JSON.stringify({ text: LOCATION_TEXT, meta: { version: 1 } }) },
      { rpgDb: true }
    )
  })

  describe('Math subsystem', () => {
    it('rolls dice', async () => {
      const res = await callRpg(ctx, { sub: 'math', action: 'roll', dice: '2d6' })
      const body = await jsonBody(res)
      expect(body.result).toBeDefined()
    })

    it('rolls with modifier', async () => {
      const res = await callRpg(ctx, { sub: 'math', action: 'roll', dice: '1d20', modifier: 5 })
      const body = await jsonBody(res)
      expect(body.result).toBeDefined()
    })
  })

  describe('World subsystem', () => {
    it('gets world time', async () => {
      const res = await callRpg(ctx, { sub: 'world', action: 'get_time' })
      const body = await jsonBody(res)
      expect(body.result).toBeDefined()
    })
  })

  describe('Character subsystem', () => {
    it('creates a character', async () => {
      const res = await callRpg(ctx, {
        sub: 'character',
        action: 'create',
        name: 'Thorn',
        species: 'Human',
        class: 'Rogue',
      })
      const body = await jsonBody(res)
      expect(body.result).toBeDefined()
    })

    it('lists characters', async () => {
      const res = await callRpg(ctx, { sub: 'character', action: 'list' })
      const body = await jsonBody(res)
      expect(body.result).toBeDefined()
    })
  })

  describe('Party subsystem', () => {
    it('creates a party', async () => {
      const res = await callRpg(ctx, { sub: 'party', action: 'create', name: 'The Fellowship' })
      const body = await jsonBody(res)
      expect(body.result).toBeDefined()
    })

    it('lists parties', async () => {
      const res = await callRpg(ctx, { sub: 'party', action: 'list' })
      const body = await jsonBody(res)
      expect(body.result).toBeDefined()
    })
  })

  describe('Quest subsystem', () => {
    it('creates a quest', async () => {
      const res = await callRpg(ctx, {
        sub: 'quest',
        action: 'create',
        title: 'Find the Lost Artifact',
        description: 'Retrieve the Crystal of Eternity',
      })
      const body = await jsonBody(res)
      expect(body.result).toBeDefined()
    })

    it('lists quests', async () => {
      const res = await callRpg(ctx, { sub: 'quest', action: 'list' })
      const body = await jsonBody(res)
      expect(body.result).toBeDefined()
    })
  })

  describe('Item subsystem', () => {
    it('creates an item', async () => {
      const res = await callRpg(ctx, {
        sub: 'item',
        action: 'create',
        name: 'Iron Sword',
        type: 'weapon',
        damage: '1d8',
      })
      const body = await jsonBody(res)
      expect(body.result).toBeDefined()
    })

    it('lists items', async () => {
      const res = await callRpg(ctx, { sub: 'item', action: 'list' })
      const body = await jsonBody(res)
      expect(body.result).toBeDefined()
    })
  })

  describe('Inventory subsystem', () => {
    it('gets inventory', async () => {
      const res = await callRpg(ctx, { sub: 'inventory', action: 'get', characterId: 'test-char' })
      const body = await jsonBody(res)
      expect(body.result).toBeDefined()
    })
  })

  describe('Corpse subsystem', () => {
    it('lists corpses', async () => {
      const res = await callRpg(ctx, { sub: 'corpse', action: 'list' })
      const body = await jsonBody(res)
      expect(body.result).toBeDefined()
    })
  })

  describe('Narrative subsystem', () => {
    it('generates narration', async () => {
      const res = await callRpg(ctx, { sub: 'narrative', action: 'generate', prompt: 'Describe a dark forest' })
      const body = await jsonBody(res)
      expect(body.result).toBeDefined()
    })
  })

  describe('Secret subsystem', () => {
    it('lists secrets', async () => {
      const res = await callRpg(ctx, { sub: 'secret', action: 'list', characterId: 'test-char' })
      const body = await jsonBody(res)
      expect(body.result).toBeDefined()
    })
  })

  describe('Theft subsystem', () => {
    it('attempts theft', async () => {
      const res = await callRpg(ctx, {
        sub: 'theft',
        action: 'steal',
        thief: 'test-char',
        target: 'target-char',
        item: 'gold',
      })
      const body = await jsonBody(res)
      expect(body.result).toBeDefined()
    })
  })

  describe('Aura subsystem', () => {
    it('gets aura', async () => {
      const res = await callRpg(ctx, { sub: 'aura', action: 'get', characterId: 'test-char' })
      const body = await jsonBody(res)
      expect(body.result).toBeDefined()
    })
  })

  describe('Improvisation subsystem', () => {
    it('generates improv prompt', async () => {
      const res = await callRpg(ctx, { sub: 'improvisation', action: 'prompt', context: 'tavern' })
      const body = await jsonBody(res)
      expect(body.result).toBeDefined()
    })
  })

  describe('NPC subsystem', () => {
    it('lists NPCs', async () => {
      const res = await callRpg(ctx, { sub: 'npc', action: 'list' })
      const body = await jsonBody(res)
      expect(body.result).toBeDefined()
    })
  })

  describe('Session subsystem', () => {
    it('gets session', async () => {
      const res = await callRpg(ctx, { sub: 'session', action: 'get', id: 'session-1' })
      const body = await jsonBody(res)
      expect(body.result).toBeDefined()
    })
  })

  describe('Combat subsystem', () => {
    it('creates encounter', async () => {
      const res = await callRpg(ctx, {
        sub: 'combat',
        action: 'create_encounter',
        regionId: 'region-1',
        difficulty: 'medium',
      })
      const body = await jsonBody(res)
      expect(body.result).toBeDefined()
    })
  })

  describe('Combat action subsystem', () => {
    it('defends action', async () => {
      const res = await callRpg(ctx, { sub: 'combat_action', action: 'defend', characterId: 'char-1' })
      const body = await jsonBody(res)
      expect(body.result).toBeDefined()
    })
  })

  describe('Combat map subsystem', () => {
    it('creates combat map', async () => {
      const res = await callRpg(ctx, { sub: 'combat_map', action: 'create', width: 10, height: 10 })
      const body = await jsonBody(res)
      expect(body.result).toBeDefined()
    })
  })

  describe('Spawn subsystem', () => {
    it('spawns entity', async () => {
      const res = await callRpg(ctx, {
        sub: 'spawn',
        action: 'spawn',
        template: 'goblin',
        location: LOCATION_KEY,
        count: 3,
      })
      const body = await jsonBody(res)
      expect(body.result).toBeDefined()
    })
  })

  describe('Strategy subsystem', () => {
    it('evaluates strategy', async () => {
      const res = await callRpg(ctx, {
        sub: 'strategy',
        action: 'evaluate',
        characterId: 'char-1',
        situation: 'ambush',
      })
      const body = await jsonBody(res)
      expect(body.result).toBeDefined()
    })
  })

  describe('Turn subsystem', () => {
    it('starts turn', async () => {
      const res = await callRpg(ctx, { sub: 'turn', action: 'start', characterId: 'char-1' })
      const body = await jsonBody(res)
      expect(body.result).toBeDefined()
    })
  })

  describe('Spatial subsystem', () => {
    it('gets distance', async () => {
      const res = await callRpg(ctx, {
        sub: 'spatial',
        action: 'distance',
        from: { x: 0, y: 0 },
        to: { x: 3, y: 4 },
      })
      const body = await jsonBody(res)
      expect(body.result).toBeDefined()
    })
  })

  describe('World map subsystem', () => {
    it('gets world map', async () => {
      const res = await callRpg(ctx, { sub: 'world_map', action: 'get', id: 'map-1' })
      const body = await jsonBody(res)
      expect(body.result).toBeDefined()
    })
  })

  describe('Batch subsystem', () => {
    it('runs batch operation', async () => {
      const res = await callRpg(ctx, {
        sub: 'batch',
        action: 'run',
        operations: [
          { sub: 'math', action: 'roll', dice: '1d6' },
          { sub: 'math', action: 'roll', dice: '2d4' },
        ],
      })
      const body = await jsonBody(res)
      expect(body.result).toBeDefined()
    })
  })

  describe('Travel subsystem', () => {
    it('starts travel', async () => {
      const res = await callRpg(ctx, {
        sub: 'travel',
        action: 'start',
        partyId: 'party-1',
        from: LOCATION_KEY,
        to: 'location:castle',
      })
      const body = await jsonBody(res)
      expect(body.result).toBeDefined()
    })
  })

  describe('Perception subsystem', () => {
    it('checks perception', async () => {
      const res = await callRpg(ctx, { sub: 'perception', action: 'check', characterId: 'char-1', difficulty: 15 })
      const body = await jsonBody(res)
      expect(body.result).toBeDefined()
    })
  })

  describe('Scene subsystem (RPG)', () => {
    it('creates RPG scene', async () => {
      const res = await callRpg(ctx, {
        sub: 'scene',
        action: 'create',
        name: 'Tavern Brawl',
        location: LOCATION_KEY,
      })
      const body = await jsonBody(res)
      expect(body.result).toBeDefined()
    })
  })

  describe('Error handling', () => {
    it('returns error for unknown sub', async () => {
      const res = await callRpg(ctx, { sub: 'nonexistent', action: 'test' })
      const body = await jsonBody(res)
      expect(body.error).toBeDefined()
    })

    it('returns error for missing sub', async () => {
      const res = await callRpg(ctx, { action: 'test' })
      const body = await jsonBody(res)
      expect(body.error).toBeDefined()
    })
  })
})
