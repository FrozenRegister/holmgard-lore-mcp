// src/do/HolmgardMCP.ts — McpAgent Durable Object for Streamable HTTP transport
import { McpAgent } from 'agents/mcp'
import { getCurrentAgent } from 'agents'
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

      // Auth is validated at the Worker level before routing here — a request
      // never reaches this dispatch unauthenticated, so `authenticated: true`
      // is always correct for the DO transport (unlike JSON-RPC, which computes
      // a real per-request value).
      const dispatch = dispatchToolCall(toolName, args, { authenticated: true })

      if (dispatch.kind === 'short-circuit') {
        return { content: dispatch.content, metadata: dispatch.metadata }
      }

      if (dispatch.kind === 'not-found') {
        return {
          content: [
            { type: 'text' as const, text: `Method not found: tool "${dispatch.toolName}"` },
          ],
          isError: true,
        }
      }

      try {
        // `onRequest` (base Agent class) wraps the whole request in
        // `agentContext.run({ request, ... })`, so the originating Streamable
        // HTTP request — headers included — is available here via
        // getCurrentAgent(), even though nothing was passed down explicitly.
        // Previously the synthetic context stubbed every header to `null`
        // unconditionally (#620); this restores real header reads while
        // still degrading to `null` if no request is on the async context
        // (e.g. this handler somehow ran outside onRequest).
        const { request } = getCurrentAgent()
        const c = makeSyntheticContext(this.env, request?.headers)
        const response = await dispatch.handler({
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
