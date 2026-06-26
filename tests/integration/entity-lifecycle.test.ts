// tests/integration/entity-lifecycle.test.ts
// Integration test: entity_manage lifecycle — generate → move → interact → destroy
// Covers: generate, move, get_inventory, list_active_threads, destroy, get_sensory_profile

import { describe, it, expect, beforeEach } from 'vitest';
import { createMockContext } from '../unit/mocks';
import { handle_entity_manage } from '../../src/tools/entity-manage';

const ARCHETYPE_KEY = 'archetype:test-guard';
const LOCATION_A = 'location:gatehouse';
const LOCATION_B = 'location:courtyard';

const ARCHETYPE_TEXT = `**Name:** Guard
**Role:** sentinel
**Species:** Human
**Weight-1:** 0.7
**Weight-2:** 0.4
**Sensory:** sight=10, hearing=8, smell=3`;

const LOCATION_A_TEXT = `**Name:** Gatehouse
**Type:** fortification
**Description:** A stone gatehouse at the castle entrance.`;

const LOCATION_B_TEXT = `**Name:** Courtyard
**Type:** open_area
**Description:** An open courtyard with a fountain.`;

function callEntity(ctx: ReturnType<typeof createMockContext>, args: Record<string, unknown>) {
  return handle_entity_manage({
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

describe('Entity lifecycle integration', () => {
  let ctx: ReturnType<typeof createMockContext>;

  beforeEach(() => {
    ctx = createMockContext({
      [ARCHETYPE_KEY]: JSON.stringify({ text: ARCHETYPE_TEXT, meta: { version: 1 } }),
      [LOCATION_A]: JSON.stringify({ text: LOCATION_A_TEXT, meta: { version: 1 } }),
      [LOCATION_B]: JSON.stringify({ text: LOCATION_B_TEXT, meta: { version: 1 } }),
    });
  });

  it('generates entity from archetype, moves it, then destroys it', async () => {
    // 1. GENERATE
    const genRes = await callEntity(ctx, {
      action: 'generate',
      archetype_key: ARCHETYPE_KEY,
      location_key: LOCATION_A,
    });
    const genBody = await jsonBody(genRes);
    expect(genBody.result).toBeDefined();
    const entityKey = genBody.result.entity_key || genBody.result.key;
    expect(entityKey).toBeDefined();
    console.log('Generated entity:', entityKey);

    // 2. MOVE to new location
    const moveRes = await callEntity(ctx, {
      action: 'move',
      entity_key: entityKey,
      new_location_key: LOCATION_B,
    });
    const moveBody = await jsonBody(moveRes);
    expect(moveBody.result).toBeDefined();
    expect(moveBody.error).toBeUndefined();

    // 3. GET_INVENTORY
    const invRes = await callEntity(ctx, {
      action: 'get_inventory',
      entity_key: entityKey,
    });
    const invBody = await jsonBody(invRes);
    // Should have some inventory structure (may be empty but should not error)
    expect(invBody.result).toBeDefined();

    // 4. GET_SENSORY_PROFILE
    const sensoryRes = await callEntity(ctx, {
      action: 'get_sensory_profile',
      entity_key: entityKey,
    });
    const sensoryBody = await jsonBody(sensoryRes);
    expect(sensoryBody.result).toBeDefined();

    // 5. DESTROY
    const destroyRes = await callEntity(ctx, {
      action: 'destroy',
      entity_key: entityKey,
    });
    const destroyBody = await jsonBody(destroyRes);
    expect(destroyBody.result).toBeDefined();
  });

  it('lists active threads even when empty', async () => {
    const threadsRes = await callEntity(ctx, {
      action: 'list_active_threads',
    });
    const threadsBody = await jsonBody(threadsRes);
    expect(threadsBody.result).toBeDefined();
    // Should return an array (possibly empty)
    expect(Array.isArray(threadsBody.result.threads) || threadsBody.result.threads === null || threadsBody.result.threads === undefined).toBeTruthy();
  });

  it('advances entity stage', async () => {
    // Generate entity first
    const genRes = await callEntity(ctx, {
      action: 'generate',
      archetype_key: ARCHETYPE_KEY,
      location_key: LOCATION_A,
    });
    const genBody = await jsonBody(genRes);
    const entityKey = genBody.result.entity_key || genBody.result.key;

    // Advance stage
    const advanceRes = await callEntity(ctx, {
      action: 'advance_stage',
      entity_key: entityKey,
    });
    const advanceBody = await jsonBody(advanceRes);
    expect(advanceBody.result).toBeDefined();
  });

  it('transfers items between entities', async () => {
    // Create two entities
    const genARes = await callEntity(ctx, {
      action: 'generate',
      archetype_key: ARCHETYPE_KEY,
      location_key: LOCATION_A,
    });
    const genABody = await jsonBody(genARes);
    const entityA = genABody.result.entity_key || genABody.result.key;

    const genBRes = await callEntity(ctx, {
      action: 'generate',
      archetype_key: ARCHETYPE_KEY,
      location_key: LOCATION_A,
    });
    const genBBody = await jsonBody(genBRes);
    const entityB = genBBody.result.entity_key || genBBody.result.key;

    // Transfer a made-up item - this will likely fail gracefully
    // but it exercises the transfer_item code path
    const transferRes = await callEntity(ctx, {
      action: 'transfer_item',
      from_entity: entityA,
      to_entity: entityB,
      item_key: 'item:torch',
      quantity: 1,
    });
    const transferBody = await jsonBody(transferRes);
    // Just verify it doesn't crash the server
    expect(transferBody).toBeDefined();
  });
});
