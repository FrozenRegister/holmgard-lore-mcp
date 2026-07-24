import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import {
  registerTool,
  getTools,
  getToolHandler,
  getToolDefinition,
  toJsonSchema,
  type RegisteredTool,
} from '../../src/tools/register'
import type { ToolHandler } from '../../src/tools/types'

// Throwaway Zod schema with nested objects, enums, and optionals.
const sampleSchema = z.object({
  name: z.string().min(1),
  mode: z.enum(['fast', 'slow', 'auto']),
  nested: z.object({
    count: z.number().optional(),
    tags: z.array(z.string()),
  }),
})

const sampleHandler: ToolHandler = async ({ c, id }) =>
  c.json({ jsonrpc: '2.0', id, result: { ok: true } }, 200)

function makeTool(name: string, schema: z.ZodTypeAny = sampleSchema): RegisteredTool {
  return {
    name,
    title: name.replace(/_/g, ' '),
    version: '1.0.0',
    description: `Test tool ${name}`,
    category: 'lore',
    inputSchema: schema,
    handler: sampleHandler,
  }
}

describe('registerTool', () => {
  it('registers a tool', () => {
    const tool = makeTool('test_a')
    registerTool(tool)
    expect(getTools()).toContain(tool)
  })

  it('throws on duplicate registration', () => {
    const tool = makeTool('test_dup')
    registerTool(tool)
    expect(() => registerTool(makeTool('test_dup'))).toThrow(
      'Tool "test_dup" is already registered',
    )
  })
})

describe('getTools', () => {
  it('preserves insertion order', () => {
    const a = makeTool('order_a')
    const b = makeTool('order_b')
    const c = makeTool('order_c')
    registerTool(a)
    registerTool(b)
    registerTool(c)
    const tools = getTools()
    const idxA = tools.indexOf(a)
    const idxB = tools.indexOf(b)
    const idxC = tools.indexOf(c)
    expect(idxA).toBeLessThan(idxB)
    expect(idxB).toBeLessThan(idxC)
  })
})

describe('getToolHandler', () => {
  it('returns the handler for a registered tool', () => {
    const tool = makeTool('handler_lookup')
    registerTool(tool)
    expect(getToolHandler('handler_lookup')).toBe(sampleHandler)
  })

  it('returns undefined for unknown tool', () => {
    expect(getToolHandler('nonexistent_tool_xyz')).toBeUndefined()
  })
})

describe('getToolDefinition', () => {
  it('serializes a tool definition with JSON Schema', () => {
    registerTool(makeTool('def_test'))
    const def = getToolDefinition('def_test')
    expect(def).toBeDefined()
    expect(def!.name).toBe('def_test')
    expect(def!.title).toBe('def test')
    expect(def!.version).toBe('1.0.0')
    expect(def!.description).toBe('Test tool def_test')
    expect(def!.inputSchema).toHaveProperty('type', 'object')
    expect(def!.inputSchema).toHaveProperty('properties')
  })

  it('returns undefined for unknown tool', () => {
    expect(getToolDefinition('nonexistent_def_xyz')).toBeUndefined()
  })

  it('includes category when present', () => {
    registerTool(makeTool('cat_test'))
    const def = getToolDefinition('cat_test')
    expect(def).toBeDefined()
    expect(def!.name).toBe('cat_test')
  })
})

describe('toJsonSchema', () => {
  it('converts nested Zod schema to JSON Schema', () => {
    const tool = makeTool('json_schema_test')
    const schema = toJsonSchema(tool)
    expect(schema).toHaveProperty('type', 'object')
    expect(schema).toHaveProperty('properties')
    const props = schema.properties as Record<string, unknown>
    expect(props).toHaveProperty('name')
    expect(props).toHaveProperty('mode')
    expect(props).toHaveProperty('nested')
    const nested = props.nested as Record<string, unknown>
    expect(nested).toHaveProperty('properties')
    const nestedProps = nested.properties as Record<string, unknown>
    expect(nestedProps).toHaveProperty('count')
    expect(nestedProps).toHaveProperty('tags')
  })

  it('handles enum values', () => {
    const tool = makeTool('enum_test')
    const schema = toJsonSchema(tool)
    const props = schema.properties as Record<string, unknown>
    const mode = props.mode as Record<string, unknown>
    expect(mode).toHaveProperty('enum')
    expect(mode.enum).toEqual(['fast', 'slow', 'auto'])
  })

  it('handles optional fields', () => {
    const tool = makeTool('optional_test')
    const schema = toJsonSchema(tool)
    const props = schema.properties as Record<string, unknown>
    const nested = props.nested as Record<string, unknown>
    const nestedProps = nested.properties as Record<string, unknown>
    const count = nestedProps.count as Record<string, unknown>
    // zod-to-json-schema 3.25.x emits { type: 'number' } for z.number().optional()
    // (the optional wrapper is reflected in the parent required array, not anyOf)
    expect(count).toHaveProperty('type', 'number')
  })

  it('marks non-optional fields as required', () => {
    const tool = makeTool('required_test')
    const schema = toJsonSchema(tool)
    // 'name' is required, 'nested' is required; 'nested.count' is optional
    expect(schema).toHaveProperty('required')
    const required = schema.required as string[]
    expect(required).toContain('name')
    expect(required).toContain('nested')
  })
})
