import { Context } from 'hono';
import { LoreEntry } from './src/types';
import type { KVNamespace } from '@cloudflare/workers-types';

type Bindings = {
  LORE_DB: KVNamespace;
};

/**
 * Example of a modularized tool handler
 */
export const handleGetLore = async (c: Context<{ Bindings: Bindings }>, args: { query: string }) => {
  const kv = c.env.LORE_DB;
  const key = args.query.toLowerCase();
  
  const data = await kv.get<LoreEntry>(key, 'json');
  
  if (!data) {
    return {
      content: [{ type: 'text', text: `Lore not found for: ${key}` }],
      isError: true
    };
  }

  const isObject = typeof data === 'object' && data !== null;

  return {
    content: [{ type: 'text', text: isObject ? data.text : String(data) }],
    key,
    meta: isObject ? data.meta : undefined
  };
};

// Define more tools here and export them...