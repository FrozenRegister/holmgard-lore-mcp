import { describe, rpc, callTool, callToolWithApiKey, seedKV, ADMIN_SECRET, parseEncounterTable } from './helpers'
import { SELF, env } from 'cloudflare:test'
import { expect, it, beforeEach } from 'vitest'

describe('sense_environment', () => {
  it('shows all details for high-perception entity', async () => {
    await seedKV('location:cave', 'Stalactites hang overhead.\nA shimmer in the dark [hidden] marks a gem deposit.\nA growl echoes [threat] from the east.')
    await seedKV('character:eagle-eye', '**Perception:** 0.9')
    const res = await callTool('world_manage', { action: 'sense_environment', location_key: 'location:cave', entity_key: 'character:eagle-eye' })
    expect(res.result.perception_score).toBe(0.9)
    expect(res.result.hidden_count).toBe(0)
  })

  it('hides [hidden] lines for low-perception entity', async () => {
    await seedKV('location:cave', 'A shimmer in the dark [hidden] marks a gem deposit.\nStone walls surround you.')
    await seedKV('character:blind-fighter', '**Perception:** 0.3')
    const res = await callTool('world_manage', { action: 'sense_environment', location_key: 'location:cave', entity_key: 'character:blind-fighter' })
    expect(res.result.hidden_count).toBeGreaterThan(0)
  })

  it('accepts entity_name as an alias for entity_key and ignores radius', async () => {
    await seedKV('location:cave', 'Stone walls surround you.')
    await seedKV('character:eagle-eye', '**Perception:** 0.9')
    const res = await callTool('world_manage', { action: 'sense_environment', location_key: 'location:cave', entity_name: 'character:eagle-eye', radius: 'medium' })
    expect(res.error).toBeUndefined()
    expect(res.result.perception_score).toBe(0.9)
  })

  it('rejects invalid params (missing entity_key)', async () => {
    const res = await callTool('world_manage', { action: 'sense_environment', location_key: 'location:cave' })
    expect(res.error).toBeDefined()
    expect(res.error.code).toBe(-32602)
    expect(res.error.data.example).toBeDefined()
  })

  it('returns error when location is not found', async () => {
    await seedKV('character:eagle-eye', '**Perception:** 0.9')
    const res = await callTool('world_manage', { action: 'sense_environment', location_key: 'location:nonexistent-place', entity_key: 'character:eagle-eye' })
    expect(res.error).toBeDefined()
    expect(res.error.code).toBe(-32602)
  })

  it('suggests a similar location key when not found', async () => {
    await seedKV('location:cave-of-wonders', 'A glittering cave.')
    await seedKV('character:eagle-eye', '**Perception:** 0.9')
    const res = await callTool('world_manage', { action: 'sense_environment', location_key: 'cave-of-wonder', entity_key: 'character:eagle-eye' })
    expect(res.error).toBeDefined()
    expect(res.error.data.did_you_mean).toBe('location:cave-of-wonders')
  })

  it('returns error when entity is not found', async () => {
    await seedKV('location:cave', 'Stone walls surround you.')
    const res = await callTool('world_manage', { action: 'sense_environment', location_key: 'location:cave', entity_key: 'character:no-such-scout' })
    expect(res.error).toBeDefined()
    expect(res.error.code).toBe(-32602)
  })

  it('suggests a similar entity key when not found', async () => {
    await seedKV('location:cave', 'Stone walls surround you.')
    await seedKV('character:eagle-eye', '**Perception:** 0.9')
    const res = await callTool('world_manage', { action: 'sense_environment', location_key: 'location:cave', entity_key: 'eagle-ey' })
    expect(res.error).toBeDefined()
    expect(res.error.data.did_you_mean).toBe('character:eagle-eye')
  })
})

describe('get_sensory_profile', () => {
  it('returns direct sensory fields from entity', async () => {
    await seedKV('character:creature', '**Temperature:** warm\n**Scent:** musky\n**Texture:** smooth\n**Sound-Signature:** low growl\n**Visual-Descriptors:** amber eyes')
    const res = await callTool('entity_manage', { action: 'get_sensory_profile', entity_key: 'character:creature' })
    expect(res.result.profile.temperature).toBe('warm')
    expect(res.result.profile.scent).toBe('musky')
    expect(res.result.profile.texture).toBe('smooth')
    expect(res.result.profile.sound_signature).toBe('low growl')
    expect(res.result.profile.visual_descriptors).toBe('amber eyes')
  })

  it('falls back to species lore for missing fields', async () => {
    await seedKV('character:hybrid', '**Species:** species:wolf-base\n**Texture:** scarred')
    await seedKV('species:wolf-base', '**Temperature:** cool\n**Scent:** earthy')
    const res = await callTool('entity_manage', { action: 'get_sensory_profile', entity_key: 'character:hybrid' })
    expect(res.result.profile.texture).toBe('scarred')
    expect(res.result.profile.temperature).toBe('cool')
    expect(res.result.profile.scent).toBe('earthy')
    expect(res.result.species).toBe('species:wolf-base')
  })

  it('returns no-profile message when entity has no sensory fields', async () => {
    await seedKV('character:blank', 'Just a blank character.')
    const res = await callTool('entity_manage', { action: 'get_sensory_profile', entity_key: 'character:blank' })
    expect(res.result.content[0].text).toContain('No sensory profile')
  })

  it('reads sensory fields from loose plain-colon format', async () => {
    // AI may omit **bold:** — loose pass should still find these fields
    await seedKV('character:loose-sensory', 'Sensory-Profile: warm-blooded, elevated cortisol\nTemperature: warm\nScent: cortisol-elevated')
    const res = await callTool('entity_manage', { action: 'get_sensory_profile', entity_key: 'character:loose-sensory' })
    expect(res.result.profile.temperature).toBe('warm')
    expect(res.result.profile.scent).toBe('cortisol-elevated')
  })

  it('decomposes Sensory-Profile composite string into individual profile fields', async () => {
    // Entity has only a composite Sensory-Profile — no discrete Temperature/Scent/etc. fields
    await seedKV('character:composite-sensory', '**Sensory-Profile:** warm-blooded, elevated cortisol, soft-tissue-density')
    const res = await callTool('entity_manage', { action: 'get_sensory_profile', entity_key: 'character:composite-sensory' })
    expect(res.result.sensory_profile_raw).toBe('warm-blooded, elevated cortisol, soft-tissue-density')
    expect(res.result.profile.temperature).toBe('warm-blooded')
    expect(res.result.profile.scent).toBe('elevated cortisol')
    expect(res.result.profile.texture).toBe('soft-tissue-density')
  })
})

describe('get_inventory', () => {
  it('parses Inventory field into structured items', async () => {
    await seedKV('character:merchant', '**Inventory:** sword×3, shield×1, potion×10')
    const res = await callTool('entity_manage', { action: 'get_inventory', entity_key: 'character:merchant' })
    expect(res.result.items).toHaveLength(3)
    const sword = res.result.items.find((i: { item: string }) => i.item === 'sword')
    expect(sword.quantity).toBe(3)
  })

  it('returns empty items when no Inventory field', async () => {
    await seedKV('character:empty-handed', 'No items here.')
    const res = await callTool('entity_manage', { action: 'get_inventory', entity_key: 'character:empty-handed' })
    expect(res.result.items).toHaveLength(0)
    expect(res.result.raw_inventory).toBeNull()
  })

  it('parses line-separated inventory items (#41 fix)', async () => {
    // Inventory format with items on separate lines (not comma-separated)
    await seedKV('character:kavissa', `**Inventory:**
crowmark-seal-ring×1
leather-purse×1
letter-of-credit×1
sandalwood-soap×1`)
    const res = await callTool('entity_manage', { action: 'get_inventory', entity_key: 'character:kavissa' })
    expect(res.result.items).toHaveLength(4)
    const ring = res.result.items.find((i: { item: string }) => i.item === 'crowmark-seal-ring')
    expect(ring).toBeDefined()
    expect(ring.quantity).toBe(1)
  })

  it('stops collecting multi-line items at next bold field header', async () => {
    await seedKV('character:bounded', `**Inventory:**
sword×1
shield×1
**Status:** alive`)
    const res = await callTool('entity_manage', { action: 'get_inventory', entity_key: 'character:bounded' })
    expect(res.result.items).toHaveLength(2)
    expect(res.result.items[0].item).toBe('sword')
    expect(res.result.items[1].item).toBe('shield')
  })

  it('skips blank lines inside multi-line inventory block', async () => {
    await seedKV('character:spaced-items', `**Inventory:**
torch×3

rope×1
`)
    const res = await callTool('entity_manage', { action: 'get_inventory', entity_key: 'character:spaced-items' })
    expect(res.result.items).toHaveLength(2)
    expect(res.result.items[0].item).toBe('torch')
    expect(res.result.items[1].item).toBe('rope')
  })

  it('returns quantity 1 for bare item entries without a quantity marker', async () => {
    await seedKV('character:bare-items', '**Inventory:** mysterious-artifact, old-coin×3')
    const res = await callTool('entity_manage', { action: 'get_inventory', entity_key: 'character:bare-items' })
    expect(res.result.items).toHaveLength(2)
    const artifact = res.result.items.find((i: { item: string }) => i.item === 'mysterious-artifact')
    expect(artifact.quantity).toBe(1)
    const coin = res.result.items.find((i: { item: string }) => i.item === 'old-coin')
    expect(coin.quantity).toBe(3)
  })

  it('falls back to Items field name when Inventory field is absent', async () => {
    await seedKV('character:uses-items-field', '**Items:** lantern×1, rope×2')
    const res = await callTool('entity_manage', { action: 'get_inventory', entity_key: 'character:uses-items-field' })
    expect(res.result.items).toHaveLength(2)
    expect(res.result.items.find((i: { item: string }) => i.item === 'lantern').quantity).toBe(1)
  })
})

describe('transfer_item', () => {
  it('moves item from source to target and updates both entries', async () => {
    await seedKV('character:seller', '**Inventory:** sword×2, shield×1')
    await seedKV('character:buyer', '**Inventory:** gold×50')
    const res = await callTool('entity_manage', { action: 'transfer_item', from_entity: 'character:seller', to_entity: 'character:buyer', item_key: 'sword', quantity: 1 })
    expect(res.result.transferred).toBe(true)
    expect(res.result.metadata.written).toBe(2)
    const seller = await callTool('entity_manage', { action: 'get_inventory', entity_key: 'character:seller' })
    const sellerSword = seller.result.items.find((i: { item: string }) => i.item === 'sword')
    expect(sellerSword.quantity).toBe(1)
    const buyer = await callTool('entity_manage', { action: 'get_inventory', entity_key: 'character:buyer' })
    const buyerSword = buyer.result.items.find((i: { item: string }) => i.item === 'sword')
    expect(buyerSword.quantity).toBe(1)
  })

  it('rejects when source does not have the item', async () => {
    await seedKV('character:empty', '**Inventory:** gold×5')
    await seedKV('character:target', '**Inventory:** gold×1')
    const res = await callTool('entity_manage', { action: 'transfer_item', from_entity: 'character:empty', to_entity: 'character:target', item_key: 'magic-sword', quantity: 1 })
    expect(res.result.transferred).toBe(false)
    expect(res.result.content[0].text).toContain('not found')
  })

  it('rejects when insufficient quantity', async () => {
    await seedKV('character:has-one', '**Inventory:** potion×1')
    await seedKV('character:wants-more', '**Inventory:** gold×5')
    const res = await callTool('entity_manage', { action: 'transfer_item', from_entity: 'character:has-one', to_entity: 'character:wants-more', item_key: 'potion', quantity: 5 })
    expect(res.result.transferred).toBe(false)
    expect(res.result.content[0].text).toContain('Insufficient')
  })

  it('rejects transfer when source entity has no inventory field', async () => {
    await seedKV('character:no-inv', '**Status:** alive')
    await seedKV('character:no-inv-target', '**Inventory:** gold×1')
    const res = await callTool('entity_manage', { action: 'transfer_item', from_entity: 'character:no-inv', to_entity: 'character:no-inv-target', item_key: 'sword', quantity: 1 })
    expect(res.result.transferred).toBe(false)
    expect(res.result.content[0].text).toContain('not found')
  })

  it('transfers item from multi-line inventory source with blank lines', async () => {
    await seedKV('character:multi-seller', `**Inventory:**
dagger×2

torch×5
**Status:** active`)
    await seedKV('character:multi-buyer', '**Items:** gold×10')
    const res = await callTool('entity_manage', { action: 'transfer_item', from_entity: 'character:multi-seller', to_entity: 'character:multi-buyer', item_key: 'dagger', quantity: 1 })
    expect(res.result.transferred).toBe(true)
    const seller = await callTool('entity_manage', { action: 'get_inventory', entity_key: 'character:multi-seller' })
    const dagger = seller.result.items.find((i: { item: string }) => i.item === 'dagger')
    expect(dagger.quantity).toBe(1)
  })
})

describe('get_world_state', () => {
  it('returns zero counts when KV is empty', async () => {
    const res = await callTool('world_manage', { action: 'get_world_state' })
    expect(res.error).toBeUndefined()
    expect(res.result.total_entries).toBe(0)
    expect(res.result.character_count).toBe(0)
    expect(res.result.active_threads).toEqual([])
    expect(res.result.known_locations).toEqual([])
  })

  it('counts characters, threads, and locations from seeded KV', async () => {
    await seedKV('character:alice', '**Thread:** alpha\n**Location:** town:hall')
    await seedKV('character:bob', '**Thread:** beta\n**Location:** town:hall')
    await seedKV('character:nomad', '**Thread:** gamma')
    await seedKV('setup:guard-post', '**Location:** town:gate')
    const res = await callTool('world_manage', { action: 'get_world_state' })
    expect(res.error).toBeUndefined()
    expect(res.result.total_entries).toBe(4)
    expect(res.result.character_count).toBe(3)
    expect(res.result.active_threads).toHaveLength(3)
    expect(res.result.known_locations).toContain('town:hall')
  })
})
