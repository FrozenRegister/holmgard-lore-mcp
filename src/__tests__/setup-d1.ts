// src/__tests__/setup-d1.ts
// Call setupRpgDb(env.RPG_DB) in a beforeAll block in any test that needs D1.
import schemaSQL from '../../schema/rpg-schema.sql?raw'

export async function setupRpgDb(db: D1Database): Promise<void> {
  await db.exec(schemaSQL)
}
