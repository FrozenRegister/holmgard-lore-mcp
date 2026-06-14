import { describe, callTool, seedKV } from './helpers'
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
      await seedKV('location:tavern', '**Description:** A warm, crowded tavern with the smell of mead and pipe smoke.\n**Exits:** forest, castle')
      await seedKV('location:forest', '**Description:** A dark forest path surrounded by ancient trees.\n**Exits:** tavern, cave')
      await seedKV('location:cave', '**Description:** A damp cave entrance with strange markings on the stone.\n**Exits:** forest')

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

      const brief = await callTool('scene_manage', { action: 'brief', location_key: 'location:tavern' })
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
      const tavern = await callTool('world_manage', { action: 'get_location_occupants', location_key: 'location:tavern' })
      expect(tavern.result.occupants.length).toBe(2)
      expect(tavern.result.occupants.map((o: { key: string }) => o.key)).toContain('character:alice')
      expect(tavern.result.occupants.map((o: { key: string }) => o.key)).toContain('character:bob')

      // Query forest occupants
      const forest = await callTool('world_manage', { action: 'get_location_occupants', location_key: 'location:forest' })
      expect(forest.result.occupants.length).toBe(1)
      expect(forest.result.occupants[0].key).toBe('character:charlie')
    })
  })

  describe('thread-based story progression', () => {
    it('decrements Timeline-Value when thread_tick is called', async () => {
      await seedKV('character:alice', '**Thread:** main-quest\n**Timeline-Value:** 10')
      await seedKV('character:bob', '**Thread:** main-quest\n**Timeline-Value:** 10')

      // Tick the main quest thread
      const tickRes = await callTool('world_manage', { action: 'thread_tick', thread_id: 'main-quest' })
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

      const tickRes = await callTool('world_manage', { action: 'thread_tick', thread_id: 'end-quest' })
      expect(tickRes.result.local_shifts[0].status_change).toBe(true)
      expect(tickRes.result.local_shifts[0].new_value).toBe(0)
    })

    it('compares two threads to find timeline offset', async () => {
      await seedKV('character:alice', '**Thread:** thread-a\n**Timeline-Value:** 10\n**Current-Date:** day-5')
      await seedKV('character:bob', '**Thread:** thread-a\n**Timeline-Value:** 8\n**Current-Date:** day-5')
      await seedKV('character:charlie', '**Thread:** thread-b\n**Timeline-Value:** 5\n**Current-Date:** day-5')

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
      await seedKV('scene:locked-door', '**Description:** A heavy oak door.\n- push: Push the door\n- unlock: Unlock with key [requires: key]\n- smash: Smash the door [min-weight: 0.8]')
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
      await seedKV('choice:enter-cave', '**Outcome-Seed:** You venture deeper...\n**State-Change:** Exploring\n**Next-Choices:** choice:inspect, choice:retreat')
      await seedKV('character:adventurer', '**Status:** Idle\n**Choice-History:**')

      const commitRes = await callTool('scene_manage', {
        action: 'commit_choice',
        choice_id: 'choice:enter-cave',
        entity_key: 'character:adventurer',
      })
      expect(commitRes.result.outcome_seed).toContain('deeper')
      expect(commitRes.result.state_change).toBe('Exploring')

      // Verify character state updated
      const character = await callTool('lore_manage', { action: 'get', query: 'character:adventurer' })
      expect(character.result.text).toContain('Exploring')
      expect(character.result.text).toContain('choice:enter-cave')
    })

    it('tracks choice history for a character', async () => {
      const now = new Date().toISOString()
      await seedKV('character:veteran', `**Choice-History:** choice:join-guild@${now}, choice:quest-1@${new Date(Date.now() - 3600000).toISOString()}`)

      const history = await callTool('scene_manage', { action: 'get_history', entity_key: 'character:veteran' })
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
        { key: 'character:batch-test', action: 'increment', field_path: 'Experience', increment: 50 },
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
      const character = await callTool('lore_manage', { action: 'get', query: 'character:batch-test' })
      expect(character.result.text).toContain('**Experience:** 550')
      expect(character.result.text).toContain('**Status:** Busy')
    })
  })

  describe('world state consistency', () => {
    it('recovers character state from history after changes', async () => {
      // Use set first to create history, then patch
      await callTool('lore_manage', { action: 'set', key: 'character:time-traveler', text: '**Health:** 100\n**Status:** Healthy' })

      // Make a change (which pushes history)
      await callTool('lore_manage', {
        action: 'patch',
        key: 'character:time-traveler',
        operation: 'replace',
        target: '**Health:** 100',
        value: '**Health:** 25',
      })

      // Verify changed state
      let character = await callTool('lore_manage', { action: 'get', query: 'character:time-traveler' })
      expect(character.result.text).toContain('**Health:** 25')

      // Restore previous version
      const restoreRes = await callTool('lore_manage', { action: 'restore', key: 'character:time-traveler' })
      expect(restoreRes.result.metadata.restored).toBe(true)

      // Verify restored state
      character = await callTool('lore_manage', { action: 'get', query: 'character:time-traveler' })
      expect(character.result.text).toContain('**Health:** 100')
    })

    it('searches lore by keyword to find related entries', async () => {
      await seedKV('character:alice-dragon', '**Role:** Adventurer\n**Quest:** Slay the dragon')
      await seedKV('character:bob-wizard', '**Role:** Wizard\n**Quest:** Study ancient magic')
      await seedKV('location:dragon-lair', '**Description:** Home of the mighty dragon')

      const searchRes = await callTool('lore_manage', { action: 'search', query: 'dragon', max_results: 10 })
      expect(searchRes.result.metadata.match_count).toBe(2)
      const keys = searchRes.result.results.map((r: { key: string }) => r.key)
      expect(keys).toContain('character:alice-dragon')
      expect(keys).toContain('location:dragon-lair')
    })

    it('validates topic existence before operations', async () => {
      await seedKV('character:real-hero', '**Status:** Active')

      const validateRes = await callTool('lore_manage', { action: 'validate', query_string: 'character:real-hero' })
      expect(validateRes.result.exists).toBe(true)
      expect(validateRes.result.exact_match).toBe('character:real-hero')

      const notFoundRes = await callTool('lore_manage', { action: 'validate', query_string: 'character:ghost-hero' })
      expect(notFoundRes.result.exists).toBe(false)
    })
  })

  describe('complex roleplay scenario: three-turn encounter', () => {
    it('simulates a full encounter with character actions and thread progression', async () => {
      // === SETUP: Two adventurers meet a merchant ===
      await seedKV('location:marketplace', '**Description:** A bustling marketplace.')
      await seedKV('character:alice', '**Location:** location:marketplace\n**Status:** Active\n**Health:** 100\n**Gold:** 50\n**Thread:** main-quest\n**Timeline-Value:** 5\n**Current-Date:** 2026-06-14')
      await seedKV('character:bob', '**Location:** location:marketplace\n**Status:** Active\n**Health:** 80\n**Gold:** 30\n**Thread:** main-quest\n**Timeline-Value:** 5\n**Current-Date:** 2026-06-14')
      await seedKV('character:merchant', '**Location:** location:marketplace\n**Role:** Merchant\n**Inventory:** Healing Potion×5, Sword, Map')

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
      const tickRes = await callTool('world_manage', { action: 'thread_tick', thread_id: 'main-quest' })
      expect(tickRes.result.metadata.entities_ticked).toBe(2)

      // === VERIFY FINAL STATE ===
      const finalAlice = await callTool('lore_manage', { action: 'get', query: 'character:alice' })
      expect(finalAlice.result.text).toContain('**Gold:** 40')
      expect(finalAlice.result.text).toContain('**Inventory:** Healing Potion×1')
      expect(finalAlice.result.text).toContain('**Timeline-Value:** 4')

      const finalMerchant = await callTool('lore_manage', { action: 'get', query: 'character:merchant' })
      expect(finalMerchant.result.text).toContain('Healing Potion×4')

      // === VERIFY SCENE STATE ===
      const scene = await callTool('scene_manage', { action: 'brief', location_key: 'location:marketplace' })
      expect(scene.result.entities.length).toBe(3)
    })
  })
})
