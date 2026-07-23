import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { defineAction, makeActionDispatcher } from '@/tools/types'
import type { ActionSpec, ToolHandler } from '@/tools/types'

const anyCtx = (body: unknown) => body as any

describe('makeActionDispatcher', () => {
  const echoSchema = z.object({ value: z.string().min(1) })

  const ACTION_MAP: Record<string, ActionSpec> = {
    echo: defineAction(
      echoSchema,
      async ({ c, id, args }) => c.json({ result: { value: args.value, id } }),
      {
        value: 'hello',
      },
    ),
    echo_no_example: defineAction(echoSchema, async ({ c, id, args }) =>
      c.json({ result: { value: args.value, id } }),
    ),
  }

  const dispatch = makeActionDispatcher('test_tool', ACTION_MAP)

  it('rejects missing action', async () => {
    const res = (await dispatch({
      c: { json: anyCtx } as any,
      id: '1',
      args: {},
      isAuthenticated: false,
    })) as any
    expect(res.error).toBeDefined()
    expect(res.error.message).toContain('Missing required param: action')
  })

  it('rejects non-string action', async () => {
    const res = (await dispatch({
      c: { json: anyCtx } as any,
      id: '1',
      args: { action: 7 },
      isAuthenticated: false,
    })) as any
    expect(res.error).toBeDefined()
    expect(res.error.message).toContain('Missing required param: action')
  })

  it('rejects unknown action', async () => {
    const res = (await dispatch({
      c: { json: anyCtx } as any,
      id: '1',
      args: { action: 'nope' },
      isAuthenticated: true,
    })) as any
    expect(res.error).toBeDefined()
    expect(res.error.message).toBe('Unknown action "nope"')
  })

  it('rejects invalid params and includes the example payload', async () => {
    const res = (await dispatch({
      c: { json: anyCtx } as any,
      id: '1',
      args: { action: 'echo' },
      isAuthenticated: true,
    })) as any
    expect(res.error).toBeDefined()
    expect(res.error.data.example).toEqual({ action: 'echo', value: 'hello' })
  })

  it('rejects invalid params with no example configured', async () => {
    const res = (await dispatch({
      c: { json: anyCtx } as any,
      id: '1',
      args: { action: 'echo_no_example' },
      isAuthenticated: true,
    })) as any
    expect(res.error).toBeDefined()
    expect(res.error.data.example).toBeUndefined()
  })

  it('parses once and forwards fully-typed args to the handler', async () => {
    const res = (await dispatch({
      c: { json: anyCtx } as any,
      id: 'x',
      args: { action: 'echo', value: 'hi' },
      isAuthenticated: true,
    })) as any
    expect(res.result.value).toBe('hi')
    expect(res.result.id).toBe('x')
  })

  it('supports legacy raw ToolHandler entries alongside typed ActionSpec entries', async () => {
    const legacyHandler: ToolHandler = async ({ c, id, args }) =>
      c.json({ result: { legacy: true, args, id } })
    const mixedMap: Record<string, ActionSpec | ToolHandler> = { legacy: legacyHandler }
    const mixedDispatch = makeActionDispatcher('test_tool', mixedMap)
    const res = (await mixedDispatch({
      c: { json: anyCtx } as any,
      id: 'y',
      args: { action: 'legacy', foo: 'bar' },
      isAuthenticated: true,
    })) as any
    expect(res.result.legacy).toBe(true)
    expect(res.result.args).toEqual({ foo: 'bar' })
  })
})

describe('defineAction', () => {
  it('pairs a schema and handler into an ActionSpec', () => {
    const schema = z.object({ n: z.number() })
    const handler = async ({ c, id, args }: { c: any; id: any; args: { n: number } }) =>
      c.json({ n: args.n, id })
    const spec = defineAction(schema, handler, { n: 1 })
    expect(spec.schema).toBe(schema)
    expect(spec.handler).toBe(handler)
    expect(spec.example).toEqual({ n: 1 })
  })

  it('defaults example to undefined when omitted', () => {
    const schema = z.object({ n: z.number() })
    const handler = async ({ c, id, args }: { c: any; id: any; args: { n: number } }) =>
      c.json({ n: args.n, id })
    const spec = defineAction(schema, handler)
    expect(spec.example).toBeUndefined()
  })
})
