import { describe, it, expect } from 'vitest';
import entityReads from '../../../src/api/entity-reads';

// Minimal D1 mock — returns pre-seeded rows for .all()
function createMockD1(rows: Record<string, unknown[]> = {}) {
  return {
    prepare: (sql: string) => {
      const tableMatch = sql.match(/FROM\s+(\w+)/i);
      const table = tableMatch?.[1] ?? '';
      const data = rows[table] ?? [];
      return {
        all: async () => ({ results: data }),
        first: async () => data[0] ?? null,
        run: async () => ({ success: true, meta: {} }),
        bind: function (..._args: unknown[]) { return this; },
      };
    },
  };
}

const TEST_ADMIN_SECRET = 'test-secret-123'; // must match vitest.config.ts bindings

// Build an env object. Always includes ADMIN_SECRET so PATCH auth works.
// Passing a truthy RPG_DB mock overrides the miniflare binding for that request.
function makeEnv(db: unknown, adminSecret = TEST_ADMIN_SECRET) {
  return { RPG_DB: db, ADMIN_SECRET: adminSecret } as any;
}

// Env with an empty mock D1 for PATCH tests that just need auth + validation
function makeAdminEnv(wrongSecret = false) {
  return makeEnv(createMockD1({}), wrongSecret ? 'wrong' : TEST_ADMIN_SECRET);
}

function makeRequest(path: string) {
  return new Request(`http://localhost${path}`);
}

// ── Characters ────────────────────────────────────────────────────────────────

describe('GET /characters', () => {
  it('returns characters list with total', async () => {
    const db = createMockD1({
      characters: [
        { id: 'c1', name: 'Aldric', character_type: 'pc', character_class: 'fighter',
          race: 'Human', level: 5, hp: 42, max_hp: 60, faction_id: null, kv_origin: 'character:aldric' },
      ],
    });
    const res = await entityReads.request(makeRequest('/characters'), undefined, makeEnv(db));
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.characters).toHaveLength(1);
    expect(body.characters[0].name).toBe('Aldric');
    expect(body.total).toBe(1);
  });

  it('returns empty list when no characters exist', async () => {
    const db = createMockD1({ characters: [] });
    const res = await entityReads.request(makeRequest('/characters'), undefined, makeEnv(db));
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.characters).toHaveLength(0);
    expect(body.total).toBe(0);
  });

  it('normalises missing fields to defaults', async () => {
    const db = createMockD1({
      characters: [{ id: 'c2' }],
    });
    const res = await entityReads.request(makeRequest('/characters'), undefined, makeEnv(db));
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    const char = body.characters[0];
    expect(char.name).toBe('Unknown');
    expect(char.character_type).toBe('npc');
    expect(char.level).toBe(1);
    expect(char.kv_origin).toBeNull();
  });

  it('returns 500 when query throws', async () => {
    const db = { prepare: () => ({ all: async () => { throw new Error('D1 boom'); } }) };
    const res = await entityReads.request(makeRequest('/characters'), undefined, makeEnv(db));
    expect(res.status).toBe(500);
    const body = await res.json() as any;
    expect(body.error).toContain('D1 boom');
  });
});

// ── GET /characters/:id ───────────────────────────────────────────────────────

describe('GET /characters/:id', () => {
  it('returns a single character by id', async () => {
    const db = createMockD1({
      characters: [
        { id: 'abc-123', name: 'Aldric', character_type: 'pc', character_class: 'fighter',
          race: 'Human', level: 5, hp: 42, max_hp: 60, ac: 16,
          alignment: 'Neutral Good', background: 'Soldier',
          faction_id: null, kv_origin: 'character:aldric' },
      ],
    });
    const res = await entityReads.request(makeRequest('/characters/abc-123'), undefined, makeEnv(db));
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.character.name).toBe('Aldric');
    expect(body.character.ac).toBe(16);
    expect(body.character.alignment).toBe('Neutral Good');
    expect(body.character.background).toBe('Soldier');
  });

  it('returns 404 when character not found', async () => {
    const db = createMockD1({ characters: [] });
    const res = await entityReads.request(makeRequest('/characters/missing-id'), undefined, makeEnv(db));
    expect(res.status).toBe(404);
    const body = await res.json() as any;
    expect(body.error).toBe('Not found');
  });

  it('normalises missing optional fields', async () => {
    const db = createMockD1({ characters: [{ id: 'x1', name: 'Unknown' }] });
    const res = await entityReads.request(makeRequest('/characters/x1'), undefined, makeEnv(db));
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.character.ac).toBe(10);
    expect(body.character.alignment).toBeNull();
    expect(body.character.background).toBeNull();
  });

  it('normalises a partially populated row, preserving present fields', async () => {
    const db = createMockD1({
      characters: [{ id: 'p1', name: 'Partial', level: 7, hp: null, max_hp: null, ac: null }],
    });
    const res = await entityReads.request(makeRequest('/characters/p1'), undefined, makeEnv(db));
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.character.level).toBe(7);   // present — preserved
    expect(body.character.hp).toBe(0);       // null → default 0
    expect(body.character.max_hp).toBe(0);
    expect(body.character.ac).toBe(10);      // null → default 10
  });
});

// ── PATCH /characters/:id ─────────────────────────────────────────────────────
// These tests use the miniflare-provided env (no custom env override) so that
// c.env.ADMIN_SECRET = 'test-secret-123' (from vitest.config.ts bindings) and
// c.env.RPG_DB = the empty local miniflare D1 (fine for write ops).

describe('PATCH /characters/:id', () => {
  it('returns 401 without admin secret header', async () => {
    const res = await entityReads.request(
      new Request('http://localhost/characters/c1', {
        method: 'PATCH',
        body: JSON.stringify({ level: 6 }),
        headers: { 'Content-Type': 'application/json' },
      }),
      undefined,
      makeAdminEnv(),
    );
    expect(res.status).toBe(401);
  });

  it('returns 401 with wrong admin secret', async () => {
    const res = await entityReads.request(
      new Request('http://localhost/characters/c1', {
        method: 'PATCH',
        body: JSON.stringify({ level: 6 }),
        headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': 'wrong-secret' },
      }),
      undefined,
      makeAdminEnv(),
    );
    expect(res.status).toBe(401);
  });

  it('returns 400 when only non-patchable fields provided', async () => {
    const res = await entityReads.request(
      new Request('http://localhost/characters/c1', {
        method: 'PATCH',
        body: JSON.stringify({ kv_origin: 'should-be-blocked', id: 'tamper' }),
        headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': TEST_ADMIN_SECRET },
      }),
      undefined,
      makeAdminEnv(),
    );
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toContain('No patchable fields');
  });

  it('returns 200 for valid patch with correct secret', async () => {
    const res = await entityReads.request(
      new Request('http://localhost/characters/c1', {
        method: 'PATCH',
        body: JSON.stringify({ level: 6, hp: 50, max_hp: 65, ac: 17 }),
        headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': TEST_ADMIN_SECRET },
      }),
      undefined,
      makeAdminEnv(),
    );
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.ok).toBe(true);
  });

  it('returns 400 for malformed JSON body', async () => {
    const res = await entityReads.request(
      new Request('http://localhost/characters/c1', {
        method: 'PATCH',
        body: 'not-json',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': TEST_ADMIN_SECRET },
      }),
      undefined,
      makeAdminEnv(),
    );
    expect(res.status).toBe(400);
  });

  it('returns 200 when only a single patchable field is provided', async () => {
    const res = await entityReads.request(
      new Request('http://localhost/characters/c1', {
        method: 'PATCH',
        body: JSON.stringify({ level: 9 }),
        headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': TEST_ADMIN_SECRET },
      }),
      undefined,
      makeAdminEnv(),
    );
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.ok).toBe(true);
  });

  it('accepts X-Api-Key as a fallback auth header', async () => {
    const res = await entityReads.request(
      new Request('http://localhost/characters/c1', {
        method: 'PATCH',
        body: JSON.stringify({ level: 4 }),
        headers: { 'Content-Type': 'application/json', 'X-Api-Key': TEST_ADMIN_SECRET },
      }),
      undefined,
      makeAdminEnv(),
    );
    expect(res.status).toBe(200);
  });

  it('returns 200 for a non-existent character id (no affected-rows check)', async () => {
    // UPDATE silently affects 0 rows; the endpoint does not validate meta.changes
    const res = await entityReads.request(
      new Request('http://localhost/characters/does-not-exist', {
        method: 'PATCH',
        body: JSON.stringify({ level: 5 }),
        headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': TEST_ADMIN_SECRET },
      }),
      undefined,
      makeAdminEnv(),
    );
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.ok).toBe(true);
  });

  it('silently drops non-patchable fields when mixed with patchable ones', async () => {
    // id and kv_origin are blocked by PATCHABLE_FIELDS; level is allowed — should succeed
    const res = await entityReads.request(
      new Request('http://localhost/characters/c1', {
        method: 'PATCH',
        body: JSON.stringify({ id: 'hack-attempt', kv_origin: 'tamper', level: 3 }),
        headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': TEST_ADMIN_SECRET },
      }),
      undefined,
      makeAdminEnv(),
    );
    expect(res.status).toBe(200);
  });

  it('returns 503 when RPG_DB is unavailable', async () => {
    const res = await entityReads.request(
      new Request('http://localhost/characters/c1', {
        method: 'PATCH',
        body: JSON.stringify({ level: 6 }),
        headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': TEST_ADMIN_SECRET },
      }),
      undefined,
      makeEnv(null),
    );
    expect(res.status).toBe(503);
  });

  it('returns 500 when the UPDATE query throws', async () => {
    const throwingDb = {
      prepare: () => ({
        run: async () => { throw new Error('D1 update fail'); },
        bind: function () { return this as any; },
      }),
    };
    const res = await entityReads.request(
      new Request('http://localhost/characters/c1', {
        method: 'PATCH',
        body: JSON.stringify({ level: 6 }),
        headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': TEST_ADMIN_SECRET },
      }),
      undefined,
      makeEnv(throwingDb),
    );
    expect(res.status).toBe(500);
    const body = await res.json() as any;
    expect(body.error).toContain('D1 update fail');
  });
});

// ── GET /characters/:id — error paths ─────────────────────────────────────────

describe('GET /characters/:id — error paths', () => {
  it('returns 503 when RPG_DB is unavailable', async () => {
    const res = await entityReads.request(makeRequest('/characters/x'), undefined, makeEnv(null));
    expect(res.status).toBe(503);
  });

  it('returns 500 when query throws', async () => {
    const db = {
      prepare: () => ({
        first: async () => { throw new Error('D1 fail'); },
        bind: function () { return this as any; },
      }),
    };
    const res = await entityReads.request(makeRequest('/characters/x'), undefined, makeEnv(db));
    expect(res.status).toBe(500);
    const body = await res.json() as any;
    expect(body.error).toContain('D1 fail');
  });
});

// ── Locations ─────────────────────────────────────────────────────────────────

describe('GET /locations', () => {
  it('returns locations list', async () => {
    const db = createMockD1({
      room_nodes: [
        { id: 'r1', name: 'Eastgate', biome_context: 'urban', visited_count: 3, last_visited_at: null },
      ],
    });
    const res = await entityReads.request(makeRequest('/locations'), undefined, makeEnv(db));
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.locations[0].name).toBe('Eastgate');
    expect(body.total).toBe(1);
  });

  it('returns empty list when no locations exist', async () => {
    const db = createMockD1({ room_nodes: [] });
    const res = await entityReads.request(makeRequest('/locations'), undefined, makeEnv(db));
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.locations).toHaveLength(0);
  });

  it('normalises null biome_context and zero visited_count', async () => {
    const db = createMockD1({ room_nodes: [{ id: 'r2', name: 'Void' }] });
    const res = await entityReads.request(makeRequest('/locations'), undefined, makeEnv(db));
    const body = await res.json() as any;
    expect(body.locations[0].biome_context).toBeNull();
    expect(body.locations[0].visited_count).toBe(0);
  });
});

// ── Nations ───────────────────────────────────────────────────────────────────

describe('GET /nations', () => {
  it('returns nations list', async () => {
    const db = createMockD1({
      nations: [{ id: 'n1', name: 'Holmgard', leader: 'King Ulf', ideology: 'monarchy',
        aggression: 30, trust: 70, paranoia: 20, gdp: 5000 }],
    });
    const res = await entityReads.request(makeRequest('/nations'), undefined, makeEnv(db));
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.nations[0].leader).toBe('King Ulf');
    expect(body.total).toBe(1);
  });

  it('returns empty list when no nations exist', async () => {
    const db = createMockD1({ nations: [] });
    const res = await entityReads.request(makeRequest('/nations'), undefined, makeEnv(db));
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.nations).toHaveLength(0);
  });

  it('normalises missing numeric fields to defaults', async () => {
    const db = createMockD1({ nations: [{ id: 'n2', name: 'Anon' }] });
    const res = await entityReads.request(makeRequest('/nations'), undefined, makeEnv(db));
    const body = await res.json() as any;
    expect(body.nations[0].aggression).toBe(50);
    expect(body.nations[0].gdp).toBe(0);
  });
});

// ── Regions ───────────────────────────────────────────────────────────────────

describe('GET /regions', () => {
  it('returns regions list', async () => {
    const db = createMockD1({
      regions: [{ id: 'reg1', name: 'Northern Reaches', type: 'wilderness', owner_nation_id: 'n1' }],
    });
    const res = await entityReads.request(makeRequest('/regions'), undefined, makeEnv(db));
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.regions[0].name).toBe('Northern Reaches');
  });

  it('returns empty list when no regions exist', async () => {
    const db = createMockD1({ regions: [] });
    const res = await entityReads.request(makeRequest('/regions'), undefined, makeEnv(db));
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.regions).toHaveLength(0);
  });

  it('normalises null owner_nation_id', async () => {
    const db = createMockD1({ regions: [{ id: 'reg2', name: 'Wild' }] });
    const res = await entityReads.request(makeRequest('/regions'), undefined, makeEnv(db));
    const body = await res.json() as any;
    expect(body.regions[0].owner_nation_id).toBeNull();
  });
});

// ── Quests ────────────────────────────────────────────────────────────────────

describe('GET /quests', () => {
  it('returns quests list', async () => {
    const db = createMockD1({
      quests: [{ id: 'q1', name: 'The Lost Sword', description: 'Find it.', status: 'active', giver: 'Aldric' }],
    });
    const res = await entityReads.request(makeRequest('/quests'), undefined, makeEnv(db));
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.quests[0].name).toBe('The Lost Sword');
    expect(body.total).toBe(1);
  });

  it('returns empty list when no quests exist', async () => {
    const db = createMockD1({ quests: [] });
    const res = await entityReads.request(makeRequest('/quests'), undefined, makeEnv(db));
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.quests).toHaveLength(0);
  });

  it('normalises null giver and empty status', async () => {
    const db = createMockD1({ quests: [{ id: 'q2', name: 'Unknown Quest' }] });
    const res = await entityReads.request(makeRequest('/quests'), undefined, makeEnv(db));
    const body = await res.json() as any;
    expect(body.quests[0].giver).toBeNull();
    expect(body.quests[0].status).toBe('');
  });
});

// ── Items ─────────────────────────────────────────────────────────────────────

describe('GET /items', () => {
  it('returns items list', async () => {
    const db = createMockD1({
      items: [{ id: 'i1', name: 'Iron Crown', type: 'artifact', value: 5000, weight: 2 }],
    });
    const res = await entityReads.request(makeRequest('/items'), undefined, makeEnv(db));
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.items[0].name).toBe('Iron Crown');
    expect(body.total).toBe(1);
  });

  it('returns empty list when no items exist', async () => {
    const db = createMockD1({ items: [] });
    const res = await entityReads.request(makeRequest('/items'), undefined, makeEnv(db));
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.items).toHaveLength(0);
  });

  it('normalises missing value and weight to 0', async () => {
    const db = createMockD1({ items: [{ id: 'i2', name: 'Mystery Box' }] });
    const res = await entityReads.request(makeRequest('/items'), undefined, makeEnv(db));
    const body = await res.json() as any;
    expect(body.items[0].value).toBe(0);
    expect(body.items[0].weight).toBe(0);
  });
});

// ── GET /characters/:id/relationships ─────────────────────────────────────────

describe('GET /characters/:id/relationships', () => {
  it('returns npc_relationships and party_members', async () => {
    const db = createMockD1({
      npc_relationships: [
        { target_id: 'c2', target_name: 'Elara', target_type: 'pc', target_kv_origin: 'character:elara',
          familiarity: 'friend', disposition: 'friendly', interaction_count: 7, last_interaction_at: '2026-01-01' },
      ],
      party_members: [
        { character_id: 'c3', name: 'Borgil', character_type: 'npc', kv_origin: null,
          role: 'member', party_id: 'p1', party_name: 'The Wanderers' },
      ],
    });
    const res = await entityReads.request(makeRequest('/characters/c1/relationships'), undefined, makeEnv(db));
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.npc_relationships).toHaveLength(1);
    expect(body.npc_relationships[0].target_name).toBe('Elara');
    expect(body.npc_relationships[0].familiarity).toBe('friend');
    expect(body.npc_relationships[0].disposition).toBe('friendly');
    expect(body.npc_relationships[0].interaction_count).toBe(7);
    expect(body.npc_relationships[0].target_kv_origin).toBe('character:elara');
    expect(body.party_members).toHaveLength(1);
    expect(body.party_members[0].name).toBe('Borgil');
    expect(body.party_members[0].role).toBe('member');
    expect(body.party_members[0].party_name).toBe('The Wanderers');
  });

  it('returns empty arrays when character has no relationships or party', async () => {
    const db = createMockD1({ npc_relationships: [], party_members: [] });
    const res = await entityReads.request(makeRequest('/characters/c1/relationships'), undefined, makeEnv(db));
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.npc_relationships).toHaveLength(0);
    expect(body.party_members).toHaveLength(0);
  });

  it('normalises missing relationship fields to defaults', async () => {
    const db = createMockD1({
      npc_relationships: [{ target_id: 'c9' }],
      party_members: [],
    });
    const res = await entityReads.request(makeRequest('/characters/c1/relationships'), undefined, makeEnv(db));
    const body = await res.json() as any;
    const rel = body.npc_relationships[0];
    expect(rel.target_name).toBe('Unknown');
    expect(rel.familiarity).toBe('stranger');
    expect(rel.disposition).toBe('neutral');
    expect(rel.interaction_count).toBe(0);
    expect(rel.target_kv_origin).toBeNull();
    expect(rel.last_interaction_at).toBeNull();
  });

  it('returns 500 when query throws', async () => {
    const db = { prepare: () => ({ all: async () => { throw new Error('D1 rel fail'); }, bind: function() { return this; } }) };
    const res = await entityReads.request(makeRequest('/characters/c1/relationships'), undefined, makeEnv(db));
    expect(res.status).toBe(500);
    const body = await res.json() as any;
    expect(body.error).toContain('D1 rel fail');
  });
});

// ── GET /characters/:id/inventory ─────────────────────────────────────────────

describe('GET /characters/:id/inventory', () => {
  it('returns inventory items with equipped and slot', async () => {
    const db = createMockD1({
      inventory_items: [
        { item_id: 'i1', name: 'Iron Sword', type: 'weapon', quantity: 1, equipped: 1, slot: 'main_hand', value: 50, weight: 5 },
        { item_id: 'i2', name: 'Health Potion', type: 'consumable', quantity: 3, equipped: 0, slot: null, value: 25, weight: 0 },
      ],
    });
    const res = await entityReads.request(makeRequest('/characters/c1/inventory'), undefined, makeEnv(db));
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.items).toHaveLength(2);
    expect(body.total).toBe(2);
    expect(body.items[0].name).toBe('Iron Sword');
    expect(body.items[0].equipped).toBe(true);
    expect(body.items[0].slot).toBe('main_hand');
    expect(body.items[0].quantity).toBe(1);
    expect(body.items[1].name).toBe('Health Potion');
    expect(body.items[1].equipped).toBe(false);
    expect(body.items[1].slot).toBeNull();
    expect(body.items[1].quantity).toBe(3);
  });

  it('returns empty items list when character has no inventory', async () => {
    const db = createMockD1({ inventory_items: [] });
    const res = await entityReads.request(makeRequest('/characters/c1/inventory'), undefined, makeEnv(db));
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.items).toHaveLength(0);
    expect(body.total).toBe(0);
  });

  it('normalises missing inventory fields to defaults', async () => {
    const db = createMockD1({ inventory_items: [{ item_id: 'i9' }] });
    const res = await entityReads.request(makeRequest('/characters/c1/inventory'), undefined, makeEnv(db));
    const body = await res.json() as any;
    const item = body.items[0];
    expect(item.name).toBe('Unknown');
    expect(item.type).toBe('');
    expect(item.quantity).toBe(1);
    expect(item.equipped).toBe(false);
    expect(item.slot).toBeNull();
    expect(item.value).toBe(0);
    expect(item.weight).toBe(0);
  });

  it('returns 500 when query throws', async () => {
    const db = { prepare: () => ({ all: async () => { throw new Error('D1 inv fail'); }, bind: function() { return this; } }) };
    const res = await entityReads.request(makeRequest('/characters/c1/inventory'), undefined, makeEnv(db));
    expect(res.status).toBe(500);
    const body = await res.json() as any;
    expect(body.error).toContain('D1 inv fail');
  });
});
