import { it, expect, beforeEach, describe } from 'vitest'
import { describe as vDesc, env } from '../support/helpers'
import { setupRpgDb } from '../support/setup-d1'
import { syncCharacterToKv, syncAllCharactersToKv } from '@/rpg/utils/character-sync'
import type { AppBindings } from '@/types'

vDesc('Character Sync Utilities', () => {
  beforeEach(async () => {
    await setupRpgDb(env.RPG_DB)
  })

  describe('syncCharacterToKv', () => {
    it('syncs a D1 character to KV with markdown projection', async () => {
      const testEnv = env as unknown as AppBindings

      // Create a character in D1
      await testEnv
        .RPG_DB!.prepare(
          `
        INSERT INTO characters (
          id, name, stats, hp, max_hp, ac, level, character_type, character_class, race,
          conditions, resistances, vulnerabilities, immunities, known_spells, prepared_spells,
          cantrips_known, currency, resource_pools, xp, weight_1, weight_2, perception_float,
          state_stage, state_stage_timer, perception_bonus, stealth_bonus, created_at, updated_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        )
      `,
        )
        .bind(
          'test-char-1',
          'Theron Blackforge',
          '{"str":16,"dex":12,"con":14,"int":10,"wis":13,"cha":11}',
          30,
          35,
          14,
          5,
          'pc',
          'Paladin',
          'Human',
          '[]',
          '[]',
          '[]',
          '[]',
          '[]',
          '[]',
          '[]',
          '{"gold":100}',
          '[]',
          0,
          1.5,
          2.0,
          0.5,
          0,
          0,
          0,
          0,
          new Date().toISOString(),
          new Date().toISOString(),
        )
        .run()

      // Sync to KV
      const kvKey = await syncCharacterToKv(testEnv, 'test-char-1')

      expect(kvKey).toBe('character:theron-blackforge')
      expect(kvKey).toBeDefined()

      // Verify KV entry was created
      if (!kvKey) throw new Error('kvKey should not be null')
      const kvEntry = await testEnv.LORE_DB!.get(kvKey)
      expect(kvEntry).toBeDefined()

      const kvData = JSON.parse(kvEntry as string) as {
        text: string
        meta: Record<string, unknown>
      }
      expect(kvData.meta.d1_migrated).toBe(true)
      expect(kvData.meta.d1_id).toBe('test-char-1')
      expect(kvData.text).toContain('Theron Blackforge')
    })

    it('uses custom slug when provided', async () => {
      const testEnv = env as unknown as AppBindings

      await testEnv
        .RPG_DB!.prepare(
          `
        INSERT INTO characters (
          id, name, stats, hp, max_hp, ac, level, character_type, character_class, race,
          conditions, resistances, vulnerabilities, immunities, known_spells, prepared_spells,
          cantrips_known, currency, resource_pools, xp, weight_1, weight_2, perception_float,
          state_stage, state_stage_timer, perception_bonus, stealth_bonus, created_at, updated_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        )
      `,
        )
        .bind(
          'test-char-2',
          'Elowen Vex',
          '{"str":10,"dex":16,"con":12,"int":14,"wis":13,"cha":15}',
          20,
          20,
          14,
          3,
          'npc',
          'Rogue',
          'Elf',
          '[]',
          '[]',
          '[]',
          '[]',
          '[]',
          '[]',
          '[]',
          '{"gold":50}',
          '[]',
          0,
          1.0,
          1.5,
          0.7,
          0,
          0,
          0,
          0,
          new Date().toISOString(),
          new Date().toISOString(),
        )
        .run()

      const kvKey = await syncCharacterToKv(testEnv, 'test-char-2', 'rogue-elf')

      expect(kvKey).toBe('character:rogue-elf')
    })

    it('prefixes slug with character: if not already prefixed', async () => {
      const testEnv = env as unknown as AppBindings

      await testEnv
        .RPG_DB!.prepare(
          `
        INSERT INTO characters (
          id, name, stats, hp, max_hp, ac, level, character_type, character_class, race,
          conditions, resistances, vulnerabilities, immunities, known_spells, prepared_spells,
          cantrips_known, currency, resource_pools, xp, weight_1, weight_2, perception_float,
          state_stage, state_stage_timer, perception_bonus, stealth_bonus, created_at, updated_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        )
      `,
        )
        .bind(
          'test-char-3',
          'Gandalf',
          '{"str":10,"dex":12,"con":14,"int":18,"wis":17,"cha":16}',
          45,
          50,
          12,
          20,
          'npc',
          'Wizard',
          'Human',
          '[]',
          '[]',
          '[]',
          '[]',
          '["Fireball","Counterspell"]',
          '[]',
          '[]',
          '{"gold":500}',
          '[]',
          0,
          2.0,
          2.0,
          1.0,
          0,
          0,
          0,
          0,
          new Date().toISOString(),
          new Date().toISOString(),
        )
        .run()

      const kvKey = await syncCharacterToKv(testEnv, 'test-char-3', 'gandalf')

      expect(kvKey).toBe('character:gandalf')
    })

    it('handles slug already prefixed with character:', async () => {
      const testEnv = env as unknown as AppBindings

      await testEnv
        .RPG_DB!.prepare(
          `
        INSERT INTO characters (
          id, name, stats, hp, max_hp, ac, level, character_type, character_class, race,
          conditions, resistances, vulnerabilities, immunities, known_spells, prepared_spells,
          cantrips_known, currency, resource_pools, xp, weight_1, weight_2, perception_float,
          state_stage, state_stage_timer, perception_bonus, stealth_bonus, created_at, updated_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        )
      `,
        )
        .bind(
          'test-char-4',
          'Merlin',
          '{"str":12,"dex":13,"con":14,"int":17,"wis":16,"cha":15}',
          40,
          45,
          13,
          18,
          'npc',
          'Wizard',
          'Human',
          '[]',
          '[]',
          '[]',
          '[]',
          '[]',
          '[]',
          '[]',
          '{"gold":300}',
          '[]',
          0,
          1.8,
          1.9,
          0.9,
          0,
          0,
          0,
          0,
          new Date().toISOString(),
          new Date().toISOString(),
        )
        .run()

      const kvKey = await syncCharacterToKv(testEnv, 'test-char-4', 'character:merlin')

      expect(kvKey).toBe('character:merlin')
    })

    it('returns null when LORE_DB is not available', async () => {
      const testEnv = env as unknown as AppBindings

      // Create a character
      await testEnv
        .RPG_DB!.prepare(
          `
        INSERT INTO characters (
          id, name, stats, hp, max_hp, ac, level, character_type, character_class, race,
          conditions, resistances, vulnerabilities, immunities, known_spells, prepared_spells,
          cantrips_known, currency, resource_pools, xp, weight_1, weight_2, perception_float,
          state_stage, state_stage_timer, perception_bonus, stealth_bonus, created_at, updated_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        )
      `,
        )
        .bind(
          'test-char-5',
          'Arthur',
          '{"str":15,"dex":14,"con":16,"int":13,"wis":14,"cha":16}',
          50,
          55,
          12,
          10,
          'pc',
          'Fighter',
          'Human',
          '[]',
          '[]',
          '[]',
          '[]',
          '[]',
          '[]',
          '[]',
          '{"gold":200}',
          '[]',
          0,
          2.2,
          2.1,
          0.8,
          0,
          0,
          0,
          0,
          new Date().toISOString(),
          new Date().toISOString(),
        )
        .run()

      // Temporarily remove LORE_DB
      const envNoKv = { ...testEnv, LORE_DB: undefined }
      const result = await syncCharacterToKv(envNoKv as AppBindings, 'test-char-5')

      expect(result).toBeNull()
    })

    it('returns null when RPG_DB is not available', async () => {
      const testEnv = env as unknown as AppBindings

      const envNoDb = { ...testEnv, RPG_DB: undefined }
      const result = await syncCharacterToKv(envNoDb as AppBindings, 'nonexistent')

      expect(result).toBeNull()
    })

    it('returns null when character not found in D1', async () => {
      const testEnv = env as unknown as AppBindings

      const result = await syncCharacterToKv(testEnv, 'nonexistent-character')

      expect(result).toBeNull()
    })

    it('silently handles database errors', async () => {
      const testEnv = env as unknown as AppBindings

      // Create a character
      await testEnv
        .RPG_DB!.prepare(
          `
        INSERT INTO characters (
          id, name, stats, hp, max_hp, ac, level, character_type, character_class, race,
          conditions, resistances, vulnerabilities, immunities, known_spells, prepared_spells,
          cantrips_known, currency, resource_pools, xp, weight_1, weight_2, perception_float,
          state_stage, state_stage_timer, perception_bonus, stealth_bonus, created_at, updated_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        )
      `,
        )
        .bind(
          'test-char-6',
          'Lancelot',
          '{"str":17,"dex":15,"con":15,"int":12,"wis":13,"cha":14}',
          48,
          52,
          13,
          12,
          'pc',
          'Paladin',
          'Human',
          '[]',
          '[]',
          '[]',
          '[]',
          '[]',
          '[]',
          '[]',
          '{"gold":250}',
          '[]',
          0,
          2.0,
          2.0,
          0.85,
          0,
          0,
          0,
          0,
          new Date().toISOString(),
          new Date().toISOString(),
        )
        .run()

      // Mock a broken KV put (simulate error)
      const brokenEnv = {
        ...testEnv,
        LORE_DB: {
          put: () => Promise.reject(new Error('KV write failed')),
        },
      }

      const result = await syncCharacterToKv(brokenEnv as unknown as AppBindings, 'test-char-6')

      // Should return null on error (best-effort)
      expect(result).toBeNull()
    })
  })

  describe('syncAllCharactersToKv', () => {
    it('syncs all D1 characters to KV', async () => {
      const testEnv = env as unknown as AppBindings

      // Create multiple characters
      const charData = [
        { id: 'char-1', name: 'Alice' },
        { id: 'char-2', name: 'Bob' },
        { id: 'char-3', name: 'Charlie' },
      ]

      for (const char of charData) {
        await testEnv
          .RPG_DB!.prepare(
            `
          INSERT INTO characters (
            id, name, stats, hp, max_hp, ac, level, character_type, character_class, race,
            conditions, resistances, vulnerabilities, immunities, known_spells, prepared_spells,
            cantrips_known, currency, resource_pools, xp, weight_1, weight_2, perception_float,
            state_stage, state_stage_timer, perception_bonus, stealth_bonus, created_at, updated_at
          ) VALUES (
            ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
          )
        `,
          )
          .bind(
            char.id,
            char.name,
            '{"str":10,"dex":10,"con":10,"int":10,"wis":10,"cha":10}',
            25,
            30,
            12,
            5,
            'npc',
            'Commoner',
            'Human',
            '[]',
            '[]',
            '[]',
            '[]',
            '[]',
            '[]',
            '[]',
            '{"gold":10}',
            '[]',
            0,
            1.0,
            1.0,
            0.5,
            0,
            0,
            0,
            0,
            new Date().toISOString(),
            new Date().toISOString(),
          )
          .run()
      }

      const synced = await syncAllCharactersToKv(testEnv)

      expect(synced).toBe(3)
    })

    it('returns 0 when no characters exist', async () => {
      const testEnv = env as unknown as AppBindings

      const synced = await syncAllCharactersToKv(testEnv)

      expect(synced).toBe(0)
    })

    it('returns 0 when RPG_DB is not available', async () => {
      const testEnv = env as unknown as AppBindings

      const envNoDb = { ...testEnv, RPG_DB: undefined }
      const result = await syncAllCharactersToKv(envNoDb as AppBindings)

      expect(result).toBe(0)
    })

    it('returns 0 when LORE_DB is not available', async () => {
      const testEnv = env as unknown as AppBindings

      const envNoKv = { ...testEnv, LORE_DB: undefined }
      const result = await syncAllCharactersToKv(envNoKv as AppBindings)

      expect(result).toBe(0)
    })

    it('silently handles database errors', async () => {
      const testEnv = env as unknown as AppBindings

      // Create a character
      await testEnv
        .RPG_DB!.prepare(
          `
        INSERT INTO characters (
          id, name, stats, hp, max_hp, ac, level, character_type, character_class, race,
          conditions, resistances, vulnerabilities, immunities, known_spells, prepared_spells,
          cantrips_known, currency, resource_pools, xp, weight_1, weight_2, perception_float,
          state_stage, state_stage_timer, perception_bonus, stealth_bonus, created_at, updated_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        )
      `,
        )
        .bind(
          'char-error',
          'ErrorTest',
          '{"str":10,"dex":10,"con":10,"int":10,"wis":10,"cha":10}',
          25,
          30,
          12,
          5,
          'npc',
          'Commoner',
          'Human',
          '[]',
          '[]',
          '[]',
          '[]',
          '[]',
          '[]',
          '[]',
          '{"gold":10}',
          '[]',
          0,
          1.0,
          1.0,
          0.5,
          0,
          0,
          0,
          0,
          new Date().toISOString(),
          new Date().toISOString(),
        )
        .run()

      // Mock a broken query
      const brokenEnv = {
        ...testEnv,
        RPG_DB: {
          prepare: () => ({
            all: () => Promise.reject(new Error('Query failed')),
          }),
        },
      }

      const result = await syncAllCharactersToKv(brokenEnv as unknown as AppBindings)

      // Should return 0 on error (best-effort)
      expect(result).toBe(0)
    })
  })
})
