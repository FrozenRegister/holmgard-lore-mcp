import { describe, it, expect, afterAll, vi } from 'vitest';
import { handle_resolve_interaction } from '../../../src/tools/entity';
import { createMockContext } from '../mocks';

/**
 * Pre-seeded entity data for tests that need existing entities.
 * Format matches the JSON blob stored in KV: { text, meta }.
 * The Weight-1 / Weight-2 fields use markdown bold format so
 * extractFieldFromText can parse them.
 */
const HAS_WEIGHT_A = JSON.stringify({
  text: '**Weight-1:** 0.8\n**State-Level:** 0',
  meta: { version: 1 },
});
const HAS_WEIGHT_B = JSON.stringify({
  text: '**Weight-2:** 0.2\n**State-Level:** 0',
  meta: { version: 1 },
});
const NO_WEIGHT_1 = JSON.stringify({
  text: '**Weight-2:** 0.2\n**State-Level:** 0',
  meta: { version: 1 },
});
const NO_WEIGHT_2 = JSON.stringify({
  text: '**Weight-1:** 0.8\n**State-Level:** 0',
  meta: { version: 1 },
});

describe('handle_resolve_interaction', () => {
  afterAll(() => {
    vi.restoreAllMocks();
  });

  it('returns structured error when entity A not found', async () => {
    const mockCtx = createMockContext();
    const result = await handle_resolve_interaction({
      c: mockCtx,
      id: 'test-id',
      isAuthenticated: true,
      args: {
        entity_a_id: 'nonexistent:entity-xyz',
        entity_b_id: 'character:valid',
        action_type: 'test',
      },
    });
    expect(result.status).toBe(200);
    const body: any = await result.json();
    expect(body.error.message).toContain('Entity "nonexistent:entity-xyz" not found');
  });

  it('returns structured error when entity B not found', async () => {
    const mockCtx = createMockContext({
      'character:valid': HAS_WEIGHT_A,
    });
    const result = await handle_resolve_interaction({
      c: mockCtx,
      id: 'test-id',
      isAuthenticated: true,
      args: {
        entity_a_id: 'character:valid',
        entity_b_id: 'nonexistent:entity-xyz',
        action_type: 'test',
      },
    });
    expect(result.status).toBe(200);
    const body: any = await result.json();
    expect(body.error.message).toContain('Entity "nonexistent:entity-xyz" not found');
  });

  it('handles missing Weight-1 field gracefully', async () => {
    const mockCtx = createMockContext({
      'character:missing-weight-1': NO_WEIGHT_1,
      'character:has-weight': HAS_WEIGHT_B,
    });
    const result = await handle_resolve_interaction({
      c: mockCtx,
      id: 'test-id',
      isAuthenticated: true,
      args: {
        entity_a_id: 'character:missing-weight-1',
        entity_b_id: 'character:has-weight',
        action_type: 'test',
      },
    });
    expect(result.status).toBe(200);
    const body: any = await result.json();
    expect(body.error.message).toContain('missing numeric **Weight-1:** field');
  });

  it('handles missing Weight-2 field gracefully', async () => {
    const mockCtx = createMockContext({
      'character:has-weight': HAS_WEIGHT_A,
      'character:missing-weight-2': NO_WEIGHT_2,
    });
    const result = await handle_resolve_interaction({
      c: mockCtx,
      id: 'test-id',
      isAuthenticated: true,
      args: {
        entity_a_id: 'character:has-weight',
        entity_b_id: 'character:missing-weight-2',
        action_type: 'test',
      },
    });
    expect(result.status).toBe(200);
    const body: any = await result.json();
    expect(body.error.message).toContain('missing numeric **Weight-2:** field');
  });
});