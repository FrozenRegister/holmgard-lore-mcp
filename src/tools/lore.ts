// src/tools/lore.ts
import { z } from 'zod'
import { kvGet, kvPut, kvDelete, getKV, loreDB, clearRequestCache } from '../lib/kv'
import { makeResult, makeError } from '../lib/rpc'
import {
  parseKvEntry,
  extractFieldFromText,
  updateFieldInText,
  countOccurrences,
  applyAppendToSection,
  normalizeLocationKey,
} from '../lib/lore'
import { pushHistory, appendChangelog } from '../lib/history'
import { updateIndexes } from '../lib/indexes'
import { checkForConcurrentWrite } from '../lib/concurrency'
import type { TypedToolContext } from './types'

export const setLoreSchema = z.object({
  key: z.string().min(1),
  text: z.string().min(1),
  dry_run: z.boolean().optional().default(false),
})

export async function handle_set_lore({
  c,
  id,
  args,
}: TypedToolContext<typeof setLoreSchema>): Promise<Response> {
  const key = args.key.trim().toLowerCase()
  const text = args.text

  const existingRaw = await kvGet(c, key)
  const existingMeta = existingRaw ? parseKvEntry(existingRaw).meta : {}
  const existingText = existingRaw ? parseKvEntry(existingRaw).text : null
  const version = typeof existingMeta.version === 'number' ? existingMeta.version + 1 : 1

  if (args.dry_run) {
    return c.json(
      makeResult(id, {
        content: [
          {
            type: 'text',
            text: `[DRY RUN] Would save lore for "${key}" (v${version}). No changes were written.`,
          },
        ],
        dry_run: true,
        would_change: { key, operation: 'set_lore', before: existingText, after: text, version },
      }),
      200,
    )
  }

  if (existingRaw) await pushHistory(c, key, existingRaw)

  const now = new Date().toISOString()

  const payload = JSON.stringify({
    text,
    meta: { version, updatedAt: now, createdAt: existingMeta.createdAt ?? now },
  })

  await kvPut(c, key, payload)
  await updateIndexes(c, key, text, existingText)
  await appendChangelog(c, key, version)
  loreDB[key] = text
  clearRequestCache(c)
  return c.json(
    makeResult(id, {
      content: [
        {
          type: 'text',
          text: `Lore saved for "${key}" (v${version}).`,
        },
      ],
      metadata: { key, version },
    }),
    200,
  )
}

export const deleteLoreSchema = z.object({
  key: z.string().min(1),
  dry_run: z.boolean().optional().default(false),
})

export async function handle_delete_lore({
  c,
  id,
  args,
}: TypedToolContext<typeof deleteLoreSchema>): Promise<Response> {
  const key = args.key.trim().toLowerCase()
  const existingRaw = await kvGet(c, key)
  const existingText = existingRaw ? parseKvEntry(existingRaw).text : null

  if (args.dry_run) {
    return c.json(
      makeResult(id, {
        content: [
          {
            type: 'text',
            text: `[DRY RUN] Would delete lore for "${key}". No changes were written.`,
          },
        ],
        dry_run: true,
        would_change: { key, operation: 'delete_lore', before: existingText, after: null },
      }),
      200,
    )
  }

  const deleted = await kvDelete(c, key)
  if (deleted) {
    await updateIndexes(c, key, '', existingText)
    await appendChangelog(c, key, 0, 'delete')
  }
  delete loreDB[key]
  clearRequestCache(c)
  return c.json(
    makeResult(id, {
      content: [
        {
          type: 'text',
          text: `Lore deleted for "${key}".`,
        },
      ],
      metadata: { source: deleted ? 'kv' : 'in-memory', key },
    }),
    200,
  )
}

export const patchLoreSchema = z.object({
  key: z.string().min(1),
  operation: z.string().min(1),
  target: z.string().optional(),
  value: z.string().optional(),
  dry_run: z.boolean().optional().default(false),
})

export async function handle_patch_lore({
  c,
  id,
  args,
}: TypedToolContext<typeof patchLoreSchema>): Promise<Response> {
  const key = args.key.trim().toLowerCase()
  const operation = args.operation
  const target = args.target
  const value = args.value

  if (!['replace', 'append', 'delete_field'].includes(operation)) {
    return c.json(
      makeResult(id, {
        content: [
          {
            type: 'text',
            text: `Unknown operation "${operation}". Use replace, append, or delete_field.`,
          },
        ],
      }),
      200,
    )
  }

  if ((operation === 'replace' || operation === 'delete_field') && target === undefined) {
    return c.json(
      makeResult(id, {
        content: [{ type: 'text', text: `Parameter "target" required for ${operation}.` }],
      }),
      200,
    )
  }
  if (operation === 'replace' && value === undefined) {
    return c.json(
      makeResult(id, {
        content: [{ type: 'text', text: 'Parameter "value" required for replace.' }],
      }),
      200,
    )
  }
  if (operation === 'append' && value === undefined) {
    return c.json(
      makeResult(id, {
        content: [{ type: 'text', text: 'Parameter "value" required for append.' }],
      }),
      200,
    )
  }

  const raw = await kvGet(c, key)
  if (!raw) {
    return c.json(
      makeResult(id, {
        content: [{ type: 'text', text: `Key "${key}" not found. Check list_topics.` }],
      }),
      200,
    )
  }

  const { text, meta } = parseKvEntry(raw)

  let updatedText: string
  let successMessage: string

  if (operation === 'replace') {
    const count = countOccurrences(text, target!)
    if (count === 0)
      return c.json(
        makeResult(id, {
          content: [{ type: 'text', text: `Target "${target}" not found in "${key}".` }],
        }),
        200,
      )
    if (count > 1)
      return c.json(
        makeResult(id, {
          content: [
            {
              type: 'text',
              text: `Ambiguous: target "${target}" matches ${count} times in "${key}". Use a longer or more specific target string.`,
            },
          ],
        }),
        200,
      )
    const idx = text.indexOf(target!)
    updatedText = text.slice(0, idx) + value! + text.slice(idx + target!.length)
    successMessage = `Replaced 1 occurrence of "${target}" in "${key}".`
  } else if (operation === 'append') {
    if (target !== undefined) {
      const count = countOccurrences(text, target)
      if (count === 0)
        return c.json(
          makeResult(id, {
            content: [{ type: 'text', text: `Target "${target}" not found in "${key}".` }],
          }),
          200,
        )
      if (count > 1)
        return c.json(
          makeResult(id, {
            content: [
              {
                type: 'text',
                text: `Ambiguous: target "${target}" matches ${count} times in "${key}". Use a longer or more specific target string.`,
              },
            ],
          }),
          200,
        )
      const idx = text.indexOf(target)
      updatedText = text.slice(0, idx + target.length) + value! + text.slice(idx + target.length)
      successMessage = `Appended after "${target}" in "${key}".`
    } else {
      const needsSeparator = !text.endsWith('\n') && !value!.startsWith('\n')
      updatedText = text + (needsSeparator ? '\n' : '') + value!
      successMessage = `Appended to end of "${key}".`
    }
  } else {
    // delete_field
    const count = countOccurrences(text, target!)
    if (count === 0)
      return c.json(
        makeResult(id, {
          content: [{ type: 'text', text: `Target "${target}" not found in "${key}".` }],
        }),
        200,
      )
    if (count > 1)
      return c.json(
        makeResult(id, {
          content: [
            {
              type: 'text',
              text: `Ambiguous: target "${target}" matches ${count} times in "${key}". Use a longer or more specific target string.`,
            },
          ],
        }),
        200,
      )
    const idx = text.indexOf(target!)
    updatedText = (text.slice(0, idx) + text.slice(idx + target!.length)).replace(/\n{2,}/g, '\n')
    successMessage =
      value !== undefined
        ? `Deleted 1 occurrence of "${target}" from "${key}". (Note: "value" parameter is ignored for delete_field.)`
        : `Deleted 1 occurrence of "${target}" from "${key}".`
  }

  if (args.dry_run) {
    return c.json(
      makeResult(id, {
        content: [{ type: 'text', text: `[DRY RUN] ${successMessage} No changes were written.` }],
        dry_run: true,
        would_change: {
          key,
          operation: 'patch_lore',
          patch_operation: operation,
          target: target ?? null,
          value: value ?? null,
          before: text,
          after: updatedText,
        },
      }),
      200,
    )
  }

  const baseVersion = typeof meta.version === 'number' ? meta.version : undefined
  const conflictCheck = await checkForConcurrentWrite(c, key, baseVersion)
  if (conflictCheck.conflict) {
    return c.json(
      makeError(
        id,
        -32009,
        `Concurrent modification detected on "${key}" — another write happened between read and write. Re-read the entry and retry.`,
        { key, current_version: conflictCheck.currentVersion },
      ),
      200,
    )
  }

  await pushHistory(c, key, raw)

  const now = new Date().toISOString()
  const version = typeof meta.version === 'number' ? meta.version + 1 : 1

  const payload = JSON.stringify({
    text: updatedText,
    meta: { version, updatedAt: now, createdAt: meta.createdAt ?? now },
  })

  await kvPut(c, key, payload)
  await appendChangelog(c, key, version)
  loreDB[key] = updatedText
  clearRequestCache(c)
  return c.json(
    makeResult(id, {
      content: [{ type: 'text', text: successMessage }],
      metadata: { key, version },
    }),
    200,
  )
}

export const batchSetLoreSchema = z.object({
  entries: z.array(z.object({ key: z.string().min(1), text: z.string().min(1) })).min(1),
})

export async function handle_batch_set_lore({
  c,
  id,
  args,
}: TypedToolContext<typeof batchSetLoreSchema>): Promise<Response> {
  const now = new Date().toISOString()
  const batchResults: Record<string, { ok: boolean; version?: number; error?: string }> = {}

  const cleanedEntries = args.entries.map((e) => ({ ...e, key: e.key.trim().toLowerCase() }))

  const rawValues = await Promise.all(cleanedEntries.map((e) => kvGet(c, e.key)))

  await Promise.all(
    cleanedEntries.map((e, i) =>
      rawValues[i] ? pushHistory(c, e.key, rawValues[i]!) : Promise.resolve(),
    ),
  )

  await Promise.all(
    cleanedEntries.map(async (e, i) => {
      const existingMeta = rawValues[i] ? parseKvEntry(rawValues[i]!).meta : {}
      const existingText = rawValues[i] ? parseKvEntry(rawValues[i]!).text : null
      const version = typeof existingMeta.version === 'number' ? existingMeta.version + 1 : 1
      const payload = JSON.stringify({
        text: e.text,
        meta: { version, updatedAt: now, createdAt: existingMeta.createdAt ?? now },
      })
      try {
        await kvPut(c, e.key, payload)
        await updateIndexes(c, e.key, e.text, existingText)
        await appendChangelog(c, e.key, version)
        loreDB[e.key] = e.text
        batchResults[e.key] = { ok: true, version }
      } catch (err) {
        batchResults[e.key] = { ok: false, error: String(err) }
      }
    }),
  )

  const okCount = Object.values(batchResults).filter((r) => r.ok).length
  const failCount = cleanedEntries.length - okCount
  const summaryText =
    failCount === 0
      ? `Saved ${okCount} lore entr${okCount === 1 ? 'y' : 'ies'}.`
      : `Saved ${okCount}/${cleanedEntries.length} entries. ${failCount} failed — see results.`

  clearRequestCache(c)
  return c.json(
    makeResult(id, {
      content: [{ type: 'text', text: summaryText }],
      metadata: { total: cleanedEntries.length, set_count: okCount, failed_count: failCount },
      results: batchResults,
    }),
    200,
  )
}

const mutationSchema = z.object({
  key: z.string().min(1),
  action: z.enum(['increment', 'patch']),
  field_path: z.string().optional(),
  increment: z.number().int().optional(),
  reason: z.string().optional(),
  operation: z.enum(['replace', 'append', 'delete_field']).optional(),
  target: z.string().optional(),
  value: z.string().optional(),
})
export const batchMutateSchema = z.object({ mutations: z.array(mutationSchema).min(1) })

export async function handle_batch_mutate({
  c,
  id,
  args,
}: TypedToolContext<typeof batchMutateSchema>): Promise<Response> {
  const now = new Date().toISOString()
  const mutationResults: Array<{
    key: string
    action: string
    ok: boolean
    message: string
    old_value?: any
    new_value?: any
  }> = []

  const muts = args.mutations
  const mutKeys = muts.map((m) => m.key.trim().toLowerCase())
  const mutRaws = await Promise.all(mutKeys.map((k) => kvGet(c, k)))
  // Track live text so multiple mutations to the same key compose sequentially
  const liveTexts = new Map<string, string>()

  for (let i = 0; i < muts.length; i++) {
    const mut = muts[i]
    const key = mutKeys[i]
    let raw = mutRaws[i]

    if (liveTexts.has(key)) {
      raw = JSON.stringify({ text: liveTexts.get(key)!, meta: {} })
    }

    if (!raw) {
      mutationResults.push({
        key,
        action: mut.action,
        ok: false,
        message: `Key "${key}" not found.`,
      })
      continue
    }

    const { text, meta } = parseKvEntry(raw)

    if (mut.action === 'increment') {
      if (!mut.field_path) {
        mutationResults.push({
          key,
          action: 'increment',
          ok: false,
          message: 'field_path required for increment.',
        })
        continue
      }
      const currentValue = extractFieldFromText(text, mut.field_path)
      if (typeof currentValue !== 'number') {
        mutationResults.push({
          key,
          action: 'increment',
          ok: false,
          message: `Field "${mut.field_path}" is not numeric.`,
          old_value: currentValue,
        })
        continue
      }
      const delta = mut.increment ?? 1
      const newValue = parseFloat((currentValue + delta).toPrecision(10))
      const updatedText = updateFieldInText(text, mut.field_path, newValue)
      await pushHistory(c, key, raw)
      const version = typeof meta.version === 'number' ? meta.version + 1 : 1
      await kvPut(
        c,
        key,
        JSON.stringify({
          text: updatedText,
          meta: {
            version,
            updatedAt: now,
            createdAt: meta.createdAt ?? now,
            lastIncrementReason: mut.reason ?? 'batch-mutate',
            lastIncrementValue: delta,
          },
        }),
      )
      await updateIndexes(c, key, updatedText, text)
      await appendChangelog(c, key, version)
      liveTexts.set(key, updatedText)
      loreDB[key] = updatedText
      mutationResults.push({
        key,
        action: 'increment',
        ok: true,
        message: `${mut.field_path}: ${currentValue} → ${newValue}`,
        old_value: currentValue,
        new_value: newValue,
      })
    } else {
      // patch
      if (!mut.operation) {
        mutationResults.push({
          key,
          action: 'patch',
          ok: false,
          message: 'operation required for patch.',
        })
        continue
      }
      const op = mut.operation
      const target = mut.target
      const value = mut.value

      if ((op === 'replace' || op === 'delete_field') && !target) {
        mutationResults.push({
          key,
          action: 'patch',
          ok: false,
          message: `target required for ${op}.`,
        })
        continue
      }
      if ((op === 'replace' || op === 'append') && value === undefined) {
        mutationResults.push({
          key,
          action: 'patch',
          ok: false,
          message: `value required for ${op}.`,
        })
        continue
      }

      let updatedText: string
      let msg: string

      if (op === 'replace') {
        const count = countOccurrences(text, target!)
        if (count === 0) {
          mutationResults.push({
            key,
            action: 'patch:replace',
            ok: false,
            message: `Target "${target}" not found in "${key}".`,
          })
          continue
        }
        if (count > 1) {
          mutationResults.push({
            key,
            action: 'patch:replace',
            ok: false,
            message: `Target "${target}" ambiguous (${count} matches) in "${key}".`,
          })
          continue
        }
        const idx = text.indexOf(target!)
        updatedText = text.slice(0, idx) + value! + text.slice(idx + target!.length)
        msg = `Replaced "${target}" in "${key}".`
      } else if (op === 'append') {
        if (target !== undefined) {
          const count = countOccurrences(text, target)
          if (count === 0) {
            mutationResults.push({
              key,
              action: 'patch:append',
              ok: false,
              message: `Target "${target}" not found in "${key}".`,
            })
            continue
          }
          if (count > 1) {
            mutationResults.push({
              key,
              action: 'patch:append',
              ok: false,
              message: `Target "${target}" ambiguous (${count} matches) in "${key}".`,
            })
            continue
          }
          const idx = text.indexOf(target)
          updatedText =
            text.slice(0, idx + target.length) + value! + text.slice(idx + target.length)
          msg = `Appended after "${target}" in "${key}".`
        } else {
          updatedText =
            text + (!text.endsWith('\n') && !value!.startsWith('\n') ? '\n' : '') + value!
          msg = `Appended to end of "${key}".`
        }
      } else {
        // delete_field
        const count = countOccurrences(text, target!)
        if (count === 0) {
          mutationResults.push({
            key,
            action: 'patch:delete_field',
            ok: false,
            message: `Target "${target}" not found in "${key}".`,
          })
          continue
        }
        if (count > 1) {
          mutationResults.push({
            key,
            action: 'patch:delete_field',
            ok: false,
            message: `Target "${target}" ambiguous (${count} matches) in "${key}".`,
          })
          continue
        }
        const idx = text.indexOf(target!)
        updatedText = (text.slice(0, idx) + text.slice(idx + target!.length)).replace(
          /\n{2,}/g,
          '\n',
        )
        msg = `Deleted "${target}" from "${key}".`
      }

      await pushHistory(c, key, raw)
      const version = typeof meta.version === 'number' ? meta.version + 1 : 1
      await kvPut(
        c,
        key,
        JSON.stringify({
          text: updatedText,
          meta: { version, updatedAt: now, createdAt: meta.createdAt ?? now },
        }),
      )
      await updateIndexes(c, key, updatedText, text)
      await appendChangelog(c, key, version)
      liveTexts.set(key, updatedText)
      loreDB[key] = updatedText
      mutationResults.push({ key, action: `patch:${op}`, ok: true, message: msg })
    }
  }

  const okCount = mutationResults.filter((r) => r.ok).length
  const failCount = mutationResults.length - okCount
  const summaryText =
    failCount === 0
      ? `Applied ${okCount} mutation${okCount === 1 ? '' : 's'}.`
      : `Applied ${okCount}/${mutationResults.length} mutations. ${failCount} failed — see results.`

  clearRequestCache(c)
  return c.json(
    makeResult(id, {
      content: [{ type: 'text', text: summaryText }],
      metadata: { total: mutationResults.length, ok_count: okCount, failed_count: failCount },
      results: mutationResults,
    }),
    200,
  )
}

export const restoreLoreSchema = z.object({ key: z.string().min(1) })

export async function handle_restore_lore({
  c,
  id,
  args,
}: TypedToolContext<typeof restoreLoreSchema>): Promise<Response> {
  const key = args.key.trim().toLowerCase()
  const kv = getKV(c)
  if (!kv) return c.json(makeError(id, -32603, 'KV not available', null), 200)

  const historyKey = `_history:${key}`
  let history: string[] = []
  try {
    const existing = await kv.get(historyKey)
    if (existing) history = JSON.parse(existing)
  } catch {
    return c.json(makeError(id, -32603, 'Failed to read history', null), 200)
  }

  if (history.length === 0) {
    return c.json(
      makeResult(id, {
        content: [{ type: 'text', text: `No history found for "${key}".` }],
        metadata: { key, restored: false },
      }),
      200,
    )
  }

  const previous = history.shift()!
  const currentBefore = await kv.get(key)
  const currentText = currentBefore ? parseKvEntry(currentBefore).text : null
  await kv.put(key, previous)
  const restoredText = parseKvEntry(previous).text
  loreDB[key] = restoredText
  await updateIndexes(c, key, restoredText, currentText)

  if (history.length > 0) {
    await kv.put(historyKey, JSON.stringify(history))
  } else {
    await kv.delete(historyKey)
  }

  const { meta } = parseKvEntry(previous)
  clearRequestCache(c)
  return c.json(
    makeResult(id, {
      content: [
        {
          type: 'text',
          text: `Restored "${key}" to v${meta.version ?? '?'}. ${history.length} snapshot(s) remaining.`,
        },
      ],
      metadata: {
        key,
        restored: true,
        restored_version: meta.version ?? null,
        remaining_history: history.length,
      },
    }),
    200,
  )
}

export const getTopicHistoriesSchema = z.object({ keys: z.array(z.string().min(1)).min(1) })

export async function handle_get_topic_histories({
  c,
  id,
  args,
}: TypedToolContext<typeof getTopicHistoriesSchema>): Promise<Response> {
  const keys = args.keys.map((k) => k.toLowerCase())
  const kv = getKV(c)
  if (!kv) return c.json(makeError(id, -32603, 'KV not available', null), 200)

  const histories: Record<string, Array<{ text: string; meta: Record<string, unknown> }>> = {}

  for (const key of keys) {
    try {
      const historyKey = `_history:${key}`
      const historyRaw = await kv.get(historyKey)
      const snapshots: Array<{ text: string; meta: Record<string, unknown> }> = []

      if (historyRaw) {
        const historyList: string[] = JSON.parse(historyRaw)
        for (const snapshot of historyList) {
          // parseKvEntry never throws (catches internally), so no try/catch needed here
          snapshots.push(parseKvEntry(snapshot))
        }
      }

      histories[key] = snapshots
    } catch (e) {
      console.error(`Failed to read history for ${key}:`, e)
      histories[key] = []
    }
  }

  return c.json(makeResult(id, histories), 200)
}

export const incrementTopicFieldSchema = z.object({
  key: z.string().min(1),
  field_path: z.string().min(1),
  increment: z.number().default(1),
  reason: z.string().default('system-update'),
  dry_run: z.boolean().optional().default(false),
})

export async function handle_increment_topic_field({
  c,
  id,
  args,
}: TypedToolContext<typeof incrementTopicFieldSchema>): Promise<Response> {
  const key = args.key.trim().toLowerCase()
  const raw = await kvGet(c, key)
  if (!raw) return c.json(makeError(id, -32602, `Topic "${key}" not found`, null), 200)

  const { text, meta } = parseKvEntry(raw)
  const currentValue = extractFieldFromText(text, args.field_path)

  if (typeof currentValue !== 'number') {
    return c.json(
      makeError(id, -32602, `Field "${args.field_path}" is not numeric`, { current: currentValue }),
      200,
    )
  }

  const newValue = parseFloat((currentValue + args.increment).toPrecision(10))
  const updatedText = updateFieldInText(text, args.field_path, newValue)

  if (args.dry_run) {
    return c.json(
      makeResult(id, {
        content: [
          {
            type: 'text',
            text: `[DRY RUN] Would increment ${args.field_path} from ${currentValue} to ${newValue}. No changes were written.`,
          },
        ],
        dry_run: true,
        would_change: {
          key,
          operation: 'increment_topic_field',
          field_path: args.field_path,
          before: currentValue,
          after: newValue,
        },
      }),
      200,
    )
  }

  const baseVersion = typeof meta.version === 'number' ? meta.version : undefined
  const conflictCheck = await checkForConcurrentWrite(c, key, baseVersion)
  if (conflictCheck.conflict) {
    return c.json(
      makeError(
        id,
        -32009,
        `Concurrent modification detected on "${key}" — another write happened between read and write. Re-read the entry and retry.`,
        { key, current_version: conflictCheck.currentVersion },
      ),
      200,
    )
  }

  await pushHistory(c, key, raw)

  const now = new Date().toISOString()
  const version = typeof meta.version === 'number' ? meta.version + 1 : 1

  const payload = JSON.stringify({
    text: updatedText,
    meta: {
      version,
      updatedAt: now,
      createdAt: meta.createdAt ?? now,
      lastIncrementReason: args.reason,
      lastIncrementValue: args.increment,
    },
  })

  await kvPut(c, key, payload)
  await appendChangelog(c, key, version)
  loreDB[key] = updatedText
  clearRequestCache(c)
  return c.json(
    makeResult(id, {
      content: [
        {
          type: 'text',
          text: `Incremented ${args.field_path} from ${currentValue} to ${newValue} (reason: ${args.reason})`,
        },
      ],
      metadata: {
        key,
        version,
        field_path: args.field_path,
        old_value: currentValue,
        new_value: newValue,
      },
    }),
    200,
  )
}

export const appendToSectionSchema = z.object({
  key: z.string().min(1),
  section: z.string().min(1),
  text: z.string(),
  position: z.enum(['end', 'start']).default('end'),
  auto_create: z.boolean().default(true),
})

export async function handle_append_to_section({
  c,
  id,
  args,
}: TypedToolContext<typeof appendToSectionSchema>): Promise<Response> {
  const { section, position, auto_create: autoCreate } = args
  const insertText = args.text
  const key = args.key.trim().toLowerCase()

  if (!insertText.trim()) {
    return c.json(
      makeResult(id, {
        content: [{ type: 'text', text: 'Cannot append empty text.' }],
        error: 'empty_text',
        message: 'Cannot append empty text.',
      }),
      200,
    )
  }

  const raw = await kvGet(c, key)
  if (!raw) {
    return c.json(
      makeResult(id, {
        content: [{ type: 'text', text: `Key "${key}" not found.` }],
        error: 'key_not_found',
        key,
      }),
      200,
    )
  }

  const { text, meta } = parseKvEntry(raw)
  const oldLen = text.length

  const mutResult = applyAppendToSection(text, section, insertText, position, autoCreate)

  if (!mutResult.ok) {
    return c.json(
      makeResult(id, {
        content: [{ type: 'text', text: `Section "${section}" not found in "${key}".` }],
        ...mutResult,
      }),
      200,
    )
  }

  const { mutatedText, action, warnings } = mutResult
  const bytesAdded = mutatedText.length - oldLen

  await pushHistory(c, key, raw)

  const now = new Date().toISOString()
  const version = typeof meta.version === 'number' ? meta.version + 1 : 1
  const payload = JSON.stringify({
    text: mutatedText,
    meta: { version, updatedAt: now, createdAt: meta.createdAt ?? now },
  })

  await kvPut(c, key, payload)
  await appendChangelog(c, key, version)
  loreDB[key] = mutatedText
  clearRequestCache(c)

  return c.json(
    makeResult(id, {
      content: [{ type: 'text', text: `${action}: "${section}" in "${key}" (v${version}).` }],
      key,
      section,
      action,
      position,
      new_version: version,
      bytes_added: bytesAdded,
      warnings,
    }),
    200,
  )
}

export const moveEntitySchema = z.object({
  entity_key: z.string().min(1),
  new_location_key: z.string().min(1),
})

export async function handle_move_entity({
  c,
  id,
  args,
}: TypedToolContext<typeof moveEntitySchema>): Promise<Response> {
  const key = args.entity_key.trim().toLowerCase()
  const rawLoc = args.new_location_key.trim().toLowerCase()
  // #371: Normalize location string to canonical key before writing
  const newLoc = normalizeLocationKey(rawLoc)
  const raw = await kvGet(c, key)
  if (!raw) return c.json(makeError(id, -32602, `Entity "${key}" not found`, null), 200)

  const { text, meta } = parseKvEntry(raw)
  const oldText = text
  const updatedText = updateFieldInText(text, 'Location', newLoc)

  await pushHistory(c, key, raw)
  const now = new Date().toISOString()
  const version = typeof meta.version === 'number' ? meta.version + 1 : 1
  await kvPut(
    c,
    key,
    JSON.stringify({
      text: updatedText,
      meta: { version, updatedAt: now, createdAt: meta.createdAt ?? now },
    }),
  )
  await updateIndexes(c, key, updatedText, oldText)
  await appendChangelog(c, key, version)
  loreDB[key] = updatedText
  clearRequestCache(c)

  return c.json(
    makeResult(id, {
      content: [{ type: 'text', text: `Moved "${key}" to "${newLoc}".` }],
      metadata: { key, new_location: newLoc, version },
    }),
    200,
  )
}
