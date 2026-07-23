import { describe, it, expect } from 'vitest'
import { extractActiveThreads } from '../../../src/lib/lore'

describe('extractActiveThreads', () => {
  /* ------------------------------------------------------------------ */
  /*  SCENARIO 1: Bare first names (legacy backward compatibility)       */
  /* ------------------------------------------------------------------ */
  it('captures bare first names as-is (legacy format)', () => {
    const input = `\
- **Analytical_Predation_Ascension** (Sarah):
- **Predatory_Charm_Ascension** (Morgan):
`
    const result = extractActiveThreads(input)
    expect(result).toHaveLength(2)
    expect(result[0].thread_name).toBe('Analytical_Predation_Ascension')
    expect(result[0].character).toBe('Sarah')
    expect(result[1].thread_name).toBe('Predatory_Charm_Ascension')
    expect(result[1].character).toBe('Morgan')
  })

  /* ------------------------------------------------------------------ */
  /*  SCENARIO 2: Full lore keys (single character) — THE BUG            */
  /* ------------------------------------------------------------------ */
  it('captures full lore keys with colons and dashes (single character)', () => {
    const input = `\
- **Analytical_Predation_Ascension** (character:sarah-weaver):
- **Parasitic_Assimilation_Dissolution** (character:elara-veldweaver):
`
    const result = extractActiveThreads(input)
    expect(result).toHaveLength(2)
    expect(result[0].character).toBe('character:sarah-weaver')
    expect(result[1].character).toBe('character:elara-veldweaver')
  })

  /* ------------------------------------------------------------------ */
  /*  SCENARIO 3: Full lore keys (multiple characters, comma-separated)  */
  /* ------------------------------------------------------------------ */
  it('captures full lore keys with commas and spaces (multi-character)', () => {
    const input = `\
- **Protective_Love_Dissolution** (character:finn-hartwell, character:elowen-thorne):
- **Nurturing_Dissolution_Cycle** (character:maren-velrosa-scribe, character:zira-khal):
- **Biological_Degradation_Completion** (character:lucinda-prime-livestock, character:monika-prime-livestock):
`
    const result = extractActiveThreads(input)
    expect(result).toHaveLength(3)
    expect(result[0].character).toBe('character:finn-hartwell, character:elowen-thorne')
    expect(result[1].character).toBe('character:maren-velrosa-scribe, character:zira-khal')
    expect(result[2].character).toBe(
      'character:lucinda-prime-livestock, character:monika-prime-livestock',
    )
  })

  /* ------------------------------------------------------------------ */
  /*  SCENARIO 4: Missing parenthetical — default to "unknown"           */
  /* ------------------------------------------------------------------ */
  it('defaults character to "unknown" when no parenthetical is present', () => {
    const input = `\
- **Apex_Predation_Commercial**:
- **Isolated_Predation_Ascension**:
`
    const result = extractActiveThreads(input)
    expect(result).toHaveLength(2)
    expect(result[0].character).toBe('unknown')
    expect(result[1].character).toBe('unknown')
  })

  /* ------------------------------------------------------------------ */
  /*  SCENARIO 5: Category detection (Ascension vs Dissolution)           */
  /* ------------------------------------------------------------------ */
  it('detects Ascension and Dissolution categories from section headings', () => {
    const input = `\
## Ascension Threads
- **Analytical_Predation_Ascension** (character:sarah-weaver):
- **Predatory_Charm_Ascension** (character:morgan-fugitive):
## Dissolution Threads
- **Protective_Love_Dissolution** (character:finn-hartwell):
- **Comfort_Dissolution_Cycle** (character:clara-thornwood):
`
    const result = extractActiveThreads(input)
    expect(result).toHaveLength(4)
    // First two should be Ascension
    expect(result[0].category).toBe('Ascension')
    expect(result[1].category).toBe('Ascension')
    // Last two should be Dissolution
    expect(result[2].category).toBe('Dissolution')
    expect(result[3].category).toBe('Dissolution')
  })

  /* ------------------------------------------------------------------ */
  /*  SCENARIO 6: Empty or non-thread lines are ignored gracefully        */
  /* ------------------------------------------------------------------ */
  it('ignores non-thread lines gracefully', () => {
    const input = `\
# system:active-narratives
**Status:** Real-time Campaign Tracking

## Ascension Threads
- **Apex_Predation_Commercial** (character:yvette-morningstar):

Some stray text that should be ignored.
`
    const result = extractActiveThreads(input)
    expect(result).toHaveLength(1)
    expect(result[0].thread_name).toBe('Apex_Predation_Commercial')
    expect(result[0].character).toBe('character:yvette-morningstar')
  })

  /* ------------------------------------------------------------------ */
  /*  SCENARIO 7: Real-world excerpt from system:active-narratives        */
  /* ------------------------------------------------------------------ */
  it('parses a real-world excerpt with mixed full keys and categories', () => {
    const input = `\
## Ascension Threads
- **Analytical_Predation_Ascension** (character:sarah-weaver):
- **Predatory_Charm_Ascension** (character:morgan-fugitive):
- **Isolated_Predation_Ascension** (character:molly-widow):
- **Apex_Predation_Commercial** (character:yvette-morningstar):
- **Assimilative_Scholar_Ascension** (character:nyxaris-unbirthing-mistress):
- **Commercial_Predation_Normalization** (character:gerta-velrosa-tavern):

## Dissolution Threads
- **Protective_Love_Dissolution** (character:finn-hartwell, character:elowen-thorne):
- **Parasitic_Assimilation_Dissolution** (character:elara-veldweaver):
- **Knowledge_Assimilation_Dissolution** (character:anya-velrosa):
- **Comfort_Dissolution_Cycle** (character:clara-thornwood):
- **Nurturing_Dissolution_Cycle** (character:maren-velrosa-scribe, character:zira-khal):
- **Biological_Degradation_Completion** (character:lucinda-prime-livestock, character:monika-prime-livestock):
`
    const result = extractActiveThreads(input)
    expect(result).toHaveLength(12)
    // Verify all 6 Ascension threads have full keys
    const ascension = result.slice(0, 6)
    for (const t of ascension) {
      expect(t.category).toBe('Ascension')
      expect(t.character).not.toBe('unknown')
      expect(t.character).not.toBe('character') // bug signature: truncated at colon
      expect(t.character).toContain(':')
      expect(t.status).toBe('Active')
    }
    // Verify all 6 Dissolution threads have full keys
    const dissolution = result.slice(6)
    for (const t of dissolution) {
      expect(t.category).toBe('Dissolution')
      expect(t.character).not.toBe('unknown')
      expect(t.character).not.toBe('character')
      expect(t.status).toBe('Active')
    }
    // Check specific multi-character threads
    expect(result[6].character).toBe('character:finn-hartwell, character:elowen-thorne')
    expect(result[10].character).toBe('character:maren-velrosa-scribe, character:zira-khal')
    expect(result[11].character).toBe(
      'character:lucinda-prime-livestock, character:monika-prime-livestock',
    )
  })

  /* ------------------------------------------------------------------ */
  /*  SCENARIO 8: Keys with non-ASCII characters inside parens            */
  /* ------------------------------------------------------------------ */
  it('handles underscores and extended characters in parenthetical', () => {
    const input = `- **Test_Thread** (some_entity_key):`
    const result = extractActiveThreads(input)
    expect(result[0].character).toBe('some_entity_key')
  })

  /* ------------------------------------------------------------------ */
  /*  SCENARIO 9: Empty input returns empty array                         */
  /* ------------------------------------------------------------------ */
  it('returns empty array for empty input', () => {
    expect(extractActiveThreads('')).toEqual([])
    expect(extractActiveThreads('  \n  \n')).toEqual([])
  })

  /* ------------------------------------------------------------------ */
  /*  SCENARIO 10: Thread status is always "Active" currently             */
  /* ------------------------------------------------------------------ */
  it('always reports status as Active', () => {
    const input = '- **Any_Thread** (anyone):'
    const result = extractActiveThreads(input)
    expect(result[0].status).toBe('Active')
  })
})
