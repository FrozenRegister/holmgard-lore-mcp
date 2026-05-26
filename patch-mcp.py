"""
patch-mcp.py — Apply lore history + changelog to holmgard-lore-mcp/src/index.ts
Run from repo root: python3 patch-mcp.py
"""
import sys

TARGET = 'src/index.ts'
with open(TARGET, 'r') as f:
    src = f.read()
applied = []

def replace_once(label, old, new):
    global src
    if old not in src:
        print(f'[FAIL] Pattern not found: {label}')
        sys.exit(1)
    src = src.replace(old, new, 1)
    applied.append(label)
    print(f'[OK]  {label}')

# 1. HISTORY_DEPTH + changelog constants
replace_once('constants',
    'const HISTORY_DEPTH = 5',
    "const HISTORY_DEPTH = 20\nconst CHANGELOG_KEY = '_changelog'\nconst CHANGELOG_MAX = 500")

# 2. kvList KV branch
replace_once('kvList KV branch',
    "          if (!k.name.startsWith('_history:')) keys.push(k.name)",
    "          if (!k.name.startsWith('_history:') && k.name !== CHANGELOG_KEY) keys.push(k.name)")

# 3. kvList in-memory branch
replace_once('kvList in-memory branch',
    "  return Object.keys(loreDB).filter(k => !k.startsWith('_history:'))",
    "  return Object.keys(loreDB).filter(k => !k.startsWith('_history:') && k !== CHANGELOG_KEY)")

# 4. appendChangelog helper (inserted before Lore entry helpers)
APPEND_CHANGELOG = """
// Appends a write event to _changelog so the editor can do delta-only syncs.
// Each entry: { key, version, updatedAt, op }. Rolls off after CHANGELOG_MAX.
async function appendChangelog(c: any, key: string, version: number, op = 'write'): Promise<void> {
  const kv = getKV(c)
  if (!kv) return
  let entries: Array<{ key: string; version: number; updatedAt: string; op: string }> = []
  try {
    const existing = await kv.get(CHANGELOG_KEY)
    if (existing) entries = JSON.parse(existing)
  } catch {}
  entries.push({ key, version, updatedAt: new Date().toISOString(), op })
  if (entries.length > CHANGELOG_MAX) entries = entries.slice(-CHANGELOG_MAX)
  await kv.put(CHANGELOG_KEY, JSON.stringify(entries))
}

"""
replace_once('appendChangelog helper',
    '// ── Lore entry helpers ────────────────────────────────────────────────────────',
    APPEND_CHANGELOG + '// ── Lore entry helpers ────────────────────────────────────────────────────────')

# 5. set_lore
replace_once('set_lore',
    "      await kvPut(c, key, payload)\n      loreDB[key] = text",
    "      await kvPut(c, key, payload)\n      await appendChangelog(c, key, version)\n      loreDB[key] = text")

# 6. delete_lore
replace_once('delete_lore',
    "      const deleted = await kvDelete(c, key)\n      delete loreDB[key]",
    "      const deleted = await kvDelete(c, key)\n      if (deleted) await appendChangelog(c, key, 0, 'delete')\n      delete loreDB[key]")

# 7. increment_topic_field
replace_once('increment_topic_field',
    "      await kvPut(c, key, payload)\n      loreDB[key] = updatedText\n      return c.json(makeResult(id, { content: [{ type: 'text', text: `Incremented",
    "      await kvPut(c, key, payload)\n      await appendChangelog(c, key, version)\n      loreDB[key] = updatedText\n      return c.json(makeResult(id, { content: [{ type: 'text', text: `Incremented")

# 8. patch_lore
replace_once('patch_lore',
    "      await kvPut(c, key, payload)\n      loreDB[key] = updatedText\n      return c.json(makeResult(id, { content: [{ type: 'text', text: successMessage",
    "      await kvPut(c, key, payload)\n      await appendChangelog(c, key, version)\n      loreDB[key] = updatedText\n      return c.json(makeResult(id, { content: [{ type: 'text', text: successMessage")

# 9. batch_set_lore
replace_once('batch_set_lore',
    "          await kvPut(c, e.key, payload)\n          loreDB[e.key] = e.text",
    "          await kvPut(c, e.key, payload)\n          await appendChangelog(c, e.key, version)\n          loreDB[e.key] = e.text")

# 10. batch_mutate increment (unique anchor: lastIncrementReason)
replace_once('batch_mutate increment',
    "          await kvPut(c, key, JSON.stringify({ text: updatedText, meta: { version, updatedAt: now, createdAt: meta.createdAt ?? now, lastIncrementReason: mut.reason ?? 'batch-mutate', lastIncrementValue: delta } }))\n          loreDB[key] = updatedText\n          mutationResults.push(",
    "          await kvPut(c, key, JSON.stringify({ text: updatedText, meta: { version, updatedAt: now, createdAt: meta.createdAt ?? now, lastIncrementReason: mut.reason ?? 'batch-mutate', lastIncrementValue: delta } }))\n          await appendChangelog(c, key, version)\n          loreDB[key] = updatedText\n          mutationResults.push(")

# 11. batch_mutate patch
replace_once('batch_mutate patch',
    "          await kvPut(c, key, JSON.stringify({ text: updatedText, meta: { version, updatedAt: now, createdAt: meta.createdAt ?? now } }))\n          loreDB[key] = updatedText\n          mutationResults.push(",
    "          await kvPut(c, key, JSON.stringify({ text: updatedText, meta: { version, updatedAt: now, createdAt: meta.createdAt ?? now } }))\n          await appendChangelog(c, key, version)\n          loreDB[key] = updatedText\n          mutationResults.push(")

# 12. resolve_interaction
replace_once('resolve_interaction',
    "            await kvPut(c, keyA, JSON.stringify({ text: updatedTextA, meta: { version, updatedAt: now, createdAt: metaA.createdAt ?? now, lastAction: actionType } }))\n            loreDB[keyA] = updatedTextA",
    "            await kvPut(c, keyA, JSON.stringify({ text: updatedTextA, meta: { version, updatedAt: now, createdAt: metaA.createdAt ?? now, lastAction: actionType } }))\n            await appendChangelog(c, keyA, version)\n            loreDB[keyA] = updatedTextA")

# 13. map_integration
replace_once('map_integration',
    "      await kvPut(c, targetKey, JSON.stringify({ text: updatedTargetText, meta: { version, updatedAt: now, createdAt: targetMeta.createdAt ?? now } }))\n      loreDB[targetKey] = updatedTargetText",
    "      await kvPut(c, targetKey, JSON.stringify({ text: updatedTargetText, meta: { version, updatedAt: now, createdAt: targetMeta.createdAt ?? now } }))\n      await appendChangelog(c, targetKey, version)\n      loreDB[targetKey] = updatedTargetText")

# 14. thread_tick
replace_once('thread_tick',
    "        await kvPut(c, entity.key, JSON.stringify({ text: updatedText, meta: { version, updatedAt: now, createdAt: entity.meta.createdAt ?? now, thread_tick: threadId } }))\n        loreDB[entity.key] = updatedText",
    "        await kvPut(c, entity.key, JSON.stringify({ text: updatedText, meta: { version, updatedAt: now, createdAt: entity.meta.createdAt ?? now, thread_tick: threadId } }))\n        await appendChangelog(c, entity.key, version)\n        loreDB[entity.key] = updatedText")

# 15. transfer_item (two keys in one shot)
replace_once('transfer_item',
    "      loreDB[fromKey] = newFromText\n      loreDB[toKey] = newToText",
    "      await Promise.all([appendChangelog(c, fromKey, fromVersion), appendChangelog(c, toKey, toVersion)])\n      loreDB[fromKey] = newFromText\n      loreDB[toKey] = newToText")

# 16. commit_choice
replace_once('commit_choice',
    "      await kvPut(c, entityKey, JSON.stringify({ text: newEntityText, meta: { version: entityVersion, updatedAt: now, createdAt: entityMeta.createdAt ?? now, last_choice: choiceId } }))\n      loreDB[entityKey] = newEntityText",
    "      await kvPut(c, entityKey, JSON.stringify({ text: newEntityText, meta: { version: entityVersion, updatedAt: now, createdAt: entityMeta.createdAt ?? now, last_choice: choiceId } }))\n      await appendChangelog(c, entityKey, entityVersion)\n      loreDB[entityKey] = newEntityText")

# 17. advance_state_stage
replace_once('advance_state_stage',
    "      await kvPut(c, entityKey, JSON.stringify({ text: updatedText, meta: { version, updatedAt: now, createdAt: meta.createdAt ?? now } }))\n      loreDB[entityKey] = updatedText\n      return c.json(makeResult(id, { content: [{ type: 'text', text: `Advancing",
    "      await kvPut(c, entityKey, JSON.stringify({ text: updatedText, meta: { version, updatedAt: now, createdAt: meta.createdAt ?? now } }))\n      await appendChangelog(c, entityKey, version)\n      loreDB[entityKey] = updatedText\n      return c.json(makeResult(id, { content: [{ type: 'text', text: `Advancing")

# 18. process_stage_batch
replace_once('process_stage_batch',
    "        await kvPut(c, key, JSON.stringify({ text: updatedText, meta: { version, updatedAt: now, createdAt: meta.createdAt ?? now } }))\n        loreDB[key] = updatedText\n        outcomes.push(",
    "        await kvPut(c, key, JSON.stringify({ text: updatedText, meta: { version, updatedAt: now, createdAt: meta.createdAt ?? now } }))\n        await appendChangelog(c, key, version)\n        loreDB[key] = updatedText\n        outcomes.push(")

# 19. /admin/set-lore
replace_once('/admin/set-lore',
    "      await kvPut(c, key, payload)\n      loreDB[key] = text\n      return c.json({ ok: true, version }, 200)",
    "      await kvPut(c, key, payload)\n      await appendChangelog(c, key, version)\n      loreDB[key] = text\n      return c.json({ ok: true, version }, 200)")

# 20. /admin/delete-lore
replace_once('/admin/delete-lore',
    "      const deleted = await kvDelete(c, key)\n      delete loreDB[key]\n      return c.json({ ok: true, source: deleted ? 'kv' : 'in-memory' }, 200)",
    "      const deleted = await kvDelete(c, key)\n      if (deleted) await appendChangelog(c, key, 0, 'delete')\n      delete loreDB[key]\n      return c.json({ ok: true, source: deleted ? 'kv' : 'in-memory' }, 200)")

# 21. GET /changes endpoint (before catch-all)
GET_CHANGES = """
// ── GET /changes ──────────────────────────────────────────────────────────────
// 1 KV read — returns write events since ?since=<ISO>. Editor uses this for
// delta-only auto-sync instead of re-fetching every topic each interval.
app.get('/changes', async (c) => {
  const since = c.req.query('since')
  const kv = getKV(c)
  let entries: Array<{ key: string; version: number; updatedAt: string; op: string }> = []
  if (kv) {
    try {
      const raw = await kv.get(CHANGELOG_KEY)
      if (raw) entries = JSON.parse(raw)
    } catch (e) { console.warn('changelog read failed', e) }
  }
  if (since) {
    const sinceMs = new Date(since).getTime()
    if (!isNaN(sinceMs)) entries = entries.filter(e => new Date(e.updatedAt).getTime() > sinceMs)
  }
  c.header('Content-Type', 'application/json')
  c.header('Cache-Control', 'no-store')
  return c.json({ changes: entries, count: entries.length, generated_at: new Date().toISOString() }, 200)
})

"""
replace_once('GET /changes endpoint',
    'app.all(',
    GET_CHANGES + 'app.all(')

with open(TARGET, 'w') as f:
    f.write(src)

print(f'\nAll {len(applied)} patches applied to {TARGET}')
