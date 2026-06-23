import { describe, it, expect, afterAll, vi } from 'vitest';
import {
  handle_create_consumption_timeline,
  handle_set_consumption_timeline,
} from '../../../src/tools/entity';
import { createMockContext } from '../mocks';

/**
 * Pre-seeded entity data for consumption timeline tests.
 * Format matches the JSON blob stored in KV: { text, meta }.
 * Fields use markdown bold format so extractFieldFromText can parse them.
 */
const PREY_ENTITY = JSON.stringify({
  text: '**Name:** Seraphine\n**Role:** herbalist\n**Weight-2:** 0.6',
  meta: { version: 1, createdAt: '2026-06-23T00:00:00.000Z' },
});

const PREDATOR_ENTITY = JSON.stringify({
  text: '**Name:** Stalker\n**Role:** hunter\n**Weight-1:** 0.9',
  meta: { version: 1, createdAt: '2026-06-23T00:00:00.000Z' },
});

const SECOND_PREDATOR = JSON.stringify({
  text: '**Name:** Devourer\n**Role:** apex\n**Weight-1:** 0.95',
  meta: { version: 1, createdAt: '2026-06-23T00:00:00.000Z' },
});

describe('handle_create_consumption_timeline', () => {
  afterAll(() => {
    vi.restoreAllMocks();
  });

  it('returns error when entity does not exist', async () => {
    const mockCtx = createMockContext({
      'entity:stalker': PREDATOR_ENTITY,
    });
    const result = await handle_create_consumption_timeline({
      c: mockCtx,
      id: 'test-id',
      isAuthenticated: true,
      args: {
        entity_key: 'character:nonexistent',
        predator_key: 'entity:stalker',
        stages: 5,
        stage_timer: 3,
        terminal_state: 'consumed-nutrient',
      },
    });
    expect(result.status).toBe(200);
    const body: any = await result.json();
    expect(body.error).toBeDefined();
    expect(body.error.message).toContain('Entity "character:nonexistent" not found');
  });

  it('returns error when predator does not exist', async () => {
    const mockCtx = createMockContext({
      'character:prey': PREY_ENTITY,
    });
    const result = await handle_create_consumption_timeline({
      c: mockCtx,
      id: 'test-id',
      isAuthenticated: true,
      args: {
        entity_key: 'character:prey',
        predator_key: 'entity:nonexistent-predator',
        stages: 5,
        stage_timer: 3,
        terminal_state: 'consumed-nutrient',
      },
    });
    expect(result.status).toBe(200);
    const body: any = await result.json();
    expect(body.error).toBeDefined();
    expect(body.error.message).toContain('Predator "entity:nonexistent-predator" not found');
  });

  it('returns error when timeline already exists', async () => {
    const mockCtx = createMockContext({
      'character:prey': PREY_ENTITY,
      'entity:stalker': PREDATOR_ENTITY,
      '_idx:consumption:character:prey': JSON.stringify({
        entity_key: 'character:prey',
        predator_key: 'entity:stalker',
        stages: 3,
        stage_timer: 1,
        current_stage: 0,
        terminal_state: 'consumed-nutrient',
      }),
    });
    const result = await handle_create_consumption_timeline({
      c: mockCtx,
      id: 'test-id',
      isAuthenticated: true,
      args: {
        entity_key: 'character:prey',
        predator_key: 'entity:stalker',
        stages: 5,
        stage_timer: 3,
        terminal_state: 'consumed-nutrient',
      },
    });
    expect(result.status).toBe(200);
    const body: any = await result.json();
    expect(body.error).toBeDefined();
    expect(body.error.message).toContain('Consumption timeline already exists for "character:prey"');
  });

  it('creates timeline successfully with default current_stage', async () => {
    const mockCtx = createMockContext({
      'character:prey': PREY_ENTITY,
      'entity:stalker': PREDATOR_ENTITY,
    });
    const result = await handle_create_consumption_timeline({
      c: mockCtx,
      id: 'test-id',
      isAuthenticated: true,
      args: {
        entity_key: 'character:prey',
        predator_key: 'entity:stalker',
        stages: 5,
        stage_timer: 3,
        terminal_state: 'consumed-nutrient',
      },
    });
    expect(result.status).toBe(200);
    const body: any = await result.json();
    expect(body.error).toBeUndefined();
    expect(body.result).toBeDefined();
    expect(body.result.timeline).toBeDefined();
    expect(body.result.timeline.entity_key).toBe('character:prey');
    expect(body.result.timeline.predator_key).toBe('entity:stalker');
    expect(body.result.timeline.stages).toBe(5);
    expect(body.result.timeline.stage_timer).toBe(3);
    expect(body.result.timeline.current_stage).toBe(0);
    expect(body.result.timeline.terminal_state).toBe('consumed-nutrient');
    expect(body.result.timeline.created_at).toBeDefined();
    expect(body.result.timeline.updated_at).toBeDefined();
    // Verify entity text was enriched with consumption fields
    expect(body.result.content[0].text).toContain('Consumption timeline created for "character:prey"');
  });

  it('creates timeline with explicit current_stage', async () => {
    const key = 'character:prey-2';
    const mockCtx = createMockContext({
      [key]: PREY_ENTITY,
      'entity:stalker': PREDATOR_ENTITY,
    });
    const result = await handle_create_consumption_timeline({
      c: mockCtx,
      id: 'test-id',
      isAuthenticated: true,
      args: {
        entity_key: key,
        predator_key: 'entity:stalker',
        stages: 10,
        stage_timer: 5,
        terminal_state: 'transformed-vessel',
        current_stage: 2,
      },
    });
    expect(result.status).toBe(200);
    const body: any = await result.json();
    expect(body.error).toBeUndefined();
    expect(body.result.timeline.current_stage).toBe(2);
    expect(body.result.timeline.terminal_state).toBe('transformed-vessel');
  });
});

describe('handle_set_consumption_timeline', () => {
  afterAll(() => {
    vi.restoreAllMocks();
  });

  const EXISTING_TIMELINE = JSON.stringify({
    entity_key: 'character:prey',
    predator_key: 'entity:stalker',
    stages: 5,
    stage_timer: 3,
    current_stage: 0,
    terminal_state: 'consumed-nutrient',
    created_at: '2026-06-23T00:00:00.000Z',
    updated_at: '2026-06-23T00:00:00.000Z',
  });

  it('returns error when entity does not exist', async () => {
    const mockCtx = createMockContext();
    const result = await handle_set_consumption_timeline({
      c: mockCtx,
      id: 'test-id',
      isAuthenticated: true,
      args: {
        entity_key: 'character:nonexistent',
        current_stage: 1,
      },
    });
    expect(result.status).toBe(200);
    const body: any = await result.json();
    expect(body.error).toBeDefined();
    expect(body.error.message).toContain('Entity "character:nonexistent" not found');
  });

  it('returns error when no timeline exists for entity', async () => {
    const mockCtx = createMockContext({
      'character:prey': PREY_ENTITY,
    });
    const result = await handle_set_consumption_timeline({
      c: mockCtx,
      id: 'test-id',
      isAuthenticated: true,
      args: {
        entity_key: 'character:prey',
        stage_timer: 1,
      },
    });
    expect(result.status).toBe(200);
    const body: any = await result.json();
    expect(body.error).toBeDefined();
    expect(body.error.message).toContain('No consumption timeline exists for "character:prey"');
  });

  it('updates stage_timer on existing timeline', async () => {
    const mockCtx = createMockContext({
      'character:prey': PREY_ENTITY,
      '_idx:consumption:character:prey': EXISTING_TIMELINE,
    });
    const result = await handle_set_consumption_timeline({
      c: mockCtx,
      id: 'test-id',
      isAuthenticated: true,
      args: {
        entity_key: 'character:prey',
        stage_timer: 1,
      },
    });
    expect(result.status).toBe(200);
    const body: any = await result.json();
    expect(body.error).toBeUndefined();
    expect(body.result.timeline.stage_timer).toBe(1);
    expect(body.result.timeline.current_stage).toBe(0);
    expect(body.result.timeline.stages).toBe(5);
    expect(body.result.metadata.is_terminal).toBe(false);
  });

  it('advances current_stage without triggering terminal', async () => {
    const mockCtx = createMockContext({
      'character:prey': PREY_ENTITY,
      '_idx:consumption:character:prey': EXISTING_TIMELINE,
    });
    const result = await handle_set_consumption_timeline({
      c: mockCtx,
      id: 'test-id',
      isAuthenticated: true,
      args: {
        entity_key: 'character:prey',
        current_stage: 3,
      },
    });
    expect(result.status).toBe(200);
    const body: any = await result.json();
    expect(body.error).toBeUndefined();
    expect(body.result.timeline.current_stage).toBe(3);
    expect(body.result.metadata.is_terminal).toBe(false);
  });

  it('detects terminal stage when current_stage >= stages', async () => {
    const mockCtx = createMockContext({
      'character:prey': PREY_ENTITY,
      '_idx:consumption:character:prey': EXISTING_TIMELINE,
    });
    const result = await handle_set_consumption_timeline({
      c: mockCtx,
      id: 'test-id',
      isAuthenticated: true,
      args: {
        entity_key: 'character:prey',
        current_stage: 5,
      },
    });
    expect(result.status).toBe(200);
    const body: any = await result.json();
    expect(body.error).toBeUndefined();
    expect(body.result.metadata.is_terminal).toBe(true);
    expect(body.result.timeline.current_stage).toBe(5);
  });

  it('updates predator_key with validation', async () => {
    const mockCtx = createMockContext({
      'character:prey': PREY_ENTITY,
      'entity:devourer': SECOND_PREDATOR,
      '_idx:consumption:character:prey': EXISTING_TIMELINE,
    });
    const result = await handle_set_consumption_timeline({
      c: mockCtx,
      id: 'test-id',
      isAuthenticated: true,
      args: {
        entity_key: 'character:prey',
        predator_key: 'entity:devourer',
      },
    });
    expect(result.status).toBe(200);
    const body: any = await result.json();
    expect(body.error).toBeUndefined();
    expect(body.result.timeline.predator_key).toBe('entity:devourer');
  });

  it('returns error when new predator does not exist', async () => {
    const mockCtx = createMockContext({
      'character:prey': PREY_ENTITY,
      '_idx:consumption:character:prey': EXISTING_TIMELINE,
    });
    const result = await handle_set_consumption_timeline({
      c: mockCtx,
      id: 'test-id',
      isAuthenticated: true,
      args: {
        entity_key: 'character:prey',
        predator_key: 'entity:missing-predator',
      },
    });
    expect(result.status).toBe(200);
    const body: any = await result.json();
    expect(body.error).toBeDefined();
    expect(body.error.message).toContain('Predator "entity:missing-predator" not found');
  });

  it('updates terminal_state', async () => {
    const mockCtx = createMockContext({
      'character:prey': PREY_ENTITY,
      '_idx:consumption:character:prey': EXISTING_TIMELINE,
    });
    const result = await handle_set_consumption_timeline({
      c: mockCtx,
      id: 'test-id',
      isAuthenticated: true,
      args: {
        entity_key: 'character:prey',
        terminal_state: 'ornament',
      },
    });
    expect(result.status).toBe(200);
    const body: any = await result.json();
    expect(body.error).toBeUndefined();
    expect(body.result.timeline.terminal_state).toBe('ornament');
  });

  it('updates multiple fields simultaneously', async () => {
    const mockCtx = createMockContext({
      'character:prey': PREY_ENTITY,
      'entity:devourer': SECOND_PREDATOR,
      '_idx:consumption:character:prey': EXISTING_TIMELINE,
    });
    const result = await handle_set_consumption_timeline({
      c: mockCtx,
      id: 'test-id',
      isAuthenticated: true,
      args: {
        entity_key: 'character:prey',
        predator_key: 'entity:devourer',
        stages: 8,
        stage_timer: 4,
        current_stage: 2,
        terminal_state: 'distributed-nutrient',
      },
    });
    expect(result.status).toBe(200);
    const body: any = await result.json();
    expect(body.error).toBeUndefined();
    expect(body.result.timeline.predator_key).toBe('entity:devourer');
    expect(body.result.timeline.stages).toBe(8);
    expect(body.result.timeline.stage_timer).toBe(4);
    expect(body.result.timeline.current_stage).toBe(2);
    expect(body.result.timeline.terminal_state).toBe('distributed-nutrient');
  });
});
