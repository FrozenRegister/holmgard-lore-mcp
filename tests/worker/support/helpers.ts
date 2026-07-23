import { env, SELF, reset } from 'cloudflare:test'
import { beforeEach, describe as vitestDescribe } from 'vitest'

// Re-export cloudflare:test so test files can use env, SELF directly
export { env, SELF }

// vitest-pool-workers does not isolate miniflare KV between tests — module-level
// beforeEach() is called before the runner initialises and throws. Wrapping here
// means every describe block gets a beforeEach(reset) inside the runner context.
export const describe = (name: string, fn: () => void) =>
  vitestDescribe(name, () => {
    beforeEach(() => reset())
    fn()
  })

export async function rpc(method: string, params?: unknown) {
  const res = await SELF.fetch('http://example.com/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  return res.json() as Promise<any>
}

export function callTool(name: string, args: Record<string, unknown> = {}) {
  return callToolWithApiKey(name, 'test-api-key-xyz', args)
}

export async function callToolWithApiKey(
  name: string,
  apiKey: string,
  args: Record<string, unknown> = {},
) {
  const res = await SELF.fetch('http://example.com/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Api-Key': apiKey },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  })
  return res.json() as Promise<Record<string, any>>
}

// Seed KV directly — avoids writing to the worker's in-memory loreDB fallback.
export function seedKV(key: string, text: string) {
  return env.LORE_DB.put(key, JSON.stringify({ text, meta: { version: 1 } }))
}

export const ADMIN_SECRET = 'test-secret-123'

// ── roll_encounter: parseEncounterTable helper ────────────────────────────
export function parseEncounterTable(tableRaw: string): Array<{ key: string; weight: number }> {
  const entries: Array<{ key: string; weight: number }> = []
  for (const part of tableRaw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)) {
    const m = part.match(/^(.+?)\s*:\s*([\d.]+)$/)
    if (m) {
      entries.push({ key: m[1].trim(), weight: parseFloat(m[2]) })
    } else {
      entries.push({ key: part, weight: 1 })
    }
  }
  return entries
}
