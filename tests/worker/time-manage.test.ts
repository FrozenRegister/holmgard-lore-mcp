// Direct handler tests for time-manage
import { describe } from './support/helpers'
import { env } from 'cloudflare:test'
import { expect, it, beforeEach } from 'vitest'
import { setupRpgDb } from './support/setup-d1'
import { handleTimeManage, seedWorldState } from '@/rpg/handlers/time-manage'

describe('handleTimeManage', () => {
  beforeEach(async () => {
    await setupRpgDb(env.RPG_DB)
  })

  const db = () => ({ RPG_DB: env.RPG_DB }) as any
  const now = new Date().toISOString()

  async function seedWorld(worldId: string, date: string, era: string | null = null) {
    await env.RPG_DB.prepare(
      `INSERT OR IGNORE INTO worlds (id, name, seed, width, height, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(worldId, worldId, 'seed', 10, 10, now, now)
      .run()
    await env.RPG_DB.prepare(
      `INSERT OR REPLACE INTO world_state (world_id, current_date, era) VALUES (?, ?, ?)`,
    )
      .bind(worldId, date, era)
      .run()
  }

  async function seedChar(id: string, born: string | null = null) {
    await env.RPG_DB.prepare(
      `INSERT OR IGNORE INTO characters (id, name, stats, hp, max_hp, ac, level, character_type, character_class, race, conditions, resistances, vulnerabilities, immunities, known_spells, prepared_spells, cantrips_known, currency, resource_pools, xp, born, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        id,
        id,
        '{}',
        10,
        10,
        10,
        1,
        'pc',
        'Fighter',
        'Human',
        '[]',
        '[]',
        '[]',
        '[]',
        '[]',
        '[]',
        '[]',
        '{}',
        '{}',
        0,
        born,
        now,
        now,
      )
      .run()
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
      `INSERT OR IGNORE INTO worlds (id, name, seed, width, height, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind('w1', 'World 1', 'seed', 10, 10, now, now)
      .run()

    const r = await handleTimeManage(db(), {
      action: 'set_date',
      world_id: 'w1',
      date: '2184-07-15',
      era: 'Age of Collapse',
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.current_date).toBe('2184-07-15')
    expect(body.era).toBe('Age of Collapse')
  })

  it('set_date updates existing world_state', async () => {
    await seedWorld('w2', '2184-01-01', 'Old Era')
    const r = await handleTimeManage(db(), {
      action: 'set_date',
      world_id: 'w2',
      date: '2185-06-01',
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.current_date).toBe('2185-06-01')
    expect(body.era).toBe('Old Era') // era preserved when not supplied
  })

  it('set_date updates era when supplied', async () => {
    await seedWorld('w3', '2184-01-01', 'Old Era')
    const r = await handleTimeManage(db(), {
      action: 'set_date',
      world_id: 'w3',
      date: '2185-01-01',
      era: 'New Era',
    })
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

  it('get_date accepts camelCase worldId as an alias for world_id (#336)', async () => {
    await seedWorld('w-camel', '2184-07-15')
    const r = await handleTimeManage(db(), { action: 'get_date', worldId: 'w-camel' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBeUndefined()
    expect(body.current_date).toBe('2184-07-15')
  })

  it('world_id takes precedence when both world_id and worldId are given', async () => {
    await seedWorld('w-snake', '2184-07-15')
    const r = await handleTimeManage(db(), {
      action: 'get_date',
      world_id: 'w-snake',
      worldId: 'no-such-world',
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBeUndefined()
    expect(body.current_date).toBe('2184-07-15')
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
    const body = JSON.parse(
      (await handleTimeManage(db(), { action: 'get_date', world_id: 'w-winter1' })).content[0].text,
    )
    expect(body.season).toBe('winter')
  })

  it('get_date returns spring for month 3', async () => {
    await seedWorld('w-spring', '2184-03-01')
    const body = JSON.parse(
      (await handleTimeManage(db(), { action: 'get_date', world_id: 'w-spring' })).content[0].text,
    )
    expect(body.season).toBe('spring')
  })

  it('get_date returns autumn for month 10', async () => {
    await seedWorld('w-autumn', '2184-10-01')
    const body = JSON.parse(
      (await handleTimeManage(db(), { action: 'get_date', world_id: 'w-autumn' })).content[0].text,
    )
    expect(body.season).toBe('autumn')
  })

  it('get_date returns winter for month 12', async () => {
    await seedWorld('w-winter12', '2184-12-25')
    const body = JSON.parse(
      (await handleTimeManage(db(), { action: 'get_date', world_id: 'w-winter12' })).content[0]
        .text,
    )
    expect(body.season).toBe('winter')
  })

  it('get_date returns 29 days_in_month for leap year February', async () => {
    await seedWorld('w-leap', '2184-02-01') // 2184 divisible by 4 but not 100 → leap
    const body = JSON.parse(
      (await handleTimeManage(db(), { action: 'get_date', world_id: 'w-leap' })).content[0].text,
    )
    expect(body.days_in_month).toBe(29)
  })

  it('get_date returns 28 days_in_month for non-leap year February', async () => {
    await seedWorld('w-nonleap', '2183-02-01') // 2183 not divisible by 4 → non-leap
    const body = JSON.parse(
      (await handleTimeManage(db(), { action: 'get_date', world_id: 'w-nonleap' })).content[0].text,
    )
    expect(body.days_in_month).toBe(28)
  })

  it('get_date returns null era when not set', async () => {
    await seedWorld('w-noera', '2184-06-01', null)
    const body = JSON.parse(
      (await handleTimeManage(db(), { action: 'get_date', world_id: 'w-noera' })).content[0].text,
    )
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
    const body = JSON.parse(
      (
        await handleTimeManage(db(), {
          action: 'get_age',
          world_id: 'w-age',
          character_id: 'c-noborn',
        })
      ).content[0].text,
    )
    expect(body.success).toBe(true)
    expect(body.age).toBeNull()
    expect(body.birthday).toBeNull()
  })

  it('get_age computes correct years/months/days', async () => {
    await seedWorld('w-age2', '2184-07-15')
    await seedChar('c-born', '2166-03-10') // ~18 years 4 months 5 days
    const body = JSON.parse(
      (
        await handleTimeManage(db(), {
          action: 'get_age',
          world_id: 'w-age2',
          character_id: 'c-born',
        })
      ).content[0].text,
    )
    expect(body.success).toBe(true)
    expect(body.age.years).toBe(18)
    expect(body.age.months).toBe(4)
    expect(body.age.days).toBe(5)
  })

  it('get_age detects birthday today', async () => {
    await seedWorld('w-bday', '2184-07-15')
    await seedChar('c-bday', '2166-07-15') // birthday is today
    const body = JSON.parse(
      (
        await handleTimeManage(db(), {
          action: 'get_age',
          world_id: 'w-bday',
          character_id: 'c-bday',
        })
      ).content[0].text,
    )
    expect(body.is_birthday_today).toBe(true)
    expect(body.next_birthday).toBe('2184-07-15')
  })

  it('get_age returns next_birthday in future when not today', async () => {
    await seedWorld('w-bday2', '2184-07-15')
    await seedChar('c-bday2', '2166-11-12') // next birthday Nov 12
    const body = JSON.parse(
      (
        await handleTimeManage(db(), {
          action: 'get_age',
          world_id: 'w-bday2',
          character_id: 'c-bday2',
        })
      ).content[0].text,
    )
    expect(body.is_birthday_today).toBe(false)
    expect(body.next_birthday).toBe('2184-11-12')
  })

  it('get_age returns next_birthday in following year when birthday passed', async () => {
    await seedWorld('w-bday3', '2184-07-15')
    await seedChar('c-bday3', '2166-03-01') // birthday passed (March 1), next is 2185
    const body = JSON.parse(
      (
        await handleTimeManage(db(), {
          action: 'get_age',
          world_id: 'w-bday3',
          character_id: 'c-bday3',
        })
      ).content[0].text,
    )
    expect(body.next_birthday).toBe('2185-03-01')
  })

  it('get_age handles year-only born date (#303): years correct, months/days/next_birthday null', async () => {
    await seedWorld('w-partial', '2184-07-15')
    await seedChar('c-partial', '2155') // year-only, ~29 years old
    const body = JSON.parse(
      (
        await handleTimeManage(db(), {
          action: 'get_age',
          world_id: 'w-partial',
          character_id: 'c-partial',
        })
      ).content[0].text,
    )
    expect(body.success).toBe(true)
    expect(body.age.years).toBe(29)
    expect(body.age.months).toBeNull()
    expect(body.age.days).toBeNull()
    expect(body.next_birthday).toBeNull()
    expect(body.is_birthday_today).toBe(false)
    expect(body.is_partial_date).toBe(true)
  })

  it('get_age reports is_partial_date false for a full born date', async () => {
    await seedWorld('w-full', '2184-07-15')
    await seedChar('c-full', '2166-03-10')
    const body = JSON.parse(
      (
        await handleTimeManage(db(), {
          action: 'get_age',
          world_id: 'w-full',
          character_id: 'c-full',
        })
      ).content[0].text,
    )
    expect(body.is_partial_date).toBe(false)
  })

  it('get_age returns error for unknown character', async () => {
    await seedWorld('w-age3', '2184-07-15')
    const body = JSON.parse(
      (
        await handleTimeManage(db(), {
          action: 'get_age',
          world_id: 'w-age3',
          character_id: 'no-char',
        })
      ).content[0].text,
    )
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
    const body = JSON.parse(
      (await handleTimeManage(db(), { action: 'advance', world_id: 'w-adv', by: 'a lot' }))
        .content[0].text,
    )
    expect(body.error).toBe(true)
  })

  it('advance by days', async () => {
    await seedWorld('w-days', '2184-07-15')
    const body = JSON.parse(
      (await handleTimeManage(db(), { action: 'advance', world_id: 'w-days', by: '10 days' }))
        .content[0].text,
    )
    expect(body.success).toBe(true)
    expect(body.old_date).toBe('2184-07-15')
    expect(body.new_date).toBe('2184-07-25')
  })

  it('advance by months', async () => {
    await seedWorld('w-months', '2184-07-15')
    const body = JSON.parse(
      (await handleTimeManage(db(), { action: 'advance', world_id: 'w-months', by: '3 months' }))
        .content[0].text,
    )
    expect(body.new_date).toBe('2184-10-15')
  })

  it('advance by months clamps to last valid day (Jan 31 + 1 month = Feb 28)', async () => {
    await seedWorld('w-clamp', '2183-01-31') // 2183 not leap
    const body = JSON.parse(
      (await handleTimeManage(db(), { action: 'advance', world_id: 'w-clamp', by: '1 month' }))
        .content[0].text,
    )
    expect(body.new_date).toBe('2183-02-28')
  })

  it('advance by months clamps Feb in leap year to 29', async () => {
    await seedWorld('w-clamp2', '2184-01-31') // 2184 is leap
    const body = JSON.parse(
      (await handleTimeManage(db(), { action: 'advance', world_id: 'w-clamp2', by: '1 month' }))
        .content[0].text,
    )
    expect(body.new_date).toBe('2184-02-29')
  })

  it('advance by years', async () => {
    await seedWorld('w-years', '2184-07-15')
    const body = JSON.parse(
      (await handleTimeManage(db(), { action: 'advance', world_id: 'w-years', by: '2 years' }))
        .content[0].text,
    )
    expect(body.new_date).toBe('2186-07-15')
  })

  it('advance triggers birthday for character born in range', async () => {
    await seedWorld('w-bday-adv', '2184-07-01')
    await seedChar('c-bday-adv', '2166-07-10') // birthday July 10
    const body = JSON.parse(
      (await handleTimeManage(db(), { action: 'advance', world_id: 'w-bday-adv', by: '30 days' }))
        .content[0].text,
    )
    expect(body.success).toBe(true)
    expect(body.birthdays_triggered).toHaveLength(1)
    expect(body.birthdays_triggered[0].id).toBe('c-bday-adv')
  })

  it('advance does not trigger birthday outside range', async () => {
    await seedWorld('w-nobday', '2184-07-01')
    await seedChar('c-nobday', '2166-11-01') // birthday November 1, not in July
    const body = JSON.parse(
      (await handleTimeManage(db(), { action: 'advance', world_id: 'w-nobday', by: '30 days' }))
        .content[0].text,
    )
    expect(body.birthdays_triggered).toHaveLength(0)
  })

  it('advance ignores characters with no born date', async () => {
    await seedWorld('w-noborn', '2184-07-01')
    await seedChar('c-noborn2', null)
    const body = JSON.parse(
      (await handleTimeManage(db(), { action: 'advance', world_id: 'w-noborn', by: '30 days' }))
        .content[0].text,
    )
    expect(body.birthdays_triggered).toHaveLength(0)
  })

  it('advance never triggers a birthday for a year-only born date (#303)', async () => {
    await seedWorld('w-partial-adv', '2184-07-01')
    await seedChar('c-partial-adv', '2155') // year-only — no month/day to match against any range
    const body = JSON.parse(
      (
        await handleTimeManage(db(), {
          action: 'advance',
          world_id: 'w-partial-adv',
          by: '60 days',
        })
      ).content[0].text,
    )
    expect(body.birthdays_triggered).toHaveLength(0)
  })

  it('advance returns error when world_state not found', async () => {
    const body = JSON.parse(
      (await handleTimeManage(db(), { action: 'advance', world_id: 'no-world', by: '1 day' }))
        .content[0].text,
    )
    expect(body.error).toBe(true)
  })

  it('advance accepts singular forms (day, month, year)', async () => {
    await seedWorld('w-singular', '2184-07-15')
    const body = JSON.parse(
      (await handleTimeManage(db(), { action: 'advance', world_id: 'w-singular', by: '1 day' }))
        .content[0].text,
    )
    expect(body.new_date).toBe('2184-07-16')
  })

  it('advance by days rolls over year boundary (Dec 25 + 10 days = Jan 4)', async () => {
    await seedWorld('w-yearboundary', '2184-12-25')
    const body = JSON.parse(
      (
        await handleTimeManage(db(), {
          action: 'advance',
          world_id: 'w-yearboundary',
          by: '10 days',
        })
      ).content[0].text,
    )
    expect(body.new_date).toBe('2185-01-04')
  })

  it('advance by months rolls over year boundary (Nov + 3 months = Feb next year)', async () => {
    await seedWorld('w-monthyear', '2184-11-15')
    const body = JSON.parse(
      (await handleTimeManage(db(), { action: 'advance', world_id: 'w-monthyear', by: '3 months' }))
        .content[0].text,
    )
    expect(body.new_date).toBe('2185-02-15')
  })

  it('advance triggers birthday spanning year boundary', async () => {
    await seedWorld('w-yearbday', '2184-12-20')
    await seedChar('c-yearbday', '2166-01-05') // birthday Jan 5, falls in range Dec 20 → Jan 20
    const body = JSON.parse(
      (await handleTimeManage(db(), { action: 'advance', world_id: 'w-yearbday', by: '30 days' }))
        .content[0].text,
    )
    expect(body.birthdays_triggered).toHaveLength(1)
    expect(body.birthdays_triggered[0].id).toBe('c-yearbday')
  })

  // ── seedWorldState (#330 — used by world_manage.create/generate) ──────────

  it('seedWorldState creates a row usable immediately by get_date', async () => {
    await env.RPG_DB.prepare(
      'INSERT INTO worlds (id, name, seed, width, height, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
      .bind('w-fresh', 'Fresh World', 'seed', 10, 10, now, now)
      .run()
    await seedWorldState(env.RPG_DB, 'w-fresh')
    const body = JSON.parse(
      (await handleTimeManage(db(), { action: 'get_date', world_id: 'w-fresh' })).content[0].text,
    )
    expect(body.error).toBeUndefined()
    expect(body.current_date).toBe('2184-07-15') // world_state.current_date's column DEFAULT
  })

  it('seedWorldState is idempotent — does not overwrite an existing row', async () => {
    await seedWorld('w-existing', '2190-03-01')
    await seedWorldState(env.RPG_DB, 'w-existing')
    const body = JSON.parse(
      (await handleTimeManage(db(), { action: 'get_date', world_id: 'w-existing' })).content[0]
        .text,
    )
    expect(body.current_date).toBe('2190-03-01')
  })

  // ── set_owner / get_owner / advance ownership guard (#312) ──────────────────

  it('get_owner requires world_id', async () => {
    const body = JSON.parse((await handleTimeManage(db(), { action: 'get_owner' })).content[0].text)
    expect(body.error).toBe(true)
  })

  it('get_owner returns null for a world with no owner claimed', async () => {
    await seedWorld('w-owner-none', '2184-01-01')
    const body = JSON.parse(
      (await handleTimeManage(db(), { action: 'get_owner', world_id: 'w-owner-none' })).content[0]
        .text,
    )
    expect(body.success).toBe(true)
    expect(body.time_owner).toBeNull()
    expect(body.time_owner_since).toBeNull()
  })

  it('get_owner errors when world_state does not exist', async () => {
    const body = JSON.parse(
      (await handleTimeManage(db(), { action: 'get_owner', world_id: 'no-such-world' })).content[0]
        .text,
    )
    expect(body.error).toBe(true)
  })

  it('set_owner requires world_id', async () => {
    const body = JSON.parse(
      (await handleTimeManage(db(), { action: 'set_owner', owner: 'archisector' })).content[0].text,
    )
    expect(body.error).toBe(true)
  })

  it('set_owner requires owner (undefined is rejected, null is allowed)', async () => {
    await seedWorld('w-owner-req', '2184-01-01')
    const body = JSON.parse(
      (await handleTimeManage(db(), { action: 'set_owner', world_id: 'w-owner-req' })).content[0]
        .text,
    )
    expect(body.error).toBe(true)
  })

  it('set_owner errors when world_state does not exist', async () => {
    const body = JSON.parse(
      (
        await handleTimeManage(db(), {
          action: 'set_owner',
          world_id: 'no-such-world',
          owner: 'archisector',
        })
      ).content[0].text,
    )
    expect(body.error).toBe(true)
  })

  it('set_owner claims the clock and get_owner reflects it', async () => {
    await seedWorld('w-owner-claim', '2184-01-01')
    const setBody = JSON.parse(
      (
        await handleTimeManage(db(), {
          action: 'set_owner',
          world_id: 'w-owner-claim',
          owner: 'archisector',
        })
      ).content[0].text,
    )
    expect(setBody.success).toBe(true)
    expect(setBody.time_owner).toBe('archisector')
    expect(setBody.time_owner_since).toBeTruthy()

    const getBody = JSON.parse(
      (await handleTimeManage(db(), { action: 'get_owner', world_id: 'w-owner-claim' })).content[0]
        .text,
    )
    expect(getBody.time_owner).toBe('archisector')
    expect(getBody.time_owner_since).toBe(setBody.time_owner_since)
  })

  it('set_owner releases the clock when owner is null', async () => {
    await seedWorld('w-owner-release', '2184-01-01')
    await handleTimeManage(db(), {
      action: 'set_owner',
      world_id: 'w-owner-release',
      owner: 'archisector',
    })
    const releaseBody = JSON.parse(
      (
        await handleTimeManage(db(), {
          action: 'set_owner',
          world_id: 'w-owner-release',
          owner: null,
        })
      ).content[0].text,
    )
    expect(releaseBody.success).toBe(true)
    expect(releaseBody.time_owner).toBeNull()
    expect(releaseBody.time_owner_since).toBeNull()
  })

  it('advance without an owner proceeds unguarded regardless of who holds the clock (backward compatible)', async () => {
    await seedWorld('w-advance-noowner', '2184-01-01')
    await handleTimeManage(db(), {
      action: 'set_owner',
      world_id: 'w-advance-noowner',
      owner: 'archisector',
    })
    const body = JSON.parse(
      (
        await handleTimeManage(db(), {
          action: 'advance',
          world_id: 'w-advance-noowner',
          by: '1 day',
        })
      ).content[0].text,
    )
    expect(body.success).toBe(true)
    expect(body.new_date).toBe('2184-01-02')
  })

  it('advance with an owner implicitly claims the clock when unclaimed', async () => {
    await seedWorld('w-advance-claim', '2184-01-01')
    const body = JSON.parse(
      (
        await handleTimeManage(db(), {
          action: 'advance',
          world_id: 'w-advance-claim',
          by: '1 day',
          owner: 'archisector',
        })
      ).content[0].text,
    )
    expect(body.success).toBe(true)
    expect(body.time_owner).toBe('archisector')

    const ownerBody = JSON.parse(
      (await handleTimeManage(db(), { action: 'get_owner', world_id: 'w-advance-claim' }))
        .content[0].text,
    )
    expect(ownerBody.time_owner).toBe('archisector')
  })

  it('advance with the same owner that already holds the clock succeeds', async () => {
    await seedWorld('w-advance-same', '2184-01-01')
    await handleTimeManage(db(), {
      action: 'set_owner',
      world_id: 'w-advance-same',
      owner: 'calder-architect',
    })
    const body = JSON.parse(
      (
        await handleTimeManage(db(), {
          action: 'advance',
          world_id: 'w-advance-same',
          by: '1 month',
          owner: 'calder-architect',
        })
      ).content[0].text,
    )
    expect(body.success).toBe(true)
    expect(body.time_owner).toBe('calder-architect')
  })

  it('advance with a different owner than the current holder is rejected', async () => {
    await seedWorld('w-advance-conflict', '2184-01-01')
    await handleTimeManage(db(), {
      action: 'set_owner',
      world_id: 'w-advance-conflict',
      owner: 'archisector',
    })
    const body = JSON.parse(
      (
        await handleTimeManage(db(), {
          action: 'advance',
          world_id: 'w-advance-conflict',
          by: '1 month',
          owner: 'calder-architect',
        })
      ).content[0].text,
    )
    expect(body.error).toBe(true)
    expect(body.message).toContain('archisector')

    // Clock must not have moved.
    const dateBody = JSON.parse(
      (await handleTimeManage(db(), { action: 'get_date', world_id: 'w-advance-conflict' }))
        .content[0].text,
    )
    expect(dateBody.current_date).toBe('2184-01-01')
  })

  it('advance after releasing ownership can be claimed by a different owner', async () => {
    await seedWorld('w-advance-handoff', '2184-01-01')
    await handleTimeManage(db(), {
      action: 'set_owner',
      world_id: 'w-advance-handoff',
      owner: 'archisector',
    })
    await handleTimeManage(db(), {
      action: 'set_owner',
      world_id: 'w-advance-handoff',
      owner: null,
    })
    const body = JSON.parse(
      (
        await handleTimeManage(db(), {
          action: 'advance',
          world_id: 'w-advance-handoff',
          by: '1 month',
          owner: 'calder-architect',
        })
      ).content[0].text,
    )
    expect(body.success).toBe(true)
    expect(body.time_owner).toBe('calder-architect')
  })

  // ── Tick Driver (#442) ────────────────────────────────────────────────────

  it('advance with no hooks returns tick_driver as undefined (backward compat)', async () => {
    await seedWorld('w-tick-noops', '2184-07-01')
    const body = JSON.parse(
      (await handleTimeManage(db(), { action: 'advance', world_id: 'w-tick-noops', by: '1 month' }))
        .content[0].text,
    )
    expect(body.success).toBe(true)
    expect(body.tick_driver).toBeUndefined()
    // Ensure existing fields are present
    expect(body.old_date).toBe('2184-07-01')
    expect(body.new_date).toBe('2184-08-01')
  })

  it('advance with empty hooks array returns tick_driver with empty resolved/flagged', async () => {
    await seedWorld('w-tick-empty', '2184-07-01')
    const body = JSON.parse(
      (
        await handleTimeManage(db(), {
          action: 'advance',
          world_id: 'w-tick-empty',
          by: '1 month',
          hooks: [],
        })
      ).content[0].text,
    )
    expect(body.success).toBe(true)
    expect(body.tick_driver).toBeDefined()
    expect(body.tick_driver.success).toBe(true)
    expect(body.tick_driver.resolved).toHaveLength(0)
    expect(body.tick_driver.flagged).toHaveLength(0)
  })

  it('advance with hooks returns tick_driver object with resolved and flagged hooks', async () => {
    await seedWorld('w-tick-basic', '2184-07-01')
    const body = JSON.parse(
      (
        await handleTimeManage(db(), {
          action: 'advance',
          world_id: 'w-tick-basic',
          by: '1 month',
          hooks: ['weather_update'],
        })
      ).content[0].text,
    )
    expect(body.success).toBe(true)
    expect(body.tick_driver).toBeDefined()
    expect(body.tick_driver.success).toBe(true)
    // weather_update is a resolved hook
    expect(body.tick_driver.resolved).toContainEqual(
      expect.objectContaining({ category: 'resolved' }),
    )
  })

  it('advance with dry_run=true returns mutations diff without persisting', async () => {
    await seedWorld('w-tick-dryrun', '2184-07-01')
    const body = JSON.parse(
      (
        await handleTimeManage(db(), {
          action: 'advance',
          world_id: 'w-tick-dryrun',
          by: '1 month',
          hooks: ['weather_update'],
          dry_run: true,
        })
      ).content[0].text,
    )
    expect(body.success).toBe(true)
    expect(body.tick_driver).toBeDefined()
    expect(body.tick_driver.mutations).toBeDefined() // dry_run returns mutations
  })

  it('advance with multiple hooks runs in topologically sorted order', async () => {
    await seedWorld('w-tick-multi', '2184-07-01')
    const body = JSON.parse(
      (
        await handleTimeManage(db(), {
          action: 'advance',
          world_id: 'w-tick-multi',
          by: '1 month',
          hooks: ['health_degradation', 'resource_consume'],
        })
      ).content[0].text,
    )
    expect(body.success).toBe(true)
    // Both should run (order handled internally by topological sort)
    expect(body.tick_driver.resolved.length).toBeGreaterThan(0)
  })

  it('advance with flagged hooks returns them in flagged array', async () => {
    await seedWorld('w-tick-flagged', '2184-07-01')
    const body = JSON.parse(
      (
        await handleTimeManage(db(), {
          action: 'advance',
          world_id: 'w-tick-flagged',
          by: '1 month',
          hooks: ['encounter_check'],
        })
      ).content[0].text,
    )
    expect(body.success).toBe(true)
    // encounter_check is a flagged hook
    expect(body.tick_driver.flagged).toContainEqual(
      expect.objectContaining({ category: 'flagged' }),
    )
  })

  it('advance includes narrator_summary from hooks when provided', async () => {
    await seedWorld('w-tick-narr', '2184-07-01')
    const body = JSON.parse(
      (
        await handleTimeManage(db(), {
          action: 'advance',
          world_id: 'w-tick-narr',
          by: '1 month',
          hooks: ['weather_update'],
        })
      ).content[0].text,
    )
    expect(body.success).toBe(true)
    expect(body.tick_driver.narrator_summary).toBeDefined()
    expect(typeof body.tick_driver.narrator_summary).toBe('string')
  })

  it('advance with invalid hook name still returns success=true with empty results', async () => {
    await seedWorld('w-tick-invalid', '2184-07-01')
    // Non-existent hook names are silently skipped
    const body = JSON.parse(
      (
        await handleTimeManage(db(), {
          action: 'advance',
          world_id: 'w-tick-invalid',
          by: '1 month',
          hooks: ['nonexistent_hook'],
        })
      ).content[0].text,
    )
    expect(body.success).toBe(true)
    expect(body.tick_driver).toBeDefined()
  })

  it('advance with dissolution_flag hook categorizes as flagged', async () => {
    await seedWorld('w-tick-diss', '2184-07-01')
    const body = JSON.parse(
      (
        await handleTimeManage(db(), {
          action: 'advance',
          world_id: 'w-tick-diss',
          by: '1 month',
          hooks: ['dissolution_flag'],
        })
      ).content[0].text,
    )
    expect(body.success).toBe(true)
    expect(body.tick_driver.flagged.some((h: any) => h.category === 'flagged')).toBe(true)
  })

  it('advance preserves all existing response fields when hooks are used', async () => {
    await seedWorld('w-tick-preserve', '2184-01-01')
    await seedChar('c-preserve', '2166-07-15')
    const body = JSON.parse(
      (
        await handleTimeManage(db(), {
          action: 'advance',
          world_id: 'w-tick-preserve',
          by: '31 days',
          hooks: ['weather_update'],
        })
      ).content[0].text,
    )
    expect(body.success).toBe(true)
    expect(body.old_date).toBe('2184-01-01')
    expect(body.new_date).toBe('2184-02-01')
    expect(body.days_elapsed).toBe(31)
    expect(body.birthdays_triggered).toBeDefined()
    expect(body.tick_driver).toBeDefined()
  })

  it('advance with dry_run=false (explicit) applies mutations', async () => {
    await seedWorld('w-tick-apply', '2184-07-01')
    const body = JSON.parse(
      (
        await handleTimeManage(db(), {
          action: 'advance',
          world_id: 'w-tick-apply',
          by: '1 month',
          hooks: ['weather_update'],
          dry_run: false,
        })
      ).content[0].text,
    )
    expect(body.success).toBe(true)
    // When not dry_run, mutations field is not included
    expect(body.tick_driver.mutations).toBeUndefined()
  })

  it('advance without dry_run param defaults to false (applies mutations)', async () => {
    await seedWorld('w-tick-default', '2184-07-01')
    const body = JSON.parse(
      (
        await handleTimeManage(db(), {
          action: 'advance',
          world_id: 'w-tick-default',
          by: '1 month',
          hooks: ['weather_update'],
        })
      ).content[0].text,
    )
    expect(body.success).toBe(true)
    expect(body.tick_driver.mutations).toBeUndefined()
  })

  it('advance with enabled hook executes and returns results', async () => {
    await seedWorld('w-tick-enabled', '2184-07-01')
    const body = JSON.parse(
      (
        await handleTimeManage(db(), {
          action: 'advance',
          world_id: 'w-tick-enabled',
          by: '1 month',
          hooks: ['weather_update'],
        })
      ).content[0].text,
    )
    expect(body.success).toBe(true)
    expect(body.tick_driver.success).toBe(true)
    expect(body.tick_driver.resolved.length).toBeGreaterThan(0)
  })

  it('advance includes all narrator summaries from executed hooks', async () => {
    await seedWorld('w-tick-summaries', '2184-07-01')
    const body = JSON.parse(
      (
        await handleTimeManage(db(), {
          action: 'advance',
          world_id: 'w-tick-summaries',
          by: '1 month',
          hooks: ['weather_update', 'health_degradation'],
        })
      ).content[0].text,
    )
    expect(body.success).toBe(true)
    expect(body.tick_driver.narrator_summary).toBeDefined()
    expect(body.tick_driver.narrator_summary).toContain('Weather')
    expect(body.tick_driver.narrator_summary).toContain('health')
  })

  it('advance with multiple dependencies runs hooks in correct order', async () => {
    await seedWorld('w-tick-deps', '2184-07-01')
    // dissolution_flag depends on health_degradation and encounter_check
    const body = JSON.parse(
      (
        await handleTimeManage(db(), {
          action: 'advance',
          world_id: 'w-tick-deps',
          by: '1 month',
          hooks: ['dissolution_flag', 'weather_update'],
        })
      ).content[0].text,
    )
    expect(body.success).toBe(true)
    expect(body.tick_driver.success).toBe(true)
    // Should have results from both weather_update and dissolution_flag
    const allResults = [...body.tick_driver.resolved, ...body.tick_driver.flagged]
    expect(allResults.length).toBeGreaterThan(0)
  })

  it('advance with dry_run mode includes mutations in response', async () => {
    await seedWorld('w-tick-dryrun-mutations', '2184-07-01')
    const body = JSON.parse(
      (
        await handleTimeManage(db(), {
          action: 'advance',
          world_id: 'w-tick-dryrun-mutations',
          by: '1 month',
          hooks: ['weather_update'],
          dry_run: true,
        })
      ).content[0].text,
    )
    expect(body.success).toBe(true)
    expect(body.tick_driver).toBeDefined()
    expect(body.tick_driver.mutations).toBeDefined()
    expect(body.tick_driver.mutations.would_persist).toBeDefined()
  })

  it('advance with non-existent world_id errors', async () => {
    const body = JSON.parse(
      (
        await handleTimeManage(db(), {
          action: 'advance',
          world_id: 'nonexistent-world',
          by: '1 month',
          hooks: [],
        })
      ).content[0].text,
    )
    expect(body.error).toBe(true)
  })

  it('advance with large hooks array runs all hooks', async () => {
    await seedWorld('w-tick-large', '2184-07-01')
    const body = JSON.parse(
      (
        await handleTimeManage(db(), {
          action: 'advance',
          world_id: 'w-tick-large',
          by: '1 month',
          hooks: [
            'weather_update',
            'resource_consume',
            'encounter_check',
            'health_degradation',
            'dissolution_flag',
          ],
        })
      ).content[0].text,
    )
    expect(body.success).toBe(true)
    expect(body.tick_driver.success).toBe(true)
    // All hooks should execute
    const allResults = body.tick_driver.resolved.length + body.tick_driver.flagged.length
    expect(allResults).toBeGreaterThanOrEqual(5)
  })

  it('advance tick_driver success field is always set', async () => {
    await seedWorld('w-tick-success', '2184-07-01')
    const body = JSON.parse(
      (
        await handleTimeManage(db(), {
          action: 'advance',
          world_id: 'w-tick-success',
          by: '1 month',
          hooks: ['weather_update'],
        })
      ).content[0].text,
    )
    expect(body.tick_driver).toBeDefined()
    expect(body.tick_driver.success).toBeDefined()
    expect(typeof body.tick_driver.success).toBe('boolean')
  })

  it('advance with encounter_check and health_degradation together', async () => {
    await seedWorld('w-tick-combined', '2184-07-01')
    const body = JSON.parse(
      (
        await handleTimeManage(db(), {
          action: 'advance',
          world_id: 'w-tick-combined',
          by: '1 month',
          hooks: ['encounter_check', 'health_degradation'],
        })
      ).content[0].text,
    )
    expect(body.success).toBe(true)
    expect(body.tick_driver.resolved).toBeDefined()
    expect(body.tick_driver.flagged).toBeDefined()
  })

  it('advance tick_driver fields exist regardless of hook results', async () => {
    await seedWorld('w-tick-fields', '2184-07-01')
    const body = JSON.parse(
      (
        await handleTimeManage(db(), {
          action: 'advance',
          world_id: 'w-tick-fields',
          by: '1 month',
          hooks: ['weather_update'],
        })
      ).content[0].text,
    )
    expect(body.tick_driver).toBeDefined()
    expect(body.tick_driver.success).toBeDefined()
    expect(body.tick_driver.resolved).toBeDefined()
    expect(body.tick_driver.flagged).toBeDefined()
    expect(Array.isArray(body.tick_driver.resolved)).toBe(true)
    expect(Array.isArray(body.tick_driver.flagged)).toBe(true)
  })

  it('advance with single hook includes narrator_summary', async () => {
    await seedWorld('w-tick-single-narr', '2184-07-01')
    const body = JSON.parse(
      (
        await handleTimeManage(db(), {
          action: 'advance',
          world_id: 'w-tick-single-narr',
          by: '1 month',
          hooks: ['resource_consume'],
        })
      ).content[0].text,
    )
    expect(body.success).toBe(true)
    expect(body.tick_driver.narrator_summary).toBeDefined()
    expect(typeof body.tick_driver.narrator_summary).toBe('string')
    expect(body.tick_driver.narrator_summary.length).toBeGreaterThan(0)
  })

  it('advance dry_run with single hook returns mutations', async () => {
    await seedWorld('w-tick-dry-single', '2184-07-01')
    const body = JSON.parse(
      (
        await handleTimeManage(db(), {
          action: 'advance',
          world_id: 'w-tick-dry-single',
          by: '1 month',
          hooks: ['resource_consume'],
          dry_run: true,
        })
      ).content[0].text,
    )
    expect(body.success).toBe(true)
    expect(body.tick_driver.mutations).toBeDefined()
    expect(body.tick_driver.mutations.would_persist).toBeDefined()
  })

  it('advance without dry_run explicitly omits mutations', async () => {
    await seedWorld('w-tick-no-dry', '2184-07-01')
    const body = JSON.parse(
      (
        await handleTimeManage(db(), {
          action: 'advance',
          world_id: 'w-tick-no-dry',
          by: '1 month',
          hooks: ['weather_update'],
          dry_run: false,
        })
      ).content[0].text,
    )
    expect(body.success).toBe(true)
    expect(body.tick_driver.mutations).toBeUndefined()
  })

  it('advance with resolved hook populates resolved array', async () => {
    await seedWorld('w-tick-resolved', '2184-07-01')
    const body = JSON.parse(
      (
        await handleTimeManage(db(), {
          action: 'advance',
          world_id: 'w-tick-resolved',
          by: '1 month',
          hooks: ['weather_update'],
        })
      ).content[0].text,
    )
    expect(body.tick_driver.resolved).toHaveLength(1)
    expect(body.tick_driver.resolved[0]).toHaveProperty('category')
    expect(body.tick_driver.resolved[0].category).toBe('resolved')
  })

  it('advance with flagged hook populates flagged array', async () => {
    await seedWorld('w-tick-flagged-only', '2184-07-01')
    const body = JSON.parse(
      (
        await handleTimeManage(db(), {
          action: 'advance',
          world_id: 'w-tick-flagged-only',
          by: '1 month',
          hooks: ['encounter_check'],
        })
      ).content[0].text,
    )
    expect(body.tick_driver.flagged).toHaveLength(1)
    expect(body.tick_driver.flagged[0]).toHaveProperty('category')
    expect(body.tick_driver.flagged[0].category).toBe('flagged')
  })

  it('advance with mixed resolved and flagged hooks', async () => {
    await seedWorld('w-tick-mixed', '2184-07-01')
    const body = JSON.parse(
      (
        await handleTimeManage(db(), {
          action: 'advance',
          world_id: 'w-tick-mixed',
          by: '1 month',
          hooks: ['weather_update', 'encounter_check', 'health_degradation'],
        })
      ).content[0].text,
    )
    expect(body.success).toBe(true)
    expect(body.tick_driver.resolved.length).toBeGreaterThan(0)
    expect(body.tick_driver.flagged.length).toBeGreaterThan(0)
  })

  // ── New Exported Functions Tests ─────────────────────────────────────────────

  it('getCurrentDate retrieves current date for existing world', async () => {
    // Create world in worlds table first (FK constraint)
    await env.RPG_DB.prepare(
      `INSERT OR IGNORE INTO worlds (id, name, seed, width, height, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind('test-world', 'Test World', 'seed', 10, 10, now, now)
      .run()

    const r = await handleTimeManage(db(), {
      action: 'set_date',
      world_id: 'test-world',
      date: '2187-01-01T00:00:00Z',
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)

    const { getCurrentDate } = await import('@/rpg/handlers/time-manage')
    const currentDate = await getCurrentDate(env.RPG_DB, 'test-world')

    expect(currentDate).toBe('2187-01-01T00:00:00Z')
  })

  it('getCurrentDate returns null for non-existent world', async () => {
    const { getCurrentDate } = await import('@/rpg/handlers/time-manage')
    const currentDate = await getCurrentDate(env.RPG_DB, 'non-existent-world')

    expect(currentDate).toBeNull()
  })
})
