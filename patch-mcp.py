"""
patch-mcp.py — Idempotent, whitespace-flexible patch for holmgard-lore-mcp/src/index.ts
Run from repo root: python patch-mcp.py

Matching is whitespace-insensitive: any run of spaces/tabs/newlines in the
search pattern matches any run in the file, so indentation differences never
cause a miss.

Each patch:
  [SKIP] — new text already present (already applied, safe to re-run)
  [OK]   — old text found and replaced
  [WARN] — neither found (genuine mismatch, needs manual fix)
"""
import sys, re

TARGET = 'src/index.ts'

with open(TARGET, 'rb') as f:
    raw = f.read()

crlf = b'\r\n' in raw
src = raw.replace(b'\r\n', b'\n').decode('utf-8')

applied = skipped = warned = 0

def make_pattern(s):
    tokens = s.split()
    if not tokens:
        return re.escape(s)
    return r'\s+'.join(re.escape(t) for t in tokens)

def patch(label, old, new):
    global src, applied, skipped, warned
    old_pat = make_pattern(old)
    new_pat = make_pattern(new)
    if re.search(new_pat, src):
        print(f'[SKIP] Already applied:       {label}')
        skipped += 1
    elif re.search(old_pat, src):
        src = re.sub(old_pat, lambda m: new.lstrip(), src, count=1)
        print(f'[OK]   Applied:               {label}')
        applied += 1
    else:
        print(f'[WARN] Pattern not found:     {label}')
        warned += 1

# 1
patch('constants',
    'const HISTORY_DEPTH = 5',
    "const HISTORY_DEPTH = 20\nconst CHANGELOG_KEY = '_changelog'\nconst CHANGELOG_MAX = 500")

# 2
patch('kvList KV branch',
    "if (!k.name.startsWith('_history:')) keys.push(k.name)",
    "if (!k.name.startsWith('_history:') && k.name !== CHANGELOG_KEY) keys.push(k.name)")

# 3
patch('kvList in-memory branch',
    "return Object.keys(loreDB).filter(k => !k.startsWith('_history:'))",
    "return Object.keys(loreDB).filter(k => !k.startsWith('_history:') && k !== CHANGELOG_KEY)")

# 4
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
patch('appendChangelog helper',
    '// \u2500\u2500 Lore entry helpers',
    APPEND_CHANGELOG + '// \u2500\u2500 Lore entry helpers')

# 5
patch('set_lore',
    "await kvPut(c, key, payload)\n      loreDB[key] = text",
    "await kvPut(c, key, payload)\n      await appendChangelog(c, key, version)\n      loreDB[key] = text")

# 6
patch('delete_lore',
    "const deleted = await kvDelete(c, key)\n      delete loreDB[key]",
    "const deleted = await kvDelete(c, key)\n      if (deleted) await appendChangelog(c, key, 0, 'delete')\n      delete loreDB[key]")

# 7
patch('increment_topic_field',
    "await kvPut(c, key, payload)\n      loreDB[key] = updatedText\n      return c.json(makeResult(id, { content: [{ type: 'text', text: `Incremented",
    "await kvPut(c, key, payload)\n      await appendChangelog(c, key, version)\n      loreDB[key] = updatedText\n      return c.json(makeResult(id, { content: [{ type: 'text', text: `Incremented")

# 8
patch('patch_lore',
    "await kvPut(c, key, payload)\n      loreDB[key] = updatedText\n      return c.json(makeResult(id, { content: [{ type: 'text', text: successMessage",
    "await kvPut(c, key, payload)\n      await appendChangelog(c, key, version)\n      loreDB[key] = updatedText\n      return c.json(makeResult(id, { content: [{ type: 'text', text: successMessage")

# 9
patch('batch_set_lore',
    "await kvPut(c, e.key, payload)\n          loreDB[e.key] = e.text",
    "await kvPut(c, e.key, payload)\n          await appendChangelog(c, e.key, version)\n          loreDB[e.key] = e.text")

# 10 — unique anchor: lastIncrementReason only appears in batch_mutate increment
patch('batch_mutate increment',
    "lastIncrementReason: mut.reason ?? 'batch-mutate', lastIncrementValue: delta } }))\n          loreDB[key] = updatedText\n          mutationResults.push(",
    "lastIncrementReason: mut.reason ?? 'batch-mutate', lastIncrementValue: delta } }))\n          await appendChangelog(c, key, version)\n          loreDB[key] = updatedText\n          mutationResults.push(")

# 11 — unique anchor: mutationResults.push distinguishes from other kvPut blocks
patch('batch_mutate patch',
    "createdAt: meta.createdAt ?? now } }))\n          loreDB[key] = updatedText\n          mutationResults.push(",
    "createdAt: meta.createdAt ?? now } }))\n          await appendChangelog(c, key, version)\n          loreDB[key] = updatedText\n          mutationResults.push(")

# 12 — unique anchor: lastAction only appears in resolve_interaction
patch('resolve_interaction',
    "lastAction: actionType } }))\n            loreDB[keyA] = updatedTextA",
    "lastAction: actionType } }))\n            await appendChangelog(c, keyA, version)\n            loreDB[keyA] = updatedTextA")

# 13 — unique anchor: targetMeta
patch('map_integration',
    "createdAt: targetMeta.createdAt ?? now } }))\n      loreDB[targetKey] = updatedTargetText",
    "createdAt: targetMeta.createdAt ?? now } }))\n      await appendChangelog(c, targetKey, version)\n      loreDB[targetKey] = updatedTargetText")

# 14 — unique anchor: thread_tick field
patch('thread_tick',
    "thread_tick: threadId } }))\n        loreDB[entity.key] = updatedText",
    "thread_tick: threadId } }))\n        await appendChangelog(c, entity.key, version)\n        loreDB[entity.key] = updatedText")

# 15 — unique anchor: fromKey/toKey pair
patch('transfer_item',
    "loreDB[fromKey] = newFromText\n      loreDB[toKey] = newToText",
    "await Promise.all([appendChangelog(c, fromKey, fromVersion), appendChangelog(c, toKey, toVersion)])\n      loreDB[fromKey] = newFromText\n      loreDB[toKey] = newToText")

# 16 — unique anchor: last_choice
patch('commit_choice',
    "last_choice: choiceId } }))\n      loreDB[entityKey] = newEntityText",
    "last_choice: choiceId } }))\n      await appendChangelog(c, entityKey, entityVersion)\n      loreDB[entityKey] = newEntityText")

# 17 — unique anchor: entityKey + Advancing (distinguishes from process_stage_batch)
patch('advance_state_stage',
    "createdAt: meta.createdAt ?? now } }))\n      loreDB[entityKey] = updatedText\n      return c.json(makeResult(id, { content: [{ type: 'text', text: `Advancing",
    "createdAt: meta.createdAt ?? now } }))\n      await appendChangelog(c, entityKey, version)\n      loreDB[entityKey] = updatedText\n      return c.json(makeResult(id, { content: [{ type: 'text', text: `Advancing")

# 18 — unique anchor: outcomes.push
patch('process_stage_batch',
    "createdAt: meta.createdAt ?? now } }))\n        loreDB[key] = updatedText\n        outcomes.push(",
    "createdAt: meta.createdAt ?? now } }))\n        await appendChangelog(c, key, version)\n        loreDB[key] = updatedText\n        outcomes.push(")

# 19 — unique anchor: ok: true, version (admin route returns version directly)
patch('/admin/set-lore',
    "await kvPut(c, key, payload)\n      loreDB[key] = text\n      return c.json({ ok: true, version }, 200)",
    "await kvPut(c, key, payload)\n      await appendChangelog(c, key, version)\n      loreDB[key] = text\n      return c.json({ ok: true, version }, 200)")

# 20 — unique anchor: source: deleted ? 'kv'
patch('/admin/delete-lore',
    "const deleted = await kvDelete(c, key)\n      delete loreDB[key]\n      return c.json({ ok: true, source: deleted ? 'kv' : 'in-memory' }, 200)",
    "const deleted = await kvDelete(c, key)\n      if (deleted) await appendChangelog(c, key, 0, 'delete')\n      delete loreDB[key]\n      return c.json({ ok: true, source: deleted ? 'kv' : 'in-memory' }, 200)")

# 21
GET_CHANGES = """
// \u2500\u2500 GET /changes \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
// 1 KV read \u2014 returns write events since ?since=<ISO>. Editor uses this for
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
patch('GET /changes endpoint',
    'app.all(',
    GET_CHANGES + 'app.all(')

# ── Write back ────────────────────────────────────────────────────────────────
out = src.encode('utf-8')
if crlf:
    out = out.replace(b'\n', b'\r\n')

with open(TARGET, 'wb') as f:
    f.write(out)

print(f'\nDone. Applied: {applied}  Skipped (already done): {skipped}  Warnings: {warned}')
if warned:
    print('Fix the warnings above manually before committing.')
    sys.exit(1)
