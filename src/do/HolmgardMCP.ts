// src/do/HolmgardMCP.ts — McpAgent Durable Object for Streamable HTTP transport
import { McpAgent } from 'agents/mcp'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import type { DOEnv } from '../types'
import { toolDefinitions } from '../tools/definitions'
import { toolRegistry } from '../tools/registry'
import { makeSyntheticContext } from './context-adapter'

export class HolmgardMCP extends McpAgent<DOEnv> {
  server = new Server(
    { name: 'holmgard-lore-mcp', version: '0.3.0' },
    { capabilities: { tools: {} } }
  )

  async init(): Promise<void> {
    // Return verbatim JSON Schema definitions — no round-trip through McpServer.tool()
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: toolDefinitions,
    }))

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const toolName = request.params.name
      const args = (request.params.arguments ?? {}) as Record<string, unknown>

      if (toolName === 'ping_tool') {
        return { content: [{ type: 'text' as const, text: 'pong' }], metadata: { source: 'internal' } }
      }

      if (toolName === 'check_authentication') {
        // Auth is validated at the Worker level before routing here
        return {
          content: [{ type: 'text' as const, text: 'Authenticated.' }],
          metadata: { authenticated: true },
        }
      }

      const handler = toolRegistry[toolName]
      if (!handler) {
        return {
          content: [{ type: 'text' as const, text: `Method not found: tool "${toolName}"` }],
          isError: true,
        }
      }

      const c = makeSyntheticContext(this.env)
      const response = await handler({ c: c as any, id: null, args: args as Record<string, any>, isAuthenticated: true })
      const json = await response.json() as { result?: Record<string, unknown>; error?: { message?: string } }

      if (json.error) {
        return {
          content: [{ type: 'text' as const, text: json.error.message ?? 'Error' }],
          isError: true,
        }
      }

      return json.result ?? { content: [{ type: 'text' as const, text: 'ok' }] }
    })
  }
}
