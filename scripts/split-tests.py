import re
import sys

with open('src/__tests__/worker.test.ts', 'r', encoding='utf-8') as f:
    content = f.read()

lines = content.split('\n')
total = len(lines)
print(f'Total lines: {total}')

# Top-level describe start lines from grep (0-indexed)
block_starts = [
    (41,  'JSON-RPC protocol'),
    (164, 'ping_tool'),
    (174, 'check_authentication'),
    (196, 'list_topics'),
    (222, 'list_maps'),
    (266, 'get_lore'),
    (290, 'get_lore_batch'),
    (305, 'get_lore_batch legacy bare method'),
    (333, 'set_lore'),
    (349, 'delete_lore'),
    (360, 'search_lore'),
    (393, 'validate_topic_exists'),
    (423, 'list_consumption_timelines'),
    (482, 'list_active_threads'),
    (509, 'increment_topic_field'),
    (575, 'patch_lore — replace'),
    (611, 'patch_lore — replace with ambiguous target'),
    (625, 'patch_lore — append'),
    (652, 'patch_lore — delete_field'),
    (676, 'patch_lore — parameter validation'),
    (720, 'admin endpoints'),
    (781, 'restore_lore'),
    (861, 'batch_set_lore'),
    (924, 'batch_mutate'),
    (1041, 'list_consumption_timelines — Projected-Consumption-Timeline fallback'),
    (1069, 'batch_mutate — content[0].text summary'),
    (1111, 'increment_topic_field — field not present in text'),
    (1138, 'batch_set_lore + batch_mutate integration'),
    (1174, 'resolve_interaction'),
    (1351, 'field extraction — bullet-style and float formats'),
    (1416, 'extractRawField — bullet-style format'),
    (1431, 'analyze_utility'),
    (1651, 'map_integration'),
    (1765, 'thread_tick'),
    (1853, 'legacy bare methods (pre-tools/call)'),
    (1879, 'get_relationship'),
    (1910, 'get_faction_standing'),
    (1936, 'get_entity_knowledge'),
    (1955, 'get_location_occupants'),
    (1984, 'get_reachable_locations'),
    (2012, 'sense_environment'),
    (2031, 'get_inventory'),
    (2050, 'transfer_item'),
    (2084, 'activate_scene'),
    (2105, 'present_choices'),
    (2128, 'commit_choice'),
    (2150, 'get_choice_history'),
    (2169, 'advance_state_stage'),
    (2225, 'process_stage_batch'),
    (2247, 'generate_entity'),
    (2273, 'roll_encounter'),
    (2302, 'get_thread_comparison'),
    (2324, 'check_convergence'),
    (2345, 'get_sensory_profile'),
    (2393, 'get_compatibility'),
    (2425, 'canonical fixture — entity:subject-alpha (active Stage-2-of-4)'),
    (2546, 'canonical fixture — entity:actor-primary (predator/driver, Weight-1:85)'),
    (2627, 'canonical fixture — entity:subject-beta (Stage-3-of-4, modified-consciousness)'),
    (2701, 'canonical fixture — location:transit-hub-north (YAML exits + encounter table)'),
    (2775, 'canonical fixture — scene:threshold-discovery (YAML choice tree)'),
    (2830, 'canonical fixture — faction:processing-guild (hierarchy + standing system)'),
    (2895, 'canonical fixture — thread comparison: primary vs secondary processing cycle'),
    (2955, 'canonical fixture — template:standard-subject as generate_entity archetype'),
    (3001, 'canonical fixture — sensory profile with Temperature-Range and Scent-Profile field names'),
    (3042, 'canonical fixture — get_location_occupants with entity: prefix keys'),
    (3067, 'canonical fixture — integer weight boundary values (5 min, 95 max)'),
    (3115, 'append_event'),
    (3149, 'get_event_log'),
    (3188, 'recent_changes'),
    (3214, 'tag_topic'),
    (3249, 'find_by_tag'),
    (3285, 'bookmark_state'),
    (3311, 'world_diff'),
    (3348, 'plant_setup'),
    (3377, 'pay_off_setup'),
    (3408, 'list_unpaid_setups'),
    (3439, 'set_goal'),
    (3475, 'check_continuity'),
    (3508, 'scene_brief'),
    (3550, 'render_pov'),
    (3592, 'get_lore_section'),
    (3780, 'append_to_section'),
    (3980, 'move_entity'),
    (4018, '/admin/gc'),
    (4073, 'roll_encounter parseEncounterTable'),
]

# Find end of each block by tracking brace depth, ignoring braces in strings/templates
def find_block_end(lines, start):
    depth = 0
    in_string = False
    string_char = ''
    in_template = False
    i = start
    while i < len(lines):
        line = lines[i]
        j = 0
        while j < len(line):
            ch = line[j]
            prev = line[j-1] if j > 0 else ''
            
            if in_string:
                if ch == string_char and prev != '\\':
                    in_string = False
            elif in_template:
                if ch == '`' and prev != '\\':
                    in_template = False
            else:
                if ch in '"\'':
                    in_string = True
                    string_char = ch
                elif ch == '`':
                    in_template = True
                elif ch == '{':
                    depth += 1
                elif ch == '}':
                    depth -= 1
            j += 1
        if i > start and depth == 0:
            return i
        i += 1
    return len(lines) - 1

blocks = []
for s, n in block_starts:
    e = find_block_end(lines, s)
    blocks.append({'name': n, 'start': s, 'end': e})
    print(f"  {n}: lines {s}-{e}")

lookup = {b['name']: b for b in blocks}

# File groupings
import_header = """\
import { describe, rpc, callTool, callToolWithApiKey, seedKV, ADMIN_SECRET, parseEncounterTable } from './helpers'
import { SELF, env } from 'cloudflare:test'
import { expect, it, beforeEach } from 'vitest'

"""

basics_header = """\
import { describe, rpc, callTool, callToolWithApiKey, seedKV, ADMIN_SECRET } from './helpers'
import { SELF, env } from 'cloudflare:test'
import { expect, it, beforeEach } from 'vitest'

"""

file_map = {
    'protocol-basics': (True, ['JSON-RPC protocol', 'ping_tool', 'check_authentication']),
    'crud': (False, ['list_topics', 'list_maps', 'get_lore', 'get_lore_batch', 'get_lore_batch legacy bare method', 'set_lore', 'delete_lore', 'search_lore', 'validate_topic_exists', 'restore_lore']),
    'mutations': (False, ['patch_lore — replace', 'patch_lore — replace with ambiguous target', 'patch_lore — append', 'patch_lore — delete_field', 'patch_lore — parameter validation', 'batch_set_lore', 'batch_mutate', 'batch_mutate — content[0].text summary', 'batch_set_lore + batch_mutate integration']),
    'admin': (False, ['admin endpoints']),
    'timelines': (False, ['list_consumption_timelines', 'list_consumption_timelines — Projected-Consumption-Timeline fallback', 'list_active_threads']),
    'field-mutation': (False, ['increment_topic_field', 'increment_topic_field — field not present in text', 'field extraction — bullet-style and float formats', 'extractRawField — bullet-style format']),
    'resolve-interaction': (False, ['resolve_interaction']),
    'analysis': (False, ['analyze_utility', 'map_integration']),
    'threads': (False, ['thread_tick', 'get_thread_comparison', 'check_convergence']),
    'entity-queries': (False, ['get_relationship', 'get_faction_standing', 'get_entity_knowledge', 'get_location_occupants', 'get_reachable_locations', 'get_compatibility']),
    'environment': (False, ['sense_environment', 'get_sensory_profile', 'get_inventory', 'transfer_item']),
    'scene': (False, ['activate_scene', 'present_choices', 'commit_choice', 'get_choice_history', 'scene_brief', 'render_pov']),
    'state-machine': (False, ['advance_state_stage', 'process_stage_batch', 'generate_entity', 'roll_encounter']),
    'narrative': (False, ['append_event', 'get_event_log', 'recent_changes', 'tag_topic', 'find_by_tag', 'bookmark_state', 'world_diff']),
    'setups': (False, ['plant_setup', 'pay_off_setup', 'list_unpaid_setups']),
    'goals': (False, ['set_goal', 'check_continuity']),
    'lore-section': (False, ['get_lore_section', 'append_to_section']),
    'move': (False, ['move_entity']),
    'legacy': (False, ['legacy bare methods (pre-tools/call)']),
    'fixtures-entity-alpha': (False, ['canonical fixture — entity:subject-alpha (active Stage-2-of-4)']),
    'fixtures-entity-actor': (False, ['canonical fixture — entity:actor-primary (predator/driver, Weight-1:85)']),
    'fixtures-entity-beta': (False, ['canonical fixture — entity:subject-beta (Stage-3-of-4, modified-consciousness)']),
    'fixtures-location': (False, ['canonical fixture — location:transit-hub-north (YAML exits + encounter table)']),
    'fixtures-scene': (False, ['canonical fixture — scene:threshold-discovery (YAML choice tree)']),
    'fixtures-faction': (False, ['canonical fixture — faction:processing-guild (hierarchy + standing system)']),
    'fixtures-thread': (False, ['canonical fixture — thread comparison: primary vs secondary processing cycle']),
    'fixtures-template': (False, ['canonical fixture — template:standard-subject as generate_entity archetype']),
    'fixtures-sensory': (False, ['canonical fixture — sensory profile with Temperature-Range and Scent-Profile field names']),
    'fixtures-occupants': (False, ['canonical fixture — get_location_occupants with entity: prefix keys']),
    'fixtures-weights': (False, ['canonical fixture — integer weight boundary values (5 min, 95 max)']),
    'encounter-table': (False, ['roll_encounter parseEncounterTable']),
}

for fname, (is_basics, block_names) in file_map.items():
    header = basics_header if is_basics else import_header
    out = header
    for name in block_names:
        if name not in lookup:
            print(f"  MISSING: '{name}' in {fname}", file=sys.stderr)
            continue
        b = lookup[name]
        block_lines = '\n'.join(lines[b['start']:b['end']+1])
        out += block_lines + '\n\n'
    
    path = f'src/__tests__/{fname}.test.ts'
    with open(path, 'w', encoding='utf-8', newline='\n') as f:
        f.write(out)
    print(f"Wrote {path}")