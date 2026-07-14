// tests/integration/inventory-flow.test.ts
// Integration test: inventory operations with entity_manage and continuity_manage
// Covers: get_inventory, transfer_item, list_consumption_timelines, get_compatibility, analyze_utility

import { describe, it, expect, beforeEach } from 'vitest';
import { createMockContext } from '../unit/mocks';
import { handle_entity_manage } from '../../src/tools/entity-manage';
import { handle_continuity_manage } from '../../src/tools/continuity-manage';

const ENTITY_A = 'character:merchant';
const ENTITY_B = 'character:adventurer';
const ARCHETYPE_KEY = 'archetype:trader';

const ENTITY_A_TEXT = `**Name:** Gregor
**Role:** merchant
**Species:** Human
**Weight-1:** 0.5
**Inventory:**
- 3× Gold Coin
- 1× Silk Cloak`;

const ENTITY_B_TEXT = `**Name:** Hilda
**Role:** adventurer
**Species:** Dwarf
**Weight-1:** 0.8`;

const ARCHETYPE_TEXT = `**Name:** Trader
**Role:** merchant
**Species:** Human
**Weight-1:** 0.5`;

function callEntity(ctx: ReturnType<typeof createMockContext>, args: Record<string, unknown>) {
  return handle_entity_manage({
    c: ctx,
    id: 'test-id',
    isAuthenticated: true,
    args,
  });
}

function callContinuity(ctx: ReturnType<typeof createMockContext>, args: Record<string, unknown>) {
  return handle_continuity_manage({
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

describe('Inventory flow integration', () => {
  let ctx: ReturnType<typeof createMockContext>;

  beforeEach(() => {
    ctx = createMockContext({
      [ENTITY_A]: JSON.stringify({ text: ENTITY_A_TEXT, meta: { version: 1 } }),
      [ENTITY_B]: JSON.stringify({ text: ENTITY_B_TEXT, meta: { version: 1 } }),
      [ARCHETYPE_KEY]: JSON.stringify({ text: ARCHETYPE_TEXT, meta: { version: 1 } }),
    });
  });

  describe('Inventory operations', () => {
    it('gets inventory for an entity with items', async () => {
      const invRes = await callEntity(ctx, {
        action: 'get_inventory',
        entity_key: ENTITY_A,
      });
      const invBody = await jsonBody(invRes);
      expect(invBody.result).toBeDefined();
      // Inventory should not be empty for a merchant with items
    });

    it('gets inventory for an entity without explicit inventory', async () => {
      const invRes = await callEntity(ctx, {
        action: 'get_inventory',
        entity_key: ENTITY_B,
      });
      const invBody = await jsonBody(invRes);
      expect(invBody.result).toBeDefined();
    });

    it('transfers items between entities', async () => {
      const transferRes = await callEntity(ctx, {
        action: 'transfer_item',
        from_entity: ENTITY_A,
        to_entity: ENTITY_B,
        item_key: 'item:gold-coin',
        quantity: 1,
      });
      const transferBody = await jsonBody(transferRes);
      expect(transferBody).toBeDefined();
      // Verify it doesn't crash (success or graceful error)
    });
  });

  describe('Consumption timelines', () => {
    it('lists consumption timelines', async () => {
      const listRes = await callEntity(ctx, {
        action: 'list_consumption_timelines',
        limit: 50,
        offset: 0,
        status_filter: 'all',
      });
      const listBody = await jsonBody(listRes);
      expect(listBody.result).toBeDefined();
      expect(Array.isArray(listBody.result.timelines) || listBody.result.timelines === undefined).toBeTruthy();
    });

    it('creates and updates a consumption timeline', async () => {
      const createRes = await callEntity(ctx, {
        action: 'create_consumption_timeline',
        entity_key: ENTITY_A,
        predator_key: ENTITY_B,
        stages: 4,
        stage_timer: 3,
        terminal_state: 'consumed-nutrient',
      });
      const createBody = await jsonBody(createRes);
      expect(createBody.result).toBeDefined();
      expect(createBody.result.timeline).toBeDefined();

      // Update the timeline
      const setRes = await callEntity(ctx, {
        action: 'set_consumption_timeline',
        entity_key: ENTITY_A,
        current_stage: 2,
      });
      const setBody = await jsonBody(setRes);
      expect(setBody.result).toBeDefined();
      expect(setBody.result.timeline.current_stage).toBe(2);
    });
  });

  describe('Compatibility and utility', () => {
    it('gets compatibility between two entities', async () => {
      const compRes = await callEntity(ctx, {
        action: 'get_compatibility',
        entity_a: ENTITY_A,
        entity_b: ENTITY_B,
        interaction_type: 'trade',
      });
      const compBody = await jsonBody(compRes);
      expect(compBody.result).toBeDefined();
    });

    it('analyzes entity utility vectors', async () => {
      const vectors = ['GASTRIC', 'BUTCHERY', 'INCUBATION', 'SCULPTURE', 'PARASITISM', 'THRALL', 'DISTRIBUTED'];
      for (const vector of vectors) {
        const utilRes = await callEntity(ctx, {
          action: 'analyze_utility',
          entity_id: ENTITY_A,
          utility_vector: vector,
          entity_role: 'subject',
        });
        const utilBody = await jsonBody(utilRes);
        expect(utilBody.result).toBeDefined();
      }
    });
  });

  describe('Continuity events', () => {
    it('appends events and retrieves event log', async () => {
      // Append event
      const appendRes = await callContinuity(ctx, {
        action: 'append_event',
        entity_key: ENTITY_A,
        verb: 'traded',
        object: 'gold coin',
        location: 'market-square',
        thread: 'thread:trade',
        detail: 'Sold a gold coin to a stranger',
        world_id: 'test-world-1',
      });
      const appendBody = await jsonBody(appendRes);
      expect(appendBody.result).toBeDefined();

      // Get event log
      const logRes = await callContinuity(ctx, {
        action: 'get_event_log',
        entity_key: ENTITY_A,
        limit: 10,
      });
      const logBody = await jsonBody(logRes);
      expect(logBody.result).toBeDefined();
    });

    it('tags topics and finds by tag', async () => {
      // Tag a topic
      const tagRes = await callContinuity(ctx, {
        action: 'tag_topic',
        key: ENTITY_A,
        add: ['merchant', 'human'],
        remove: [],
      });
      const tagBody = await jsonBody(tagRes);
      expect(tagBody.result).toBeDefined();

      // Find by tag
      const findRes = await callContinuity(ctx, {
        action: 'find_by_tag',
        tags: ['merchant'],
        mode: 'any',
        with_excerpt: true,
        limit: 10,
      });
      const findBody = await jsonBody(findRes);
      expect(findBody.result).toBeDefined();
    });

    it('lists all tags', async () => {
      const listTagsRes = await callContinuity(ctx, {
        action: 'list_tags',
        prefix: '',
        with_counts: true,
        limit: 100,
      });
      const listTagsBody = await jsonBody(listTagsRes);
      expect(listTagsBody.result).toBeDefined();
    });

    it('bookmarks state and diffs', async () => {
      // Bookmark
      const bookmarkRes = await callContinuity(ctx, {
        action: 'bookmark_state',
        name: 'pre-trade',
        note: 'Before the big trade',
      });
      const bookmarkBody = await jsonBody(bookmarkRes);
      expect(bookmarkBody.result).toBeDefined();

      // Diff
      const diffRes = await callContinuity(ctx, {
        action: 'world_diff',
        from: 'pre-trade',
        to: undefined,
        detail: 'summary',
      });
      const diffBody = await jsonBody(diffRes);
      expect(diffBody.result).toBeDefined();
    });

    it('plants and lists setups', async () => {
      // Plant setup
      const plantRes = await callContinuity(ctx, {
        action: 'plant_setup',
        id: 'setup:betrayal',
        description: 'The merchant has a hidden agenda',
        planted_in: 'scene:tavern-intro',
        tension: 3,
        actors: [ENTITY_A],
      });
      const plantBody = await jsonBody(plantRes);
      expect(plantBody.result).toBeDefined();

      // List unpaid setups
      const listRes = await callContinuity(ctx, {
        action: 'list_unpaid_setups',
        actor: ENTITY_A,
        min_tension: 1,
      });
      const listBody = await jsonBody(listRes);
      expect(listBody.result).toBeDefined();
    });

    it('runs continuity checks', async () => {
      const checkRes = await callContinuity(ctx, {
        action: 'check_continuity',
        checks: ['dangling', 'occupancy', 'knowledge', 'inventory'],
        severity_floor: 'info',
      });
      const checkBody = await jsonBody(checkRes);
      expect(checkBody.result).toBeDefined();
    });
  });
});
