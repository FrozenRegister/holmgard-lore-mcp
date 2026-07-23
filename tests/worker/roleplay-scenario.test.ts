import { describe, callTool, seedKV } from './support/helpers'
import { expect, it } from 'vitest'

/**
 * Roleplay Scenario Test Suite
 *
 * Simulates a multi-character, multi-thread collaborative storytelling session.
 * Tests core mechanics: character actions, inventory management, location movement,
 * thread progression, and multi-actor scene interactions.
 */

describe('roleplay scenario: multi-character quest', () => {
  describe('world setup and initial state', () => {
    it('creates a world with locations, characters, and threads', async () => {
      // Seed locations
      await seedKV(
        'location:tavern',
        '**Description:** A warm, crowded tavern with the smell of mead and pipe smoke.\n**Exits:** forest, castle',
      )
      await seedKV(
        'location:forest',
        '**Description:** A dark forest path surrounded by ancient trees.\n**Exits:** tavern, cave',
      )
      await seedKV(
        'location:cave',
        '**Description:** A damp cave entrance with strange markings on the stone.\n**Exits:** forest',
      )

      // Seed characters with initial state
      await seedKV(
        'character:alice',
        '**Status:** Active\n**Location:** location:tavern\n**Health:** 100\n**Mana:** 50\n**Inventory:** sword, shield, rope\n**Thread:** main-quest\n**Timeline-Value:** 10\n**Current-Date:** 2026-06-14',
      )
      await seedKV(
        'character:bob',
        '**Status:** Active\n**Location:** location:tavern\n**Health:** 85\n**Mana:** 75\n**Inventory:** staff, spellbook, potion×3\n**Thread:** main-quest\n**Timeline-Value:** 10\n**Current-Date:** 2026-06-14',
      )
      await seedKV(
        'character:charlie',
        '**Status:** Active\n**Location:** location:forest\n**Health:** 95\n**Mana:** 30\n**Inventory:** bow, arrows×20, dagger\n**Thread:** side-quest\n**Timeline-Value:** 8\n**Current-Date:** 2026-06-14',
      )

      // Verify locations
      const tavern = await callTool('lore_manage', { action: 'get', query: 'location:tavern' })
      expect(tavern.result.text).toContain('crowded tavern')

      // Verify character state
      const alice = await callTool('lore_manage', { action: 'get', query: 'character:alice' })
      expect(alice.result.text).toContain('**Health:** 100')
      expect(alice.result.text).toContain('main-quest')
      expect(alice.result.text).toContain('location:tavern')
    })

    it('verifies scene_brief returns all actors in the tavern', async () => {
      await seedKV('location:tavern', 'A warm tavern.')
      await seedKV('character:alice', '**Status:** Active\n**Location:** location:tavern')
      await seedKV('character:bob', '**Status:** Active\n**Location:** location:tavern')
      await seedKV('character:charlie', '**Status:** Idle\n**Location:** location:forest')

      const brief = await callTool('scene_manage', {
        action: 'brief',
        location_key: 'location:tavern',
      })
      expect(brief.result.entities.length).toBe(2)
      expect(brief.result.entities.map((e: { key: string }) => e.key)).toContain('character:alice')
      expect(brief.result.entities.map((e: { key: string }) => e.key)).toContain('character:bob')
    })
  })

  describe('character actions and mutations', () => {
    it('updates character health after taking damage', async () => {
      await seedKV('character:alice', '**Status:** Active\n**Health:** 100\n**Damage-Taken:** None')

      // Simulate damage: patch the health field
      const patchRes = await callTool('lore_manage', {
        action: 'patch',
        key: 'character:alice',
        operation: 'replace',
        target: '**Health:** 100',
        value: '**Health:** 75',
      })
      expect(patchRes.result.content[0].text).toContain('Replaced 1 occurrence')

      // Verify updated health
      const alice = await callTool('lore_manage', { action: 'get', query: 'character:alice' })
      expect(alice.result.text).toContain('**Health:** 75')
    })

    it('manages inventory by adding and removing items', async () => {
      await seedKV('character:bob', '**Status:** Active\n**Inventory:** staff, spellbook, potion×3')

      // Consume a potion (update inventory)
      const consumeRes = await callTool('lore_manage', {
        action: 'patch',
        key: 'character:bob',
        operation: 'replace',
        target: '**Inventory:** staff, spellbook, potion×3',
        value: '**Inventory:** staff, spellbook, potion×2',
      })
      expect(consumeRes.result.content[0].text).toContain('Replaced 1 occurrence')

      // Verify potion count decreased
      const bob = await callTool('lore_manage', { action: 'get', query: 'character:bob' })
      expect(bob.result.text).toContain('potion×2')
      expect(bob.result.text).not.toContain('potion×3')
    })

    it('increments numeric fields like experience or damage counter', async () => {
      await seedKV('character:charlie', '**Status:** Active\n**Experience-Points:** 450')

      // Increment experience via batch_mutate
      const incRes = await callTool('lore_manage', {
        action: 'batch_mutate',
        mutations: [
          {
            key: 'character:charlie',
            action: 'increment',
            field_path: 'Experience-Points',
            increment: 100,
          },
        ],
      })
      expect(incRes.result.results[0].ok).toBe(true)
      expect(incRes.result.results[0].new_value).toBe(550)

      // Verify updated value
      const charlie = await callTool('lore_manage', { action: 'get', query: 'character:charlie' })
      expect(charlie.result.text).toContain('**Experience-Points:** 550')
    })
  })

  describe('character movement and location management', () => {
    it('moves a character from one location to another', async () => {
      await seedKV('character:alice', '**Location:** location:tavern\n**Status:** Active')

      // Move alice to forest
      const moveRes = await callTool('entity_manage', {
        action: 'move',
        entity_key: 'character:alice',
        new_location_key: 'location:forest',
      })
      expect(moveRes.error).toBeUndefined()
      expect(moveRes.result.metadata.new_location).toBe('location:forest')

      // Verify location changed
      const alice = await callTool('lore_manage', { action: 'get', query: 'character:alice' })
      expect(alice.result.text).toContain('location:forest')
      expect(alice.result.text).not.toContain('location:tavern')
    })

    it('returns all occupants at a location via get_location_occupants', async () => {
      await seedKV('character:alice', '**Location:** location:tavern\n**Status:** Active')
      await seedKV('character:bob', '**Location:** location:tavern\n**Status:** Active')
      await seedKV('character:charlie', '**Location:** location:forest\n**Status:** Active')

      // Query tavern occupants
      const tavern = await callTool('world_manage', {
        action: 'get_location_occupants',
        location_key: 'location:tavern',
      })
      expect(tavern.result.occupants.length).toBe(2)
      expect(tavern.result.occupants.map((o: { key: string }) => o.key)).toContain(
        'character:alice',
      )
      expect(tavern.result.occupants.map((o: { key: string }) => o.key)).toContain('character:bob')

      // Query forest occupants
      const forest = await callTool('world_manage', {
        action: 'get_location_occupants',
        location_key: 'location:forest',
      })
      expect(forest.result.occupants.length).toBe(1)
      expect(forest.result.occupants[0].key).toBe('character:charlie')
    })
  })

  describe('thread-based story progression', () => {
    it('decrements Timeline-Value when thread_tick is called', async () => {
      await seedKV('character:alice', '**Thread:** main-quest\n**Timeline-Value:** 10')
      await seedKV('character:bob', '**Thread:** main-quest\n**Timeline-Value:** 10')

      // Tick the main quest thread
      const tickRes = await callTool('world_manage', {
        action: 'thread_tick',
        thread_id: 'main-quest',
      })
      expect(tickRes.result.local_shifts.length).toBe(2)
      expect(tickRes.result.local_shifts[0].new_value).toBe(9)
      expect(tickRes.result.metadata.entities_ticked).toBe(2)

      // Verify both characters have decremented timeline
      const alice = await callTool('lore_manage', { action: 'get', query: 'character:alice' })
      expect(alice.result.text).toContain('**Timeline-Value:** 9')

      const bob = await callTool('lore_manage', { action: 'get', query: 'character:bob' })
      expect(bob.result.text).toContain('**Timeline-Value:** 9')
    })

    it('isolates ticks to a specific thread', async () => {
      await seedKV('character:alice', '**Thread:** main-quest\n**Timeline-Value:** 10')
      await seedKV('character:charlie', '**Thread:** side-quest\n**Timeline-Value:** 8')

      // Tick only main-quest
      await callTool('world_manage', { action: 'thread_tick', thread_id: 'main-quest' })

      // Verify alice changed but charlie did not
      const alice = await callTool('lore_manage', { action: 'get', query: 'character:alice' })
      expect(alice.result.text).toContain('**Timeline-Value:** 9')

      const charlie = await callTool('lore_manage', { action: 'get', query: 'character:charlie' })
      expect(charlie.result.text).toContain('**Timeline-Value:** 8')
    })

    it('marks status_change when timeline crosses zero', async () => {
      await seedKV('character:final-turn', '**Thread:** end-quest\n**Timeline-Value:** 1')

      const tickRes = await callTool('world_manage', {
        action: 'thread_tick',
        thread_id: 'end-quest',
      })
      expect(tickRes.result.local_shifts[0].status_change).toBe(true)
      expect(tickRes.result.local_shifts[0].new_value).toBe(0)
    })

    it('compares two threads to find timeline offset', async () => {
      await seedKV(
        'character:alice',
        '**Thread:** thread-a\n**Timeline-Value:** 10\n**Current-Date:** day-5',
      )
      await seedKV(
        'character:bob',
        '**Thread:** thread-a\n**Timeline-Value:** 8\n**Current-Date:** day-5',
      )
      await seedKV(
        'character:charlie',
        '**Thread:** thread-b\n**Timeline-Value:** 5\n**Current-Date:** day-5',
      )

      const cmp = await callTool('world_manage', {
        action: 'get_thread_comparison',
        thread_a: 'thread-a',
        thread_b: 'thread-b',
      })
      expect(cmp.result.thread_a.entity_count).toBe(2)
      expect(cmp.result.thread_b.entity_count).toBe(1)
      expect(cmp.result.timeline_offset).toBeCloseTo(4, 0)
    })
  })

  describe('multi-actor scene interactions', () => {
    it('presents choices to an actor based on inventory and state', async () => {
      await seedKV(
        'scene:locked-door',
        '**Description:** A heavy oak door.\n- push: Push the door\n- unlock: Unlock with key [requires: key]\n- smash: Smash the door [min-weight: 0.8]',
      )
      await seedKV('character:rogue', '**Inventory:** lockpick×1, key×1\n**Weight-1:** 0.5')

      const choices = await callTool('scene_manage', {
        action: 'present_choices',
        scene_key: 'scene:locked-door',
        entity_key: 'character:rogue',
      })
      const validIds = choices.result.valid_choices.map((c: { id: string }) => c.id)
      expect(validIds).toContain('push')
      expect(validIds).toContain('unlock')

      const blockedIds = choices.result.blocked_choices.map((c: { id: string }) => c.id)
      expect(blockedIds).toContain('smash')
    })

    it('commits a choice and updates character state', async () => {
      await seedKV(
        'choice:enter-cave',
        '**Outcome-Seed:** You venture deeper...\n**State-Change:** Exploring\n**Next-Choices:** choice:inspect, choice:retreat',
      )
      await seedKV('character:adventurer', '**Status:** Idle\n**Choice-History:**')

      const commitRes = await callTool('scene_manage', {
        action: 'commit_choice',
        choice_id: 'choice:enter-cave',
        entity_key: 'character:adventurer',
      })
      expect(commitRes.result.outcome_seed).toContain('deeper')
      expect(commitRes.result.state_change).toBe('Exploring')

      // Verify character state updated
      const character = await callTool('lore_manage', {
        action: 'get',
        query: 'character:adventurer',
      })
      expect(character.result.text).toContain('Exploring')
      expect(character.result.text).toContain('choice:enter-cave')
    })

    it('tracks choice history for a character', async () => {
      const now = new Date().toISOString()
      await seedKV(
        'character:veteran',
        `**Choice-History:** choice:join-guild@${now}, choice:quest-1@${new Date(Date.now() - 3600000).toISOString()}`,
      )

      const history = await callTool('scene_manage', {
        action: 'get_history',
        entity_key: 'character:veteran',
      })
      expect(history.result.history.length).toBe(2)
      expect(history.result.history[0].choice_id).toBe('choice:join-guild')
      expect(history.result.history[1].choice_id).toBe('choice:quest-1')
    })
  })

  describe('batch operations for efficiency', () => {
    it('sets multiple lore entries in parallel', async () => {
      const entries = [
        { key: 'character:npc-1', text: '**Status:** Alive\n**Role:** Innkeeper' },
        { key: 'character:npc-2', text: '**Status:** Alive\n**Role:** Guard' },
        { key: 'character:npc-3', text: '**Status:** Dead\n**Role:** Thief' },
      ]

      const res = await callTool('lore_manage', {
        action: 'batch_set',
        entries,
      })
      expect(res.result.metadata.total).toBe(3)
      expect(res.result.metadata.set_count).toBe(3)
      expect(res.result.results['character:npc-1'].ok).toBe(true)
      expect(res.result.results['character:npc-2'].ok).toBe(true)
      expect(res.result.results['character:npc-3'].ok).toBe(true)

      // Verify all entries were written
      for (const entry of entries) {
        const lore = await callTool('lore_manage', { action: 'get', query: entry.key })
        expect(lore.result.text).toContain(entry.text)
      }
    })

    it('applies batch mutations (increment, patch) in sequence', async () => {
      await seedKV('character:batch-test', '**Health:** 100\n**Experience:** 500\n**Status:** Idle')

      const mutations = [
        {
          key: 'character:batch-test',
          action: 'increment',
          field_path: 'Experience',
          increment: 50,
        },
        {
          key: 'character:batch-test',
          action: 'patch',
          operation: 'replace',
          target: '**Status:** Idle',
          value: '**Status:** Busy',
        },
      ]

      const res = await callTool('lore_manage', {
        action: 'batch_mutate',
        mutations,
      })
      expect(res.result.metadata.ok_count).toBe(2)
      expect(res.result.results[0].ok).toBe(true)
      expect(res.result.results[1].ok).toBe(true)

      // Verify final state
      const character = await callTool('lore_manage', {
        action: 'get',
        query: 'character:batch-test',
      })
      expect(character.result.text).toContain('**Experience:** 550')
      expect(character.result.text).toContain('**Status:** Busy')
    })
  })

  describe('world state consistency', () => {
    it('recovers character state from history after changes', async () => {
      // Use set first to create history, then patch
      await callTool('lore_manage', {
        action: 'set',
        key: 'character:time-traveler',
        text: '**Health:** 100\n**Status:** Healthy',
      })

      // Make a change (which pushes history)
      await callTool('lore_manage', {
        action: 'patch',
        key: 'character:time-traveler',
        operation: 'replace',
        target: '**Health:** 100',
        value: '**Health:** 25',
      })

      // Verify changed state
      let character = await callTool('lore_manage', {
        action: 'get',
        query: 'character:time-traveler',
      })
      expect(character.result.text).toContain('**Health:** 25')

      // Restore previous version
      const restoreRes = await callTool('lore_manage', {
        action: 'restore',
        key: 'character:time-traveler',
      })
      expect(restoreRes.result.metadata.restored).toBe(true)

      // Verify restored state
      character = await callTool('lore_manage', { action: 'get', query: 'character:time-traveler' })
      expect(character.result.text).toContain('**Health:** 100')
    })

    it('searches lore by keyword to find related entries', async () => {
      await seedKV('character:alice-dragon', '**Role:** Adventurer\n**Quest:** Slay the dragon')
      await seedKV('character:bob-wizard', '**Role:** Wizard\n**Quest:** Study ancient magic')
      await seedKV('location:dragon-lair', '**Description:** Home of the mighty dragon')

      const searchRes = await callTool('lore_manage', {
        action: 'search',
        query: 'dragon',
        max_results: 10,
      })
      expect(searchRes.result.metadata.match_count).toBe(2)
      const keys = searchRes.result.results.map((r: { key: string }) => r.key)
      expect(keys).toContain('character:alice-dragon')
      expect(keys).toContain('location:dragon-lair')
    })

    it('validates topic existence before operations', async () => {
      await seedKV('character:real-hero', '**Status:** Active')

      const validateRes = await callTool('lore_manage', {
        action: 'validate',
        query_string: 'character:real-hero',
      })
      expect(validateRes.result.exists).toBe(true)
      expect(validateRes.result.exact_match).toBe('character:real-hero')

      const notFoundRes = await callTool('lore_manage', {
        action: 'validate',
        query_string: 'character:ghost-hero',
      })
      expect(notFoundRes.result.exists).toBe(false)
    })
  })

  describe('complex roleplay scenario: three-turn encounter', () => {
    it('simulates a full encounter with character actions and thread progression', async () => {
      // === SETUP: Two adventurers meet a merchant ===
      await seedKV('location:marketplace', '**Description:** A bustling marketplace.')
      await seedKV(
        'character:alice',
        '**Location:** location:marketplace\n**Status:** Active\n**Health:** 100\n**Gold:** 50\n**Thread:** main-quest\n**Timeline-Value:** 5\n**Current-Date:** 2026-06-14',
      )
      await seedKV(
        'character:bob',
        '**Location:** location:marketplace\n**Status:** Active\n**Health:** 80\n**Gold:** 30\n**Thread:** main-quest\n**Timeline-Value:** 5\n**Current-Date:** 2026-06-14',
      )
      await seedKV(
        'character:merchant',
        '**Location:** location:marketplace\n**Role:** Merchant\n**Inventory:** Healing Potion×5, Sword, Map',
      )

      // === TURN 1: Alice buys a potion ===
      // Update Alice's gold via batch_mutate
      await callTool('lore_manage', {
        action: 'batch_mutate',
        mutations: [
          {
            key: 'character:alice',
            action: 'patch',
            operation: 'replace',
            target: '**Gold:** 50',
            value: '**Gold:** 40',
          },
          {
            key: 'character:alice',
            action: 'patch',
            operation: 'append',
            target: '**Status:** Active',
            value: '\n**Inventory:** Healing Potion×1',
          },
        ],
      })

      // === TURN 2: Bob hagles with merchant ===
      // Merchant's inventory decreases
      await callTool('lore_manage', {
        action: 'patch',
        key: 'character:merchant',
        operation: 'replace',
        target: '**Inventory:** Healing Potion×5, Sword, Map',
        value: '**Inventory:** Healing Potion×4, Sword, Map',
      })

      // === TURN 3: Time progresses (thread tick) ===
      const tickRes = await callTool('world_manage', {
        action: 'thread_tick',
        thread_id: 'main-quest',
      })
      expect(tickRes.result.metadata.entities_ticked).toBe(2)

      // === VERIFY FINAL STATE ===
      const finalAlice = await callTool('lore_manage', { action: 'get', query: 'character:alice' })
      expect(finalAlice.result.text).toContain('**Gold:** 40')
      expect(finalAlice.result.text).toContain('**Inventory:** Healing Potion×1')
      expect(finalAlice.result.text).toContain('**Timeline-Value:** 4')

      const finalMerchant = await callTool('lore_manage', {
        action: 'get',
        query: 'character:merchant',
      })
      expect(finalMerchant.result.text).toContain('Healing Potion×4')

      // === VERIFY SCENE STATE ===
      const scene = await callTool('scene_manage', {
        action: 'brief',
        location_key: 'location:marketplace',
      })
      expect(scene.result.entities.length).toBe(3)
    })
  })

  describe('advanced scenarios: multi-location expedition', () => {
    it('tracks party movement across multiple locations with occupancy updates', async () => {
      // Create a chain of locations
      await seedKV('location:inn', '**Description:** A cozy inn.')
      await seedKV('location:forest-road', '**Description:** A forest path.')
      await seedKV('location:tavern-end', "**Description:** A tavern at journey's end.")

      // Create party members
      await seedKV(
        'character:leader',
        '**Location:** location:inn\n**Status:** Active\n**Role:** Party Leader\n**Health:** 100',
      )
      await seedKV(
        'character:healer',
        '**Location:** location:inn\n**Status:** Active\n**Role:** Healer\n**Health:** 85',
      )
      await seedKV(
        'character:scout',
        '**Location:** location:inn\n**Status:** Active\n**Role:** Scout\n**Health:** 90',
      )

      // Verify starting location
      let innOccupants = await callTool('world_manage', {
        action: 'get_location_occupants',
        location_key: 'location:inn',
      })
      expect(innOccupants.result.occupants).toHaveLength(3)

      // Move to forest
      await callTool('entity_manage', {
        action: 'move',
        entity_key: 'character:leader',
        new_location_key: 'location:forest-road',
      })
      await callTool('entity_manage', {
        action: 'move',
        entity_key: 'character:healer',
        new_location_key: 'location:forest-road',
      })
      await callTool('entity_manage', {
        action: 'move',
        entity_key: 'character:scout',
        new_location_key: 'location:forest-road',
      })

      // Verify movement
      const forestOccupants = await callTool('world_manage', {
        action: 'get_location_occupants',
        location_key: 'location:forest-road',
      })
      expect(forestOccupants.result.occupants).toHaveLength(3)

      innOccupants = await callTool('world_manage', {
        action: 'get_location_occupants',
        location_key: 'location:inn',
      })
      expect(innOccupants.result.occupants).toHaveLength(0)

      // Move to final location
      await callTool('entity_manage', {
        action: 'move',
        entity_key: 'character:leader',
        new_location_key: 'location:tavern-end',
      })
      await callTool('entity_manage', {
        action: 'move',
        entity_key: 'character:healer',
        new_location_key: 'location:tavern-end',
      })
      await callTool('entity_manage', {
        action: 'move',
        entity_key: 'character:scout',
        new_location_key: 'location:tavern-end',
      })

      // Verify final state
      const tavernOccupants = await callTool('world_manage', {
        action: 'get_location_occupants',
        location_key: 'location:tavern-end',
      })
      expect(tavernOccupants.result.occupants).toHaveLength(3)
      expect(tavernOccupants.result.occupants.map((o: { key: string }) => o.key)).toContain(
        'character:leader',
      )
      expect(tavernOccupants.result.occupants.map((o: { key: string }) => o.key)).toContain(
        'character:healer',
      )
      expect(tavernOccupants.result.occupants.map((o: { key: string }) => o.key)).toContain(
        'character:scout',
      )
    })

    it('handles party member damage and healing across locations', async () => {
      await seedKV('location:battle', '**Description:** A battleground.')
      await seedKV(
        'character:warrior',
        '**Location:** location:battle\n**Status:** Active\n**Health:** 100',
      )
      await seedKV(
        'character:cleric',
        '**Location:** location:battle\n**Status:** Active\n**Health:** 100',
      )

      // Warrior takes damage
      await callTool('lore_manage', {
        action: 'batch_mutate',
        mutations: [
          {
            key: 'character:warrior',
            action: 'increment',
            field_path: 'Health',
            increment: -30,
          },
        ],
      })

      let warrior = await callTool('lore_manage', { action: 'get', query: 'character:warrior' })
      expect(warrior.result.text).toContain('**Health:** 70')

      // Cleric heals warrior
      await callTool('lore_manage', {
        action: 'batch_mutate',
        mutations: [
          {
            key: 'character:warrior',
            action: 'increment',
            field_path: 'Health',
            increment: 20,
          },
        ],
      })

      warrior = await callTool('lore_manage', { action: 'get', query: 'character:warrior' })
      expect(warrior.result.text).toContain('**Health:** 90')
    })
  })

  describe('setup and interaction management', () => {
    it('plants setups that track tension and actors', async () => {
      await seedKV('character:noble', '**Status:** Active\n**Location:** location:castle')
      await seedKV('character:spy', '**Status:** Active\n**Location:** location:castle')
      await seedKV('location:castle', '**Description:** The grand castle.')

      // Plant a setup involving the two characters (tension max 5)
      const setupRes = await callTool('continuity_manage', {
        action: 'plant_setup',
        id: 'noble-betrayal-plot',
        description:
          'The noble plans to betray the crown, and the spy must decide whether to report it.',
        tension: 5,
        actors: ['character:noble', 'character:spy'],
      })
      expect(setupRes.error).toBeUndefined()

      // Scene brief should show open setups for present actors
      const briefRes = await callTool('scene_manage', {
        action: 'brief',
        location_key: 'location:castle',
      })
      const setupIds = (briefRes.result.open_setups as Array<{ id: string }>).map((s) => s.id)
      expect(setupIds).toContain('noble-betrayal-plot')
    })

    it('deletes ephemeral NPCs after encounters', async () => {
      await seedKV(
        'character:goblin-npc',
        '**Status:** Active\n**Location:** location:dungeon\n**Role:** Enemy',
      )
      await seedKV('location:dungeon', '**Description:** A dark dungeon.')

      // Verify NPC exists
      const npc = await callTool('lore_manage', { action: 'get', query: 'character:goblin-npc' })
      expect(npc.result.text).toContain('Enemy')

      // After encounter, destroy the NPC
      const destroyRes = await callTool('entity_manage', {
        action: 'destroy',
        entity_key: 'character:goblin-npc',
      })
      expect(destroyRes.error).toBeUndefined()

      // Verify NPC is gone
      const getRes = await callTool('lore_manage', { action: 'get', query: 'character:goblin-npc' })
      expect(getRes.error).toBeDefined()
    })
  })

  describe('complex multi-thread scenarios', () => {
    it('maintains independent thread timelines with different dates', async () => {
      // Main quest thread
      await seedKV(
        'character:quest-alpha',
        '**Thread:** main-timeline\n**Timeline-Value:** 10\n**Current-Date:** 2026-06-14',
      )
      await seedKV(
        'character:quest-beta',
        '**Thread:** main-timeline\n**Timeline-Value:** 8\n**Current-Date:** 2026-06-14',
      )

      // Side quest thread (different date)
      await seedKV(
        'character:side-alpha',
        '**Thread:** side-timeline\n**Timeline-Value:** 5\n**Current-Date:** 2026-06-20',
      )
      await seedKV(
        'character:side-beta',
        '**Thread:** side-timeline\n**Timeline-Value:** 3\n**Current-Date:** 2026-06-20',
      )

      // Tick main timeline
      await callTool('world_manage', { action: 'thread_tick', thread_id: 'main-timeline' })

      // Verify main timeline changed
      const mainAlpha = await callTool('lore_manage', {
        action: 'get',
        query: 'character:quest-alpha',
      })
      expect(mainAlpha.result.text).toContain('**Timeline-Value:** 9')

      // Verify side timeline unchanged
      const sideAlpha = await callTool('lore_manage', {
        action: 'get',
        query: 'character:side-alpha',
      })
      expect(sideAlpha.result.text).toContain('**Timeline-Value:** 5')

      // Compare the two threads
      const cmp = await callTool('world_manage', {
        action: 'get_thread_comparison',
        thread_a: 'main-timeline',
        thread_b: 'side-timeline',
      })
      expect(cmp.result.thread_a.entity_count).toBe(2)
      expect(cmp.result.thread_b.entity_count).toBe(2)
      expect(cmp.result.shared_dates).toHaveLength(0) // Different dates
    })

    it('handles convergence between threads with shared dates', async () => {
      // Set up two threads that will converge
      await seedKV(
        'character:thread-a-char',
        '**Thread:** converge-a\n**Timeline-Value:** 5\n**Current-Date:** 2026-06-15',
      )
      await seedKV(
        'character:thread-b-char',
        '**Thread:** converge-b\n**Timeline-Value:** 3\n**Current-Date:** 2026-06-15',
      )

      // Both threads share the same current date - they're converging
      const briefA = await callTool('world_manage', {
        action: 'get_thread_comparison',
        thread_a: 'converge-a',
        thread_b: 'converge-b',
      })
      expect(briefA.result.shared_dates).toContain('2026-06-15')
    })

    it('ticks multiple threads independently in a session', async () => {
      // Create three parallel stories
      const threadIds = ['story-1', 'story-2', 'story-3']
      for (let i = 0; i < threadIds.length; i++) {
        await seedKV(
          `character:story${i + 1}-lead`,
          `**Thread:** ${threadIds[i]}\n**Timeline-Value:** 10`,
        )
      }

      // Tick each thread
      for (const threadId of threadIds) {
        await callTool('world_manage', { action: 'thread_tick', thread_id: threadId })
      }

      // Verify each thread progressed
      for (let i = 0; i < threadIds.length; i++) {
        const char = await callTool('lore_manage', {
          action: 'get',
          query: `character:story${i + 1}-lead`,
        })
        expect(char.result.text).toContain('**Timeline-Value:** 9')
      }
    })
  })

  describe('advanced lore management', () => {
    it('patches complex nested structures and validates changes', async () => {
      await seedKV(
        'location:grand-library',
        '**Description:** A vast library.\n**Sections:** Archives\n**Keepers:** librarian:chief\n**Rules:** Silence required',
      )

      // Patch to add a new section
      await callTool('lore_manage', {
        action: 'patch',
        key: 'location:grand-library',
        operation: 'append',
        target: '**Rules:** Silence required',
        value: '\n**Access-Level:** Restricted',
      })

      const updated = await callTool('lore_manage', {
        action: 'get',
        query: 'location:grand-library',
      })
      expect(updated.result.text).toContain('**Access-Level:** Restricted')
    })

    it('uses batch operations for efficient multi-entity updates', async () => {
      const npcs = [
        {
          key: 'npc:innkeeper',
          text: '**Role:** Innkeeper\n**Loyalty:** Neutral\n**Fear-Level:** 0',
        },
        {
          key: 'npc:blacksmith',
          text: '**Role:** Blacksmith\n**Loyalty:** Neutral\n**Fear-Level:** 0',
        },
        { key: 'npc:guard', text: '**Role:** Guard\n**Loyalty:** Crown\n**Fear-Level:** 5' },
        { key: 'npc:merchant', text: '**Role:** Merchant\n**Loyalty:** Gold\n**Fear-Level:** 2' },
      ]

      // Batch create all NPCs
      const batchRes = await callTool('lore_manage', {
        action: 'batch_set',
        entries: npcs,
      })
      expect(batchRes.result.metadata.total).toBe(4)

      // Batch mutate to update fear levels after a threat
      const mutations = [
        { key: 'npc:innkeeper', action: 'increment', field_path: 'Fear-Level', increment: 3 },
        { key: 'npc:blacksmith', action: 'increment', field_path: 'Fear-Level', increment: 2 },
        { key: 'npc:guard', action: 'increment', field_path: 'Fear-Level', increment: 1 },
        { key: 'npc:merchant', action: 'increment', field_path: 'Fear-Level', increment: 4 },
      ]

      const mutateRes = await callTool('lore_manage', {
        action: 'batch_mutate',
        mutations,
      })
      expect(mutateRes.result.metadata.ok_count).toBe(4)

      // Verify all updates
      const innkeeper = await callTool('lore_manage', { action: 'get', query: 'npc:innkeeper' })
      expect(innkeeper.result.text).toContain('**Fear-Level:** 3')
    })

    it('performs comprehensive search across lore database', async () => {
      // Create a diverse lore collection
      await seedKV(
        'character:dragon-slayer',
        '**Quest:** Slay the ancient dragon\n**Weapon:** Dragon-bane sword',
      )
      await seedKV(
        'location:dragon-cave',
        '**Description:** Lair of the ancient dragon\n**Treasure:** Dragon gold',
      )
      await seedKV(
        'item:dragon-egg',
        '**Type:** Artifact\n**Origin:** From the dragon hoard\n**Power:** Unknown',
      )
      await seedKV('faction:dragon-cult', '**Goal:** Resurrect the ancient dragon\n**Members:** 5')
      await seedKV(
        'npc:dragon-priest',
        '**Role:** High priest\n**Faction:** dragon-cult\n**Status:** Active',
      )

      // Search for "dragon" - should find all 5 entries
      const searchRes = await callTool('lore_manage', {
        action: 'search',
        query: 'dragon',
        max_results: 20,
      })
      expect(searchRes.result.metadata.match_count).toBe(5)

      const keys = searchRes.result.results.map((r: { key: string }) => r.key)
      expect(keys).toContain('character:dragon-slayer')
      expect(keys).toContain('location:dragon-cave')
      expect(keys).toContain('item:dragon-egg')
      expect(keys).toContain('faction:dragon-cult')
      expect(keys).toContain('npc:dragon-priest')
    })

    it('lists all lore entries and respects pagination', async () => {
      // Create multiple entries
      const entries = Array.from({ length: 5 }, (_, i) => ({
        key: `item:artifact-${i}`,
        text: `Artifact number ${i} with special powers`,
      }))

      await callTool('lore_manage', {
        action: 'batch_set',
        entries,
      })

      // List with limit
      const page1 = await callTool('lore_manage', { action: 'list', limit: 3, offset: 0 })
      expect(page1.result.metadata.limit).toBe(3)
      expect(page1.result.metadata.count).toBeLessThanOrEqual(3)

      // List next page
      const page2 = await callTool('lore_manage', { action: 'list', limit: 3, offset: 3 })
      expect(page2.result.metadata.offset).toBe(3)
    })
  })

  describe('narrative branching and choice chains', () => {
    it('follows a complex choice chain with state mutations', async () => {
      // Set up initial scene
      await seedKV('scene:crossroads', '**Description:** A fork in the road.')
      await seedKV(
        'choice:left-path',
        '**Description:** Take the left path into the woods\n**Next-Choices:** choice:encounter-wolf, choice:find-treasure',
      )
      await seedKV(
        'choice:encounter-wolf',
        '**Description:** You encounter a wolf!\n**State-Change:** Injured\n**Next-Choices:** choice:fight-wolf, choice:flee-wolf',
      )
      await seedKV(
        'choice:find-treasure',
        '**Description:** You find gold coins!\n**State-Change:** Wealthy',
      )
      await seedKV('character:traveler', '**Status:** Healthy\n**Choice-History:**')

      // Make first choice
      const choice1 = await callTool('scene_manage', {
        action: 'commit_choice',
        choice_id: 'choice:left-path',
        entity_key: 'character:traveler',
      })
      expect(choice1.error).toBeUndefined()

      let traveler = await callTool('lore_manage', { action: 'get', query: 'character:traveler' })
      expect(traveler.result.text).toContain('choice:left-path')

      // Make second choice - encounter
      const choice2 = await callTool('scene_manage', {
        action: 'commit_choice',
        choice_id: 'choice:encounter-wolf',
        entity_key: 'character:traveler',
      })
      expect(choice2.result.state_change).toBe('Injured')

      traveler = await callTool('lore_manage', { action: 'get', query: 'character:traveler' })
      expect(traveler.result.text).toContain('Injured')
      expect(traveler.result.text).toContain('choice:encounter-wolf')

      // Get history
      const history = await callTool('scene_manage', {
        action: 'get_history',
        entity_key: 'character:traveler',
      })
      expect(history.result.history.length).toBe(2)
      // Verify first choice in history
      expect(history.result.history[0]).toBeDefined()
      expect(history.result.history[1]).toBeDefined()
    })

    it('branches based on character inventory and attributes', async () => {
      await seedKV('scene:treasure-room', '**Description:** A room filled with treasure.')
      await seedKV(
        'character:thief',
        '**Inventory:** lockpicks×1, rope×1\n**Skill:** Stealth\n**Experience:** 50',
      )
      await seedKV(
        'character:warrior',
        '**Inventory:** sword×1, shield×1\n**Skill:** Combat\n**Experience:** 75',
      )

      // Thief-specific path
      const thiefChoices = await callTool('scene_manage', {
        action: 'present_choices',
        scene_key: 'scene:treasure-room',
        entity_key: 'character:thief',
      })
      expect(thiefChoices.error).toBeUndefined()

      // Warrior-specific path
      const warriorChoices = await callTool('scene_manage', {
        action: 'present_choices',
        scene_key: 'scene:treasure-room',
        entity_key: 'character:warrior',
      })
      expect(warriorChoices.error).toBeUndefined()
    })
  })

  describe('ephemeral cleanup and session management', () => {
    it('removes temporary encounter NPCs after resolution', async () => {
      // Create temporary encounter NPCs
      const tempNpcs = [
        { key: 'encounter:goblin-1', text: '**Type:** Goblin\n**Health:** 20\n**Loot:** coins×5' },
        { key: 'encounter:goblin-2', text: '**Type:** Goblin\n**Health:** 18\n**Loot:** coins×3' },
        {
          key: 'encounter:goblin-boss',
          text: '**Type:** Goblin Boss\n**Health:** 50\n**Loot:** sword, coins×20',
        },
      ]

      // Batch create them
      await callTool('lore_manage', {
        action: 'batch_set',
        entries: tempNpcs,
      })

      // Verify they exist
      const boss = await callTool('lore_manage', { action: 'get', query: 'encounter:goblin-boss' })
      expect(boss.result.text).toContain('Goblin Boss')

      // Destroy them after encounter
      for (const npc of tempNpcs) {
        await callTool('entity_manage', { action: 'destroy', entity_key: npc.key })
      }

      // Verify cleanup
      const verify = await callTool('lore_manage', {
        action: 'get',
        query: 'encounter:goblin-boss',
      })
      expect(verify.error).toBeDefined()
    })

    it('manages session-wide lore cleanup and archival', async () => {
      // Create archivable entries using set (which ensures they're written properly)
      await callTool('lore_manage', {
        action: 'set',
        key: 'session:session-001-intro',
        text: '**Type:** Session Record\n**Status:** Complete',
      })
      await callTool('lore_manage', {
        action: 'set',
        key: 'session:session-001-battles',
        text: '**Type:** Battle Log\n**Encounters:** 3',
      })

      // Verify both entries exist
      const intro = await callTool('lore_manage', {
        action: 'get',
        query: 'session:session-001-intro',
      })
      expect(intro.result.text).toContain('Session Record')

      const battles = await callTool('lore_manage', {
        action: 'get',
        query: 'session:session-001-battles',
      })
      expect(battles.result.text).toContain('Battle Log')

      // Archive old session by deleting
      await callTool('lore_manage', { action: 'delete', key: 'session:session-001-intro' })

      // Verify deletion
      const verify = await callTool('lore_manage', {
        action: 'get',
        query: 'session:session-001-intro',
      })
      expect(verify.error).toBeDefined()

      // Other session data still exists
      const remaining = await callTool('lore_manage', {
        action: 'get',
        query: 'session:session-001-battles',
      })
      expect(remaining.result.text).toContain('Battle Log')
    })
  })
})
