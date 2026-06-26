// tests/integration/thread-system.test.ts
// Integration test: world_manage — thread_tick, get_thread_comparison, check_convergence
// Covers: thread_tick, get_thread_comparison, check_convergence, get_relationship, get_location_occupants

import { describe, it, expect, beforeEach } from 'vitest';
import { createMockContext } from '../unit/mocks';
import { handle_world_manage } from '../../src/tools/world-manage';

const ENTITY_A = 'character:knight';
const ENTITY_B = 'character:wizard';
const LOCATION_KEY = 'location:crossroads';

const ENTITY_A_TEXT = `**Name:** Sir Cedric
**Role:** knight
**Species:** Human
**Location:** location:crossroads
**Threads:**
- thread:main-quest: In Progress`;

const ENTITY_B_TEXT = `**Name:** Elara
**Role:** wizard
**Species:** Elf
**Location:** location:crossroads
**Threads:**
- thread:main-quest: In Progress`;

const LOCATION_TEXT = `**Name:** Crossroads
**Type:** landmark
**Occupants:** character:knight, character:wizard`;

function callWorld(ctx: ReturnType<typeof createMockContext>, args: Record<string, unknown>) {
  return handle_world_manage({
    c: ctx,
    id: 'test-id',
    isAuthenticated: true,
    args,
  });
}

async function jsonBody(res: Response): Promise<any> {
  expect(res.status).toBe(200);
  return res.json();
}

describe('Thread system integration', () => {
  let ctx: ReturnType<typeof createMockContext>;

  beforeEach(() => {
    ctx = createMockContext({
      [ENTITY_A]: JSON.stringify({ text: ENTITY_A_TEXT, meta: { version: 1 } }),
      [ENTITY_B]: JSON.stringify({ text: ENTITY_B_TEXT, meta: { version: 1 } }),
      [LOCATION_KEY]: JSON.stringify({ text: LOCATION_TEXT, meta: { version: 1 } }),
    });
  });

  describe('Thread lifecycle', () => {
    it('ticks a thread and returns state', async () => {
      const tickRes = await callWorld(ctx, {
        action: 'thread_tick',
        thread_id: 'thread:main-quest',
      });
      const tickBody = await jsonBody(tickRes);
      expect(tickBody.result).toBeDefined();
    });

    it('handles missing thread_id gracefully', async () => {
      const tickRes = await callWorld(ctx, {
        action: 'thread_tick',
        thread_id: 'thread:nonexistent-xyz',
      });
      const tickBody = await jsonBody(tickRes);
      // Should not crash — error or empty result
      expect(tickBody).toBeDefined();
    });
  });

  describe('Thread comparison', () => {
    it('compares two threads', async () => {
      const compareRes = await callWorld(ctx, {
        action: 'get_thread_comparison',
        thread_a: 'thread:main-quest',
        thread_b: 'thread:side-quest',
      });
      const compareBody = await jsonBody(compareRes);
      expect(compareBody.result).toBeDefined();
    });
  });

  describe('Convergence check', () => {
    it('checks if two threads are converging', async () => {
      const convRes = await callWorld(ctx, {
        action: 'check_convergence',
        thread_a: 'thread:main-quest',
        thread_b: 'thread:side-quest',
      });
      const convBody = await jsonBody(convRes);
      expect(convBody.result).toBeDefined();
    });
  });

  describe('Relationships', () => {
    it('gets relationship between two entities', async () => {
      const relRes = await callWorld(ctx, {
        action: 'get_relationship',
        entity_a: ENTITY_A,
        entity_b: ENTITY_B,
      });
      const relBody = await jsonBody(relRes);
      expect(relBody.result).toBeDefined();
    });
  });

  describe('Location occupants', () => {
    it('lists occupants at a location', async () => {
      const occRes = await callWorld(ctx, {
        action: 'get_location_occupants',
        location_key: LOCATION_KEY,
      });
      const occBody = await jsonBody(occRes);
      expect(occBody.result).toBeDefined();
    });

    it('handles empty location', async () => {
      const occRes = await callWorld(ctx, {
        action: 'get_location_occupants',
        location_key: 'location:void',
      });
      const occBody = await jsonBody(occRes);
      expect(occBody).toBeDefined();
    });
  });

  describe('Reachable locations', () => {
    it('gets reachable locations from origin', async () => {
      const reachRes = await callWorld(ctx, {
        action: 'get_reachable_locations',
        origin_key: LOCATION_KEY,
      });
      const reachBody = await jsonBody(reachRes);
      expect(reachBody.result).toBeDefined();
    });
  });

  describe('Sense environment', () => {
    it('senses environment from entity perspective', async () => {
      const senseRes = await callWorld(ctx, {
        action: 'sense_environment',
        entity_key: ENTITY_A,
        location_key: LOCATION_KEY,
      });
      const senseBody = await jsonBody(senseRes);
      expect(senseBody.result).toBeDefined();
    });
  });

  describe('Faction standing', () => {
    it('gets faction standing for an entity', async () => {
      const factionRes = await callWorld(ctx, {
        action: 'get_faction_standing',
        entity_key: ENTITY_A,
        faction_key: 'faction:kingdom',
      });
      const factionBody = await jsonBody(factionRes);
      expect(factionBody.result).toBeDefined();
    });
  });

  describe('Entity knowledge', () => {
    it('gets entity knowledge about a topic', async () => {
      const knowRes = await callWorld(ctx, {
        action: 'get_entity_knowledge',
        entity_key: ENTITY_A,
        topic: 'dragons',
      });
      const knowBody = await jsonBody(knowRes);
      expect(knowBody.result).toBeDefined();
    });
  });
});
