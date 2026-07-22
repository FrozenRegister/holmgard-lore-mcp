// Shared response helpers for all RPG tool handlers

export type McpResponse = { content: Array<{ type: 'text'; text: string }> }

export const ok = (data: unknown): McpResponse => ({
  content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
})

export const err = (message: string, extra?: Record<string, unknown>): McpResponse => ({
  content: [
    { type: 'text' as const, text: JSON.stringify({ error: true, message, ...extra }, null, 2) },
  ],
})
