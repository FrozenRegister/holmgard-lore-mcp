// src/do/HolmgardMCP.ts — McpAgent Durable Object for Streamable HTTP transport
import { McpAgent } from 'agents/mcp'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import type { DOEnv } from '../types'
import { toolDefinitions } from '../tools/definitions'
import { dispatchToolCall } from '../tools/dispatch'
import { coerceTransportArgs } from '../lib/coerce-transport-args'
import { normalizeParamCasing } from '../lib/normalize-param-casing'
import { makeSyntheticContext } from './context-adapter'

export class HolmgardMCP extends McpAgent<DOEnv> {
  server = new Server(
    { name: 'holmgard-lore-mcp', version: '0.3.0' },
    { capabilities: { tools: {} } },
  )

  async init(): Promise<void> {
    // Return verbatim JSON Schema definitions — no round-trip through McpServer.tool()
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: toolDefinitions,
    }))

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const toolName = request.params.name
      const args = normalizeParamCasing(
        coerceTransportArgs((request.params.arguments ?? {}) as Record<string, unknown>),
      )

      // #546 — shared dispatch decision (ping/auth_check special-casing + toolRegistry
      // lookup). Response shape (content/isError) stays transport-local — see issue #546
      // judgment call (3).
      const dispatchResult = dispatchToolCall({
        name: toolName,
        args,
        // Auth is validated at the Worker level before routing here — see src/index.ts
        // Streamable HTTP middleware. The DO never sees an unauthenticated request.
        authenticated: true,
      })

      if (dispatchResult.kind === 'short-circuit') {
        return {
          content: [dispatchResult.content],
          metadata: dispatchResult.metadata,
        }
      }

      if (dispatchResult.kind === 'not-found') {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Method not found: tool "${dispatchResult.toolName}"`,
            },
          ],
          isError: true,
        }
      }

      // dispatchResult.kind === 'handler'
      try {
        const c = makeSyntheticContext(this.env)
        const response = await dispatchResult.handler({
          c: c as any,
          id: null,
          args: args as Record<string, any>,
          isAuthenticated: true,
        })
        const json = (await response.json()) as {
          result?: Record<string, unknown>
          error?: { message?: string }
        }

        if (json.error) {
          return {
            content: [{ type: 'text' as const, text: json.error.message ?? 'Error' }],
            isError: true,
          }
        }

        return json.result ?? { content: [{ type: 'text' as const, text: 'ok' }] }
      } catch (e) {
        console.error('Unhandled error in DO tool handler', e)
        return {
          content: [
            {
              type: 'text' as const,
              text: `Internal error: ${e instanceof Error ? e.message : String(e)}`,
            },
          ],
          isError: true,
        }
      }
    })
  }
}
