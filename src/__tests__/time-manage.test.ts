// Direct handler tests for time-manage
import { describe } from './helpers'
import { env } from 'cloudflare:test'
import { expect, it, beforeEach } from 'vitest'
import { setupRpgDb } from './setup-d1'
import { handleTimeManage } from '../rpg/handlers/time-manage'

describe('handleTimeManage', () => {
  beforeEach(async () => {
    await setupRpgDb(env.RPG_DB)
  })

  const db = () => ({ RPG_DB: env.RPG_DB } as any)
  const now = new Date().toISOString()

  async function seedWorld(worldId: string, date: string, era: string | null = null) {
    await env.RPG_DB.prepare(
      `INSERT OR IGNORE INTO worlds (id, name, seed, width, height, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(worldId, worldId, 'seed', 10, 10, now, now).run()
    await env.RPG_DB.prepare(
      `INSERT OR REPLACE INTO world_state (world_id, current_date, era) VALUES (?, ?, ?)`
    ).bind(worldId, date, era).run()
  }

  async function seedChar(id: string, born: string | null = null) {
    await env.RPG_DB.prepare(
      `INSERT OR IGNORE INTO characters (id, name, stats, hp, max_hp, ac, level, character_type, character_class, race, conditions, resistances, vulnerabilities, immunities, known_spells, prepared_spells, cantrips_known, currency, resource_pools, xp, born, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(id, id, '{}', 10, 10, 10, 1, 'pc', 'Fighter', 'Human', '[]', '[]', '[]', '[]', '[]', '[]', '[]', '{}', '{}', 0, born, now, now).run()
  }

  // ── Unknown action ────────────────────────────────────────────────────────

  it('returns guiding error for unknown action', async () => {
    const r = await handleTimeManage(db(), { action: 'zap_world' })
    expect(r.content[0].text).toContain('zap_world')
  })

  // ── set_date ──────────────────────────────────────────────────────────────

  it('set_date requires world_id', async () => {
    const r = await handleTimeManage(db(), { action: 'set_date', date: '2184-01-01' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('set_date requires date', async () => {
    const r = await handleTimeManage(db(), { action: 'set_date', world_id: 'w1' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('set_date creates a new world_state row', async () => {
    await env.RPG_DB.prepare(
      `INSERT OR IGNORE INTO worlds (id, name, seed, width, height, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind('w1', 'World 1', 'seed', 10, 10, now, now).run()

    const r = await handleTimeManage(db(), { action: 'set_date', world_id: 'w1', date: '2184-07-15', era: 'Age of Collapse' })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.current_date).toBe('2184-07-15')
    expect(body.era).toBe('Age of Collapse')
  })

  it('set_date updates existing world_state', async () => {
    await seedWorld('w2', '2184-01-01', 'Old Era')
    const r = await handleTimeManage(db(), { action: 'set_date', world_id: 'w2', date: '2185-06-01' })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.current_date).toBe('2185-06-01')
    expect(body.era).toBe('Old Era') // era preserved when not supplied
  })

  it('set_date updates era when supplied', async () => {
    await seedWorld('w3', '2184-01-01', 'Old Era')
    const r = await handleTimeManage(db(), { action: 'set_date', world_id: 'w3', date: '2185-01-01', era: 'New Era' })
    const body = JSON.parse(r.content[0].text)
    expect(body.era).toBe('New Era')
  })

  // ── get_date ──────────────────────────────────────────────────────────────

  it('get_date requires world_id', async () => {
    const r = await handleTimeManage(db(), { action: 'get_date' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('get_date returns error when world_state not found', async () => {
    const r = await handleTimeManage(db(), { action: 'get_date', world_id: 'no-such-world' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('get_date returns correct season for summer', async () => {
    await seedWorld('w-summer', '2184-07-15')
    const r = await handleTimeManage(db(), { action: 'get_date', world_id: 'w-summer' })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.season).toBe('summer')
    expect(body.days_in_month).toBe(31)
  })

  it('get_date returns winter for month 1', async () => {
    await seedWorld('w-winter1', '2184-01-10')
    const body = JSON.parse((await handleTimeManage(db(), { action: 'get_date', world_id: 'w-winter1' })).content[0].text)
    expect(body.season).toBe('winter')
  })

  it('get_date returns spring for month 3', async () => {
    await seedWorld('w-spring', '2184-03-01')
    const body = JSON.parse((await handleTimeManage(db(), { action: 'get_date', world_id: 'w-spring' })).content[0].text)
    expect(body.season).toBe('spring')
  })

  it('get_date returns autumn for month 10', async () => {
    await seedWorld('w-autumn', '2184-10-01')
    const body = JSON.parse((await handleTimeManage(db(), { action: 'get_date', world_id: 'w-autumn' })).content[0].text)
    expect(body.season).toBe('autumn')
  })

  it('get_date returns winter for month 12', async () => {
    await seedWorld('w-winter12', '2184-12-25')
    const body = JSON.parse((await handleTimeManage(db(), { action: 'get_date', world_id: 'w-winter12' })).content[0].text)
    expect(body.season).toBe('winter')
  })

  it('get_date returns 29 days_in_month for leap year February', async () => {
    await seedWorld('w-leap', '2184-02-01') // 2184 divisible by 4 but not 100 → leap
    const body = JSON.parse((await handleTimeManage(db(), { action: 'get_date', world_id: 'w-leap' })).content[0].text)
    expect(body.days_in_month).toBe(29)
  })

  it('get_date returns 28 days_in_month for non-leap year February', async () => {
    await seedWorld('w-nonleap', '2183-02-01') // 2183 not divisible by 4 → non-leap
    const body = JSON.parse((await handleTimeManage(db(), { action: 'get_date', world_id: 'w-nonleap' })).content[0].text)
    expect(body.days_in_month).toBe(28)
  })

  it('get_date returns null era when not set', async () => {
    await seedWorld('w-noera', '2184-06-01', null)
    const body = JSON.parse((await handleTimeManage(db(), { action: 'get_date', world_id: 'w-noera' })).content[0].text)
    expect(body.era).toBeNull()
  })

  // ── get_age ───────────────────────────────────────────────────────────────

  it('get_age requires world_id and character_id', async () => {
    const r1 = await handleTimeManage(db(), { action: 'get_age', character_id: 'c1' })
    expect(JSON.parse(r1.content[0].text).error).toBe(true)
    const r2 = await handleTimeManage(db(), { action: 'get_age', world_id: 'w1' })
    expect(JSON.parse(r2.content[0].text).error).toBe(true)
  })

  it('get_age returns null when born is null', async () => {
    await seedWorld('w-age', '2184-07-15')
    await seedChar('c-noborn', null)
    const body = JSON.parse((await handleTimeManage(db(), { action: 'get_age', world_id: 'w-age', character_id: 'c-noborn' })).content[0].text)
    expect(body.success).toBe(true)
    expect(body.age).toBeNull()
    expect(body.birthday).toBeNull()
  })

  it('get_age computes correct years/months/days', async () => {
    await seedWorld('w-age2', '2184-07-15')
    await seedChar('c-born', '2166-03-10') // ~18 years 4 months 5 days
    const body = JSON.parse((await handleTimeManage(db(), { action: 'get_age', world_id: 'w-age2', character_id: 'c-born' })).content[0].text)
    expect(body.success).toBe(true)
    expect(body.age.years).toBe(18)
    expect(body.age.months).toBe(4)
    expect(body.age.days).toBe(5)
  })

  it('get_age detects birthday today', async () => {
    await seedWorld('w-bday', '2184-07-15')
    await seedChar('c-bday', '2166-07-15') // birthday is today
    const body = JSON.parse((await handleTimeManage(db(), { action: 'get_age', world_id: 'w-bday', character_id: 'c-bday' })).content[0].text)
    expect(body.is_birthday_today).toBe(true)
    expect(body.next_birthday).toBe('2184-07-15')
  })

  it('get_age returns next_birthday in future when not today', async () => {
    await seedWorld('w-bday2', '2184-07-15')
    await seedChar('c-bday2', '2166-11-12') // next birthday Nov 12
    const body = JSON.parse((await handleTimeManage(db(), { action: 'get_age', world_id: 'w-bday2', character_id: 'c-bday2' })).content[0].text)
    expect(body.is_birthday_today).toBe(false)
    expect(body.next_birthday).toBe('2184-11-12')
  })

  it('get_age returns next_birthday in following year when birthday passed', async () => {
    await seedWorld('w-bday3', '2184-07-15')
    await seedChar('c-bday3', '2166-03-01') // birthday passed (March 1), next is 2185
    const body = JSON.parse((await handleTimeManage(db(), { action: 'get_age', world_id: 'w-bday3', character_id: 'c-bday3' })).content[0].text)
    expect(body.next_birthday).toBe('2185-03-01')
  })

  it('get_age returns error for unknown character', async () => {
    await seedWorld('w-age3', '2184-07-15')
    const body = JSON.parse((await handleTimeManage(db(), { action: 'get_age', world_id: 'w-age3', character_id: 'no-char' })).content[0].text)
    expect(body.error).toBe(true)
  })

  // ── advance ───────────────────────────────────────────────────────────────

  it('advance requires world_id and by', async () => {
    const r1 = await handleTimeManage(db(), { action: 'advance', by: '1 month' })
    expect(JSON.parse(r1.content[0].text).error).toBe(true)
    const r2 = await handleTimeManage(db(), { action: 'advance', world_id: 'w1' })
    expect(JSON.parse(r2.content[0].text).error).toBe(true)
  })

  it('advance rejects invalid by format', async () => {
    await seedWorld('w-adv', '2184-01-01')
    const body = JSON.parse((await handleTimeManage(db(), { action: 'advance', world_id: 'w-adv', by: 'a lot' })).content[0].text)
    expect(body.error).toBe(true)
  })

  it('advance by days', async () => {
    await seedWorld('w-days', '2184-07-15')
    const body = JSON.parse((await handleTimeManage(db(), { action: 'advance', world_id: 'w-days', by: '10 days' })).content[0].text)
    expect(body.success).toBe(true)
    expect(body.old_date).toBe('2184-07-15')
    expect(body.new_date).toBe('2184-07-25')
  })

  it('advance by months', async () => {
    await seedWorld('w-months', '2184-07-15')
    const body = JSON.parse((await handleTimeManage(db(), { action: 'advance', world_id: 'w-months', by: '3 months' })).content[0].text)
    expect(body.new_date).toBe('2184-10-15')
  })

  it('advance by months clamps to last valid day (Jan 31 + 1 month = Feb 28)', async () => {
    await seedWorld('w-clamp', '2183-01-31') // 2183 not leap
    const body = JSON.parse((await handleTimeManage(db(), { action: 'advance', world_id: 'w-clamp', by: '1 month' })).content[0].text)
    expect(body.new_date).toBe('2183-02-28')
  })

  it('advance by months clamps Feb in leap year to 29', async () => {
    await seedWorld('w-clamp2', '2184-01-31') // 2184 is leap
    const body = JSON.parse((await handleTimeManage(db(), { action: 'advance', world_id: 'w-clamp2', by: '1 month' })).content[0].text)
    expect(body.new_date).toBe('2184-02-29')
  })

  it('advance by years', async () => {
    await seedWorld('w-years', '2184-07-15')
    const body = JSON.parse((await handleTimeManage(db(), { action: 'advance', world_id: 'w-years', by: '2 years' })).content[0].text)
    expect(body.new_date).toBe('2186-07-15')
  })

  it('advance triggers birthday for character born in range', async () => {
    await seedWorld('w-bday-adv', '2184-07-01')
    await seedChar('c-bday-adv', '2166-07-10') // birthday July 10
    const body = JSON.parse((await handleTimeManage(db(), { action: 'advance', world_id: 'w-bday-adv', by: '30 days' })).content[0].text)
    expect(body.success).toBe(true)
    expect(body.birthdays_triggered).toHaveLength(1)
    expect(body.birthdays_triggered[0].id).toBe('c-bday-adv')
  })

  it('advance does not trigger birthday outside range', async () => {
    await seedWorld('w-nobday', '2184-07-01')
    await seedChar('c-nobday', '2166-11-01') // birthday November 1, not in July
    const body = JSON.parse((await handleTimeManage(db(), { action: 'advance', world_id: 'w-nobday', by: '30 days' })).content[0].text)
    expect(body.birthdays_triggered).toHaveLength(0)
  })

  it('advance ignores characters with no born date', async () => {
    await seedWorld('w-noborn', '2184-07-01')
    await seedChar('c-noborn2', null)
    const body = JSON.parse((await handleTimeManage(db(), { action: 'advance', world_id: 'w-noborn', by: '30 days' })).content[0].text)
    expect(body.birthdays_triggered).toHaveLength(0)
  })

  it('advance returns error when world_state not found', async () => {
    const body = JSON.parse((await handleTimeManage(db(), { action: 'advance', world_id: 'no-world', by: '1 day' })).content[0].text)
    expect(body.error).toBe(true)
  })

  it('advance accepts singular forms (day, month, year)', async () => {
    await seedWorld('w-singular', '2184-07-15')
    const body = JSON.parse((await handleTimeManage(db(), { action: 'advance', world_id: 'w-singular', by: '1 day' })).content[0].text)
    expect(body.new_date).toBe('2184-07-16')
  })

  it('advance by days rolls over year boundary (Dec 25 + 10 days = Jan 4)', async () => {
    await seedWorld('w-yearboundary', '2184-12-25')
    const body = JSON.parse((await handleTimeManage(db(), { action: 'advance', world_id: 'w-yearboundary', by: '10 days' })).content[0].text)
    expect(body.new_date).toBe('2185-01-04')
  })

  it('advance by months rolls over year boundary (Nov + 3 months = Feb next year)', async () => {
    await seedWorld('w-monthyear', '2184-11-15')
    const body = JSON.parse((await handleTimeManage(db(), { action: 'advance', world_id: 'w-monthyear', by: '3 months' })).content[0].text)
    expect(body.new_date).toBe('2185-02-15')
  })

  it('advance triggers birthday spanning year boundary', async () => {
    await seedWorld('w-yearbday', '2184-12-20')
    await seedChar('c-yearbday', '2166-01-05') // birthday Jan 5, falls in range Dec 20 → Jan 20
    const body = JSON.parse((await handleTimeManage(db(), { action: 'advance', world_id: 'w-yearbday', by: '30 days' })).content[0].text)
    expect(body.birthdays_triggered).toHaveLength(1)
    expect(body.birthdays_triggered[0].id).toBe('c-yearbday')
  })
})
