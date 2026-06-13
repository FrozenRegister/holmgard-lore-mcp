import { describe, it, expect, afterAll, vi } from 'vitest';
import { handle_get_topic_histories } from '../../../src/tools/lore';
import { makeResult } from '../../../src/lib/rpc';
import { createMockContext } from '../mocks';

describe('handle_get_topic_histories', () => {
  const mockCtx: any = createMockContext();

  afterAll(() => {
    vi.restoreAllMocks();
  });

  it('returns empty array for missing history', async () => {
    const result = await handle_get_topic_histories({
      c: mockCtx,
      id: 'test-id',
      isAuthenticated: true,
      args: { keys: ['nonexistent'] },
    });
    expect(result.status).toBe(200);
    const body: any = await result.json();
    // The handler returns { jsonrpc: "2.0", id, result: { [key]: [snapshots] } }
    expect(body.result).toEqual({ nonexistent: [] });
  });

  it('handles malformed snapshot gracefully', async () => {
    // Mock kv.get to return invalid JSON
    const kvGetMock = vi.spyOn(mockCtx.env.LORE_DB, 'get').mockImplementation(async (key: any) => {
      if (key === '_history:test-key') {
        return 'invalid-json';
      }
      return null;
    });

    const result = await handle_get_topic_histories({
      c: mockCtx,
      id: 'test-id',
      isAuthenticated: true,
      args: { keys: ['test-key'] },
    });
    expect(result.status).toBe(200);
    const body: any = await result.json();
    // histories for test-key should be empty array because invalid JSON throws
    expect(body.result['test-key']).toEqual([]);
    kvGetMock.mockRestore();
  });

  it('returns histories for valid keys', async () => {
    // Mock successful history retrieval
    const mockJson = JSON.stringify(['{"text":"hist1","meta":{}}', '{"text":"hist2","meta":{}}']);
    vi.spyOn(mockCtx.env.LORE_DB, 'get').mockImplementation(async (key: any) => {
      if (key === '_history:key1' || key === '_history:key2') {
        return mockJson;
      }
      return null;
    });

    const result = await handle_get_topic_histories({
      c: mockCtx,
      id: 'test-id',
      isAuthenticated: true,
      args: { keys: ['key1', 'key2'] },
    });
    expect(result.status).toBe(200);
    const body: any = await result.json();
    expect(body.result.key1).toEqual([
      { text: 'hist1', meta: {} },
      { text: 'hist2', meta: {} },
    ]);
    expect(body.result.key2).toEqual([
      { text: 'hist1', meta: {} },
      { text: 'hist2', meta: {} },
    ]);
    // Restore mock
    (mockCtx.env.LORE_DB.get as ReturnType<typeof vi.fn>).mockRestore();
  });
});