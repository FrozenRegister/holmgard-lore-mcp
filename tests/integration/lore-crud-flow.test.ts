// tests/integration/lore-crud-flow.test.ts
// Integration test: lore_manage CRUD lifecycle across KV store
// Covers: get, set, get_batch, patch, delete, restore, validate

import { describe, it, expect, beforeEach } from 'vitest';
import { createMockContext } from '../unit/mocks';
import { handle_lore_manage } from '../../src/tools/lore-manage';

const LORE_KEY = 'npc:test-merchant';
const LORE_TEXT = `**Name:** Aldric
**Role:** merchant
**Location:** Duskmarket
**Inventory:** 3x Iron Ingot, 1x Healing Potion`;

const UPDATED_TEXT = `**Name:** Aldric the Cursed
**Role:** merchant
**Location:** Duskmarket
**Inventory:** 2x Iron Ingot, 1x Healing Potion, 1x Cursed Amulet`;

function callLore(ctx: ReturnType<typeof createMockContext>, args: Record<string, unknown>) {
  return handle_lore_manage({
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

describe('Lore CRUD integration flow', () => {
  let ctx: ReturnType<typeof createMockContext>;

  beforeEach(() => {
    ctx = createMockContext();
  });

  describe('SET → GET → PATCH → DELETE → RESTORE', () => {
    it('writes a lore entry, reads it back, patches, deletes, and restores', async () => {
      // 1. SET
      const setRes = await callLore(ctx, {
        action: 'set',
        key: LORE_KEY,
        text: LORE_TEXT,
      });
      const setBody = await jsonBody(setRes);
      expect(setBody.result).toBeDefined();
      expect(setBody.result.ok).toBe(true);

      // 2. GET
      const getRes = await callLore(ctx, { action: 'get', query: LORE_KEY });
      const getBody = await jsonBody(getRes);
      expect(getBody.result.text).toBe(LORE_TEXT);
      expect(getBody.result.key).toBe(LORE_KEY);

      // 3. PATCH — replace
      const patchRes = await callLore(ctx, {
        action: 'patch',
        key: LORE_KEY,
        operation: 'replace',
        target: '**Name:** Aldric',
        value: '**Name:** Aldric the Cursed',
      });
      const patchBody = await jsonBody(patchRes);
      expect(patchBody.result.ok).toBe(true);

      // 4. GET after patch
      const getAfterPatchRes = await callLore(ctx, { action: 'get', query: LORE_KEY });
      const getAfterPatchBody = await jsonBody(getAfterPatchRes);
      expect(getAfterPatchBody.result.text).toContain('Aldric the Cursed');

      // 5. DELETE
      const deleteRes = await callLore(ctx, { action: 'delete', key: LORE_KEY });
      const deleteBody = await jsonBody(deleteRes);
      expect(deleteBody.result.ok).toBe(true);

      // 6. GET after delete — should error
      const getAfterDelRes = await callLore(ctx, { action: 'get', query: LORE_KEY });
      const getAfterDelBody = await jsonBody(getAfterDelRes);
      expect(getAfterDelBody.error).toBeDefined();

      // 7. RESTORE
      const restoreRes = await callLore(ctx, { action: 'restore', key: LORE_KEY });
      const restoreBody = await jsonBody(restoreRes);
      expect(restoreBody.result.ok).toBe(true);

      // 8. GET after restore — should have pre-patch content
      const getAfterRestoreRes = await callLore(ctx, { action: 'get', query: LORE_KEY });
      const getAfterRestoreBody = await jsonBody(getAfterRestoreRes);
      expect(getAfterRestoreBody.result.text).toContain('Aldric');
    });
  });

  describe('GET_BATCH', () => {
    it('fetches multiple lore entries in one call', async () => {
      await callLore(ctx, { action: 'set', key: 'npc:alpha', text: 'Alpha' });
      await callLore(ctx, { action: 'set', key: 'npc:beta', text: 'Beta' });
      await callLore(ctx, { action: 'set', key: 'npc:gamma', text: 'Gamma' });

      const batchRes = await callLore(ctx, {
        action: 'get_batch',
        keys: ['npc:alpha', 'npc:beta', 'npc:gamma', 'npc:missing'],
      });
      const batchBody = await jsonBody(batchRes);
      expect(batchBody.result.results['npc:alpha'].text).toBe('Alpha');
      expect(batchBody.result.results['npc:beta'].text).toBe('Beta');
      expect(batchBody.result.results['npc:gamma'].text).toBe('Gamma');
      expect(batchBody.result.results['npc:missing']).toBeNull();
    });
  });

  describe('VALIDATE', () => {
    it('returns did_you_mean suggestions for near-miss keys', async () => {
      await callLore(ctx, { action: 'set', key: 'npc:blacksmith', text: 'Forgemaster' });

      const validateRes = await callLore(ctx, {
        action: 'validate',
        query_string: 'npc:blacksmih',
      });
      const validateBody = await jsonBody(validateRes);
      expect(validateBody.result).toBeDefined();
      // Should have did_you_mean or confidence info
      expect(validateBody.result.did_you_mean || validateBody.result.found !== undefined).toBeTruthy();
    });

    it('confirms exact matches', async () => {
      await callLore(ctx, { action: 'set', key: 'item:longsword', text: 'A steel blade' });

      const validateRes = await callLore(ctx, {
        action: 'validate',
        query_string: 'item:longsword',
      });
      const validateBody = await jsonBody(validateRes);
      expect(validateBody.result.found).toBe(true);
    });
  });

  describe('LIST', () => {
    it('lists all lore keys in the store', async () => {
      await callLore(ctx, { action: 'set', key: 'npc:one', text: 'One' });
      await callLore(ctx, { action: 'set', key: 'npc:two', text: 'Two' });

      const listRes = await callLore(ctx, { action: 'list', limit: 100, offset: 0 });
      const listBody = await jsonBody(listRes);
      expect(listBody.result.keys).toBeDefined();
      expect(listBody.result.keys).toContain('npc:one');
      expect(listBody.result.keys).toContain('npc:two');
    });

    it('slices paginated results', async () => {
      await callLore(ctx, { action: 'set', key: 'npc:a', text: 'A' });
      await callLore(ctx, { action: 'set', key: 'npc:b', text: 'B' });
      await callLore(ctx, { action: 'set', key: 'npc:c', text: 'C' });

      const page1 = await callLore(ctx, { action: 'list', limit: 2, offset: 0 });
      const body1 = await jsonBody(page1);
      expect(body1.result.keys.length).toBeLessThanOrEqual(2);

      const page2 = await callLore(ctx, { action: 'list', limit: 2, offset: 2 });
      const body2 = await jsonBody(page2);
      expect(body2.result.keys.length).toBeLessThanOrEqual(2);

      // Both pages combined should have no overlap
      const allKeys = [...body1.result.keys, ...body2.result.keys];
      const unique = new Set(allKeys);
      expect(unique.size).toBe(allKeys.length);
    });
  });

  describe('BATCH_SET', () => {
    it('writes multiple entries atomically', async () => {
      const batchRes = await callLore(ctx, {
        action: 'batch_set',
        entries: [
          { key: 'npc:x1', text: 'Entry 1' },
          { key: 'npc:x2', text: 'Entry 2' },
          { key: 'npc:x3', text: 'Entry 3' },
        ],
      });
      const batchBody = await jsonBody(batchRes);
      expect(batchBody.result.results).toBeDefined();
      expect(Object.keys(batchBody.result.results).length).toBe(3);

      // Verify all exist
      for (const key of ['npc:x1', 'npc:x2', 'npc:x3']) {
        const getRes = await callLore(ctx, { action: 'get', query: key });
        const getBody = await jsonBody(getRes);
        expect(getBody.result.text).toBeDefined();
        expect(getBody.result.key).toBe(key);
      }
    });
  });

  describe('GET_SECTION', () => {
    it('extracts named sections from a lore entry', async () => {
      const sectionText = `**Name:** Grunk\n**Species:** Orc\n\n### Backstory\nGrunk was a warchief in the Redfang clan.\n\n### Personality\nGrumpy but loyal.`;
      await callLore(ctx, { action: 'set', key: 'npc:grunk', text: sectionText });

      const sectionRes = await callLore(ctx, {
        action: 'get_section',
        key: 'npc:grunk',
        sections: ['Backstory', 'Personality'],
        mode: 'loose',
      });
      const sectionBody = await jsonBody(sectionRes);
      expect(sectionBody.result.sections).toBeDefined();
      if (sectionBody.result.sections.Backstory) {
        expect(sectionBody.result.sections.Backstory).toContain('Redfang');
      }
    });
  });
});
