import { readFileSync, writeFileSync } from 'fs'

const content = readFileSync('src/__tests__/worker.test.ts', 'utf8')
const lines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')

// All top-level describe blocks with their start lines (0-indexed)
// Found via: grep "describe('" and tracking with brace counter
const blockStarts = [
  { n: 'JSON-RPC protocol', s: 41 },
  { n: 'ping_tool', s: 164 },
  { n: 'check_authentication', s: 174 },
  { n: 'list_topics', s: 196 },
  { n: 'list_maps', s: 222 },
  { n: 'get_lore', s: 266 },
  { n: 'get_lore_batch', s: 290 },
  { n: 'get_lore_batch legacy bare method', s: 305 },
  { n: 'set_lore', s: 333 },
  { n: 'delete_lore', s: 349 },
  { n: 'search_lore', s: 360 },
  { n: 'validate_topic_exists', s: 393 },
  { n: 'list_consumption_timelines', s: 423 },
  { n: 'list_active_threads', s: 482 },
  { n: 'increment_topic_field', s: 509 },
  { n: 'patch_lore — replace', s: 575 },
  { n: 'patch_lore — replace with ambiguous target', s: 611 },
  { n: 'patch_lore — append', s: 625 },
  { n: 'patch_lore — delete_field', s: 652 },
  { n: 'patch_lore — parameter validation', s: 676 },
  { n: 'admin endpoints', s: 720 },
  { n: 'restore_lore', s: 781 },
  { n: 'batch_set_lore', s: 861 },
  { n: 'batch_mutate', s: 924 },
  { n: 'list_consumption_timelines — Projected-Consumption-Timeline fallback', s: 1041 },
  { n: 'batch_mutate — content[0].text summary', s: 1069 },
  { n: 'increment_topic_field — field not present in text', s: 1111 },
  { n: 'batch_set_lore + batch_mutate integration', s: 1138 },
  { n: 'resolve_interaction', s: 1174 },
  { n: 'field extraction — bullet-style and float formats', s: 1351 },
  { n: 'extractRawField — bullet-style format', s: 1416 },
  { n: 'analyze_utility', s: 1431 },
  { n: 'map_integration', s: 1651 },
  { n: 'thread_tick', s: 1765 },
  { n: 'legacy bare methods (pre-tools/call)', s: 1853 },
  { n: 'get_relationship', s: 1879 },
  { n: 'get_faction_standing', s: 1910 },
  { n: 'get_entity_knowledge', s: 1936 },
  { n: 'get_location_occupants', s: 1955 },
  { n: 'get_reachable_locations', s: 1984 },
  { n: 'sense_environment', s: 2012 },
  { n: 'get_inventory', s: 2031 },
  { n: 'transfer_item', s: 2050 },
  { n: 'activate_scene', s: 2084 },
  { n: 'present_choices', s: 2105 },
  { n: 'commit_choice', s: 2128 },
  { n: 'get_choice_history', s: 2150 },
  { n: 'advance_state_stage', s: 2169 },
  { n: 'process_stage_batch', s: 2225 },
  { n: 'generate_entity', s: 2247 },
  { n: 'roll_encounter', s: 2273 },
  { n: 'get_thread_comparison', s: 2302 },
  { n: 'check_convergence', s: 2324 },
  { n: 'get_sensory_profile', s: 2345 },
  { n: 'get_compatibility', s: 2393 },
  { n: 'canonical fixture — entity:subject-alpha (active Stage-2-of-4)', s: 2425 },
  { n: 'canonical fixture — entity:actor-primary (predator/driver, Weight-1:85)', s: 2546 },
  { n: 'canonical fixture — entity:subject-beta (Stage-3-of-4, modified-consciousness)', s: 2627 },
  { n: 'canonical fixture — location:transit-hub-north (YAML exits + encounter table)', s: 2701 },
  { n: 'canonical fixture — scene:threshold-discovery (YAML choice tree)', s: 2775 },
  { n: 'canonical fixture — faction:processing-guild (hierarchy + standing system)', s: 2830 },
  { n: 'canonical fixture — thread comparison: primary vs secondary processing cycle', s: 2895 },
  { n: 'canonical fixture — template:standard-subject as generate_entity archetype', s: 2955 },
  { n: 'canonical fixture — sensory profile with Temperature-Range and Scent-Profile field names', s: 3001 },
  { n: 'canonical fixture — get_location_occupants with entity: prefix keys', s: 3042 },
  { n: 'canonical fixture — integer weight boundary values (5 min, 95 max)', s: 3067 },
  { n: 'append_event', s: 3115 },
  { n: 'get_event_log', s: 3149 },
  { n: 'recent_changes', s: 3188 },
  { n: 'tag_topic', s: 3214 },
  { n: 'find_by_tag', s: 3249 },
  { n: 'bookmark_state', s: 3285 },
  { n: 'world_diff', s: 3311 },
  { n: 'plant_setup', s: 3348 },
  { n: 'pay_off_setup', s: 3377 },
  { n: 'list_unpaid_setups', s: 3408 },
  { n: 'set_goal', s: 3439 },
  { n: 'check_continuity', s: 3475 },
  { n: 'scene_brief', s: 3508 },
  { n: 'render_pov', s: 3550 },
  { n: 'get_lore_section', s: 3592 },
  { n: 'append_to_section', s: 3780 },
  { n: 'move_entity', s: 3980 },
  { n: '/admin/gc', s: 4018 },
  { n: 'roll_encounter parseEncounterTable', s: 4073 },
]

// Find end lines by scanning for closing `})` at column 0
// For inner nested describes, we need to count braces properly.
// Strategy: after each block start, scan forward tracking brace depth
// (counting all braces), closing when depth returns to 0.
function findBlockEnd(startLine, lines) {
  let depth = 0
  let inTemplate = false
  let inString = false
  let stringChar = ''
  
  for (let i = startLine; i < lines.length; i++) {
    const line = lines[i]
    for (let j = 0; j < line.length; j++) {
      const ch = line[j]
      const prev = j > 0 ? line[j-1] : ''
      
      if (inString) {
        if (ch === stringChar && prev !== '\\') inString = false
        continue
      }
      if (inTemplate) {
        if (ch === '`' && prev !== '\\') inTemplate = false
        continue
      }
      
      if (ch === '"' || ch === "'") { inString = true; stringChar = ch; continue }
      if (ch === '`') { inTemplate = true; continue }
      
      if (ch === '{') depth++
      if (ch === '}') depth--
    }
    
    if (i > startLine && depth === 0) return i
  }
  return lines.length - 1
}

// Build blocks with computed end lines
const blocks = blockStarts.map(b => ({
  name: b.n,
  start: b.s,
  end: findBlockEnd(b.s, lines),
}))

// Find and fix end for the admin endpoints block (it has nested describes)
// The admin endpoints block has /admin/set-lore and /admin/delete-lore nested describes
// Let it close naturally at the end of the outer block

const blockLookup = {}
for (const b of blocks) {
  blockLookup[b.name] = b
  console.log(`${b.name}: ${b.start}-${b.end}`)
}

const importHeader = `import { describe, rpc, callTool, callToolWithApiKey, seedKV, ADMIN_SECRET, parseEncounterTable } from './helpers'
import { SELF } from 'cloudflare:test'
import { expect } from 'vitest'

`

const basicsHeader = `import { describe, rpc, callTool, callToolWithApiKey, seedKV, ADMIN_SECRET } from './helpers'
import { SELF } from 'cloudflare:test'
import { expect } from 'vitest'

`

const fileMap = {
  'protocol-basics': ['JSON-RPC protocol', 'ping_tool', 'check_authentication'],
  'crud': [
    'list_topics', 'list_maps', 'get_lore', 'get_lore_batch',
    'get_lore_batch legacy bare method', 'set_lore', 'delete_lore',
    'search_lore', 'validate_topic_exists', 'restore_lore',
  ],
  'mutations': [
    'patch_lore — replace', 'patch_lore — replace with ambiguous target',
    'patch_lore — append', 'patch_lore — delete_field',
    'patch_lore — parameter validation', 'batch_set_lore', 'batch_mutate',
    'batch_mutate — content[0].text summary',
    'batch_set_lore + batch_mutate integration',
  ],
  'admin': ['admin endpoints'],
  'timelines': [
    'list_consumption_timelines',
    'list_consumption_timelines — Projected-Consumption-Timeline fallback',
    'list_active_threads',
  ],
  'field-mutation': [
    'increment_topic_field',
    'increment_topic_field — field not present in text',
    'field extraction — bullet-style and float formats',
    'extractRawField — bullet-style format',
  ],
  'resolve-interaction': ['resolve_interaction'],
  'analysis': ['analyze_utility', 'map_integration'],
  'threads': ['thread_tick', 'get_thread_comparison', 'check_convergence'],
  'entity-queries': [
    'get_relationship', 'get_faction_standing', 'get_entity_knowledge',
    'get_location_occupants', 'get_reachable_locations', 'get_compatibility',
  ],
  'environment': [
    'sense_environment', 'get_sensory_profile', 'get_inventory', 'transfer_item',
  ],
  'scene': [
    'activate_scene', 'present_choices', 'commit_choice', 'get_choice_history',
    'scene_brief', 'render_pov',
  ],
  'state-machine': [
    'advance_state_stage', 'process_stage_batch', 'generate_entity', 'roll_encounter',
  ],
  'narrative': [
    'append_event', 'get_event_log', 'recent_changes', 'tag_topic', 'find_by_tag',
    'bookmark_state', 'world_diff',
  ],
  'setups': ['plant_setup', 'pay_off_setup', 'list_unpaid_setups'],
  'goals': ['set_goal', 'check_continuity'],
  'lore-section': ['get_lore_section', 'append_to_section'],
  'move': ['move_entity'],
  'legacy': ['legacy bare methods (pre-tools/call)'],
  'fixtures-entity-alpha': ['canonical fixture — entity:subject-alpha (active Stage-2-of-4)'],
  'fixtures-entity-actor': ['canonical fixture — entity:actor-primary (predator/driver, Weight-1:85)'],
  'fixtures-entity-beta': ['canonical fixture — entity:subject-beta (Stage-3-of-4, modified-consciousness)'],
  'fixtures-location': ['canonical fixture — location:transit-hub-north (YAML exits + encounter table)'],
  'fixtures-scene': ['canonical fixture — scene:threshold-discovery (YAML choice tree)'],
  'fixtures-faction': ['canonical fixture — faction:processing-guild (hierarchy + standing system)'],
  'fixtures-thread': ['canonical fixture — thread comparison: primary vs secondary processing cycle'],
  'fixtures-template': ['canonical fixture — template:standard-subject as generate_entity archetype'],
  'fixtures-sensory': ['canonical fixture — sensory profile with Temperature-Range and Scent-Profile field names'],
  'fixtures-occupants': ['canonical fixture — get_location_occupants with entity: prefix keys'],
  'fixtures-weights': ['canonical fixture — integer weight boundary values (5 min, 95 max)'],
  'encounter-table': ['roll_encounter parseEncounterTable'],
}

for (const [fileName, blockNames] of Object.entries(fileMap)) {
  const isBasics = fileName === 'protocol-basics'
  let output = isBasics ? basicsHeader : importHeader

  for (const name of blockNames) {
    const block = blockLookup[name]
    if (!block) {
      console.error(`MISSING: ${name}`)
      continue
    }
    const blockLines = lines.slice(block.start, block.end + 1)
    output += blockLines.join('\n') + '\n\n'
  }

  writeFileSync(`src/__tests__/${fileName}.test.ts`, output)
  console.log(`Wrote ${fileName}.test.ts`)
}