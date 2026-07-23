export const BASE_URL =
  process.env.LIVE_BASE_URL ?? 'https://holmgard-lore-mcp.frozenregister.workers.dev'

export const MCP_API_KEY = process.env.MCP_API_KEY ?? ''
export const ADMIN_SECRET = process.env.ADMIN_SECRET ?? ''

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function rpc(method: string, params: Record<string, unknown> = {}): Promise<any> {
  const toolName = String((params as Record<string, unknown>)?.name ?? method)
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${BASE_URL}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': MCP_API_KEY },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    })
    const text = await res.text()
    if (!res.ok) {
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)))
        continue
      }
      throw new Error(`HTTP ${res.status} for ${toolName}: ${text.slice(0, 200)}`)
    }
    try {
      return JSON.parse(text)
    } catch {
      throw new Error(`Invalid JSON for ${toolName}: ${text.slice(0, 200)}`)
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function tool(name: string, args: Record<string, unknown> = {}): Promise<any> {
  return rpc('tools/call', { name, arguments: args })
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function adminPost(endpoint: string, body: Record<string, unknown>): Promise<any> {
  const res = await fetch(`${BASE_URL}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Api-Key': MCP_API_KEY },
    body: JSON.stringify({ ...body, secret: ADMIN_SECRET }),
  })
  return res.json()
}

export const uid = () => Math.random().toString(36).slice(2, 8)

export const setLore = (key: string, text: string) =>
  tool('lore_manage', { action: 'set', key, text })

export const deleteLore = (...keys: string[]) =>
  Promise.all(keys.filter(Boolean).map((k) => tool('lore_manage', { action: 'delete', key: k })))
