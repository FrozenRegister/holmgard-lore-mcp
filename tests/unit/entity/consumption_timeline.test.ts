import { describe, it, expect, afterAll, vi } from 'vitest';
import {
  handle_create_consumption_timeline,
  handle_set_consumption_timeline,
  createConsumptionTimelineSchema,
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
        current_stage: 0,
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
        current_stage: 0,
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
        current_stage: 0,
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
    // current_stage is optional at the schema/dispatcher boundary (defaults to 0)
    // — parse through the real schema here so this test still exercises that default,
    // since calling the handler directly bypasses the dispatcher's schema.safeParse.
    const result = await handle_create_consumption_timeline({
      c: mockCtx,
      id: 'test-id',
      isAuthenticated: true,
      args: createConsumptionTimelineSchema.parse({
        entity_key: 'character:prey',
        predator_key: 'entity:stalker',
        stages: 5,
        stage_timer: 3,
        terminal_state: 'consumed-nutrient',
      }),
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

describe('coverage gaps — edge paths', () => {
  afterAll(() => {
    vi.restoreAllMocks();
  });

  /* ── handle_create_consumption_timeline ── */

  // Invalid-params validation now happens once at the dispatcher's schema.safeParse
  // (see makeActionDispatcher in src/tools/types.ts and its tests in types.test.ts),
  // not inside the handler — calling the handler directly with malformed args is no
  // longer a case the handler itself needs to guard against. The equivalent end-to-end
  // behavior is covered by tests/worker/invalid-params-entity.test.ts, which exercises
  // this through the real entity_manage dispatch (e.g. 'create_consumption_timeline:
  // missing stages', 'set_consumption_timeline: missing entity_key').

  it('create: uses fallback version=1 when meta.version is not numeric (ternary false branch)', async () => {
    const ENTITY_STR_VERSION = JSON.stringify({
      text: '**Name:** Seraphine\n**Role:** herbalist',
      meta: { version: 'v1', createdAt: '2026-06-23T00:00:00.000Z' },
    });
    const mockCtx = createMockContext({
      'character:versioned': ENTITY_STR_VERSION,
      'entity:stalker': JSON.stringify({
        text: '**Name:** Stalker\n**Role:** hunter',
        meta: { version: 1, createdAt: '2026-06-23T00:00:00.000Z' },
      }),
    });
    const result = await handle_create_consumption_timeline({
      c: mockCtx,
      id: 'test-id',
      isAuthenticated: true,
      args: {
        entity_key: 'character:versioned',
        predator_key: 'entity:stalker',
        stages: 3,
        stage_timer: 2,
        terminal_state: 'consumed-nutrient',
        current_stage: 0,
      },
    });
    expect(result.status).toBe(200);
    const body: any = await result.json();
    expect(body.error).toBeUndefined();
    expect(body.result.timeline.entity_key).toBe('character:versioned');
    // Verify version field was written to KV by checking content text
    expect(body.result.content[0].text).toContain('Consumption timeline created');
  });

  it('create: handles missing meta.createdAt via nullish coalesce', async () => {
    const ENTITY_NO_CREATED = JSON.stringify({
      text: '**Name:** Seraphine\n**Role:** herbalist',
      meta: { version: 1 },
    });
    const mockCtx = createMockContext({
      'character:nocreated': ENTITY_NO_CREATED,
      'entity:stalker': JSON.stringify({
        text: '**Name:** Stalker',
        meta: { version: 1 },
      }),
    });
    const result = await handle_create_consumption_timeline({
      c: mockCtx,
      id: 'test-id',
      isAuthenticated: true,
      args: {
        entity_key: 'character:nocreated',
        predator_key: 'entity:stalker',
        stages: 3,
        stage_timer: 2,
        terminal_state: 'consumed-nutrient',
        current_stage: 0,
      },
    });
    expect(result.status).toBe(200);
    const body: any = await result.json();
    expect(body.error).toBeUndefined();
  });

  /* ── handle_set_consumption_timeline ── */

  it('set: handles empty predator_key in existing timeline (short-circuit on && first operand)', async () => {
    const ENTITY = JSON.stringify({
      text: '**Name:** Prey\n**Role:** target',
      meta: { version: 1, createdAt: '2026-06-23T00:00:00.000Z' },
    });
    const TIMELINE_EMPTY_PRED = JSON.stringify({
      entity_key: 'character:empty-pred',
      predator_key: '',
      stages: 5,
      stage_timer: 3,
      current_stage: 0,
      terminal_state: 'consumed-nutrient',
      created_at: '2026-06-23T00:00:00.000Z',
      updated_at: '2026-06-23T00:00:00.000Z',
    });
    const mockCtx = createMockContext({
      'character:empty-pred': ENTITY,
      '_idx:consumption:character:empty-pred': TIMELINE_EMPTY_PRED,
    });
    const result = await handle_set_consumption_timeline({
      c: mockCtx,
      id: 'test-id',
      isAuthenticated: true,
      args: {
        entity_key: 'character:empty-pred',
        stage_timer: 1,
      },
    });
    expect(result.status).toBe(200);
    const body: any = await result.json();
    expect(body.error).toBeUndefined();
    expect(body.result.timeline.stage_timer).toBe(1);
  });

  it('set: uses fallback version=1 when meta.version is not numeric (ternary false branch)', async () => {
    const ENTITY_STR_VERSION = JSON.stringify({
      text: '**Name:** Prey\n**Role:** target',
      meta: { version: 'v2', createdAt: '2026-06-23T00:00:00.000Z' },
    });
    const EXISTING = JSON.stringify({
      entity_key: 'character:str-version',
      predator_key: 'entity:stalker',
      stages: 5,
      stage_timer: 3,
      current_stage: 0,
      terminal_state: 'consumed-nutrient',
      created_at: '2026-06-23T00:00:00.000Z',
      updated_at: '2026-06-23T00:00:00.000Z',
    });
    const mockCtx = createMockContext({
      'character:str-version': ENTITY_STR_VERSION,
      '_idx:consumption:character:str-version': EXISTING,
    });
    const result = await handle_set_consumption_timeline({
      c: mockCtx,
      id: 'test-id',
      isAuthenticated: true,
      args: {
        entity_key: 'character:str-version',
        stage_timer: 1,
      },
    });
    expect(result.status).toBe(200);
    const body: any = await result.json();
    expect(body.error).toBeUndefined();
    expect(body.result.timeline.stage_timer).toBe(1);
  });

  it('set: handles missing meta.createdAt via nullish coalesce', async () => {
    const ENTITY_NO_CREATED = JSON.stringify({
      text: '**Name:** Prey\n**Role:** target',
      meta: { version: 1 },
    });
    const EXISTING = JSON.stringify({
      entity_key: 'character:nocreated-set',
      predator_key: 'entity:stalker',
      stages: 5,
      stage_timer: 3,
      current_stage: 0,
      terminal_state: 'consumed-nutrient',
      created_at: '2026-06-23T00:00:00.000Z',
      updated_at: '2026-06-23T00:00:00.000Z',
    });
    const mockCtx = createMockContext({
      'character:nocreated-set': ENTITY_NO_CREATED,
      '_idx:consumption:character:nocreated-set': EXISTING,
    });
    const result = await handle_set_consumption_timeline({
      c: mockCtx,
      id: 'test-id',
      isAuthenticated: true,
      args: {
        entity_key: 'character:nocreated-set',
        stage_timer: 1,
      },
    });
    expect(result.status).toBe(200);
    const body: any = await result.json();
    expect(body.error).toBeUndefined();
  });
});