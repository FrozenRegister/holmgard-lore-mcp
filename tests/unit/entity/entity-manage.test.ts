import { describe, it, expect } from 'vitest';
import { handle_entity_manage } from '../../../src/tools/entity-manage';
import { createMockContext } from '../mocks';

/**
 * Pre-seeded entity data for entity-manage routing tests.
 */
const PREY_ENTITY = JSON.stringify({
  text: '**Name:** Seraphine\n**Role:** herbalist\n**Weight-2:** 0.6',
  meta: { version: 1, createdAt: '2026-06-23T00:00:00.000Z' },
});

const PREDATOR_ENTITY = JSON.stringify({
  text: '**Name:** Stalker\n**Role:** hunter\n**Weight-1:** 0.9',
  meta: { version: 1, createdAt: '2026-06-23T00:00:00.000Z' },
});

describe('handle_entity_manage', () => {
  it('returns error when action is missing', async () => {
    const mockCtx = createMockContext();
    const result = await handle_entity_manage({
      c: mockCtx,
      id: 'test-id',
      isAuthenticated: true,
      args: {},
    });
    expect(result.status).toBe(200);
    const body: any = await result.json();
    expect(body.error).toBeDefined();
    expect(body.error.message).toContain('Missing required param: action');
  });

  it('returns error for unknown action', async () => {
    const mockCtx = createMockContext();
    const result = await handle_entity_manage({
      c: mockCtx,
      id: 'test-id',
      isAuthenticated: true,
      args: { action: 'nonexistent_action_xyz' },
    });
    expect(result.status).toBe(200);
    const body: any = await result.json();
    expect(body.error).toBeDefined();
    expect(body.error.message).toContain('Unknown action "nonexistent_action_xyz"');
  });

  it('routes create_consumption_timeline action to handler', async () => {
    const mockCtx = createMockContext({
      'character:seraphine': PREY_ENTITY,
      'entity:stalker': PREDATOR_ENTITY,
    });
    const result = await handle_entity_manage({
      c: mockCtx,
      id: 'test-id',
      isAuthenticated: true,
      args: {
        action: 'create_consumption_timeline',
        entity_key: 'character:seraphine',
        predator_key: 'entity:stalker',
        stages: 3,
        stage_timer: 2,
        terminal_state: 'consumed-nutrient',
      },
    });
    expect(result.status).toBe(200);
    const body: any = await result.json();
    expect(body.error).toBeUndefined();
    expect(body.result).toBeDefined();
    expect(body.result.timeline).toBeDefined();
    expect(body.result.timeline.entity_key).toBe('character:seraphine');
  });

  it('routes set_consumption_timeline action to handler', async () => {
    const EXISTING_TIMELINE = JSON.stringify({
      entity_key: 'character:seraphine',
      predator_key: 'entity:stalker',
      stages: 5,
      stage_timer: 3,
      current_stage: 0,
      terminal_state: 'consumed-nutrient',
      created_at: '2026-06-23T00:00:00.000Z',
      updated_at: '2026-06-23T00:00:00.000Z',
    });
    const mockCtx = createMockContext({
      'character:seraphine': PREY_ENTITY,
      '_idx:consumption:character:seraphine': EXISTING_TIMELINE,
    });
    const result = await handle_entity_manage({
      c: mockCtx,
      id: 'test-id',
      isAuthenticated: true,
      args: {
        action: 'set_consumption_timeline',
        entity_key: 'character:seraphine',
        current_stage: 2,
      },
    });
    expect(result.status).toBe(200);
    const body: any = await result.json();
    expect(body.error).toBeUndefined();
    expect(body.result.timeline.current_stage).toBe(2);
  });
});
