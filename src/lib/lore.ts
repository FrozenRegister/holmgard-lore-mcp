// src/lib/lore.ts

// Handles both the legacy plain-string format and the current { text, meta } JSON format.
export function parseKvEntry(raw: string): { text: string; meta: Record<string, unknown> } {
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed.text === 'string') {
      return { text: parsed.text, meta: parsed.meta ?? {} }
    }
  } catch {
    // Fallback: treat raw string as plain text (legacy or in-memory format)
    return { text: raw, meta: {} }
  }
  throw new Error('Invalid KV entry format: expected { text, meta } JSON')
}

// Reads a field value from lore text. Handles four formats:
//   1. Markdown bold: **Field:** val  or  - **Field (desc):** val
//   2. JSON block:    "Field": 0.9,
//   3. Loose numeric: Field: 0.9  or  # Field: value  or  - Field: value  or  Field=0.9
//   4. Returns string value from loose format when no number is found
export function extractFieldFromText(text: string, fieldPath: string): unknown {
  const escapedField = fieldPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

  // Pass 1: markdown bold (optional bullet + optional parenthetical descriptor)
  const mdRegex = new RegExp(
    `^\\s*(?:-\\s+)?\\*\\*${escapedField}(?:\\s*\\([^)]*\\))?:\\*\\*\\s*(.+?)\\s*$`,
    'im'
  )
  const mdMatch = text.match(mdRegex)
  if (mdMatch) {
    const value = mdMatch[1].trim()
    const numMatch = value.match(/^-?\d+(?:\.\d+)?/)
    if (numMatch) return parseFloat(numMatch[0])
    if (value === 'true') return true
    if (value === 'false') return false
    if (value === 'null') return null
    try { return JSON.parse(value) } catch { /* not JSON */ }
    return value
  }

  // Pass 2: JSON block  "Field": 0.9
  const jsonRegex = new RegExp(`"${escapedField}"\\s*:\\s*(-?\\d+(?:\\.\\d+)?)`, 'i')
  const jsonMatch = text.match(jsonRegex)
  if (jsonMatch) return parseFloat(jsonMatch[1])

  // Pass 3: loose line-start  Field: 0.9  or  # Field: value  or  - Field: value  or  Field=0.9
  // Anchored to line start to avoid mid-sentence false matches.
  const looseRegex = new RegExp(
    `^\\s*(?:#+\\s*)?(?:-\\s+)?${escapedField}(?:\\s*\\([^)]*\\))?\\s*[:=]\\s*(.+?)\\s*$`,
    'im'
  )
  const looseMatch = text.match(looseRegex)
  if (looseMatch) {
    const value = looseMatch[1].trim()
    const numMatch = value.match(/^-?\d+(?:\.\d+)?/)
    if (numMatch) return parseFloat(numMatch[0])
    if (value === 'true') return true
    if (value === 'false') return false
    if (value === 'null') return null
    try { return JSON.parse(value) } catch { /* not JSON */ }
    return value
  }

  // Pass 4: embedded Stage-N-of-M narrative pattern (e.g. "Status: Active, Stage-2-of-4")
  // Handles AI-written status strings that encode stage inline rather than as a discrete field.
  if (fieldPath === 'State-Stage' || fieldPath === 'State-Total') {
    const stageM = text.match(/\bStage-(\d+)(?:-of-(\d+))?\b/i)
    if (stageM) {
      if (fieldPath === 'State-Stage') return parseInt(stageM[1])
      if (fieldPath === 'State-Total' && stageM[2]) return parseInt(stageM[2])
    }
  }

  return null
}

// Replaces a field value in place (surgical slice-replace preserving prefix/format), or appends.
export function updateFieldInText(text: string, fieldPath: string, newValue: any): string {
  const escapedField = fieldPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

  // Pass 1: markdown bold (optional bullet + optional descriptor)
  const mdRegex = new RegExp(
    `^(\\s*(?:-\\s+)?\\*\\*${escapedField}(?:\\s*\\([^)]*\\))?:\\*\\*\\s*)(.+?)(\\s*)$`,
    'im'
  )
  const mdMatch = text.match(mdRegex)
  if (mdMatch) {
    return (
      text.slice(0, mdMatch.index!) +
      mdMatch[1] +
      String(newValue) +
      mdMatch[3] +
      text.slice(mdMatch.index! + mdMatch[0].length)
    )
  }

  // Pass 2: JSON block  "Field": 0.9
  const jsonRegex = new RegExp(`("${escapedField}"\\s*:\\s*)(-?\\d+(?:\\.\\d+)?)`, 'i')
  const jsonMatch = text.match(jsonRegex)
  if (jsonMatch) {
    return (
      text.slice(0, jsonMatch.index!) +
      jsonMatch[1] +
      String(newValue) +
      text.slice(jsonMatch.index! + jsonMatch[0].length)
    )
  }

  // Pass 3: loose line-start  Field: 0.9  or  # Field: value  or  - Field: value  or  Field=0.9
  const looseRegex = new RegExp(
    `(^\\s*(?:#+\\s*)?(?:-\\s+)?${escapedField}(?:\\s*\\([^)]*\\))?\\s*[:=]\\s*)(-?\\d+(?:\\.\\d+)?)`,
    'im'
  )
  const looseMatch = text.match(looseRegex)
  if (looseMatch) {
    return (
      text.slice(0, looseMatch.index!) +
      looseMatch[1] +
      String(newValue) +
      text.slice(looseMatch.index! + looseMatch[0].length)
    )
  }

  // Pass 4: embedded Stage-N-of-M — update the inline number, preserving the -of-M suffix
  if (fieldPath === 'State-Stage') {
    const stageM = text.match(/\bStage-(\d+)(-of-\d+)?\b/i)
    if (stageM) {
      return text.replace(/\bStage-(\d+)(-of-\d+)?\b/i, (_, _n, suffix) => `Stage-${newValue}${suffix ?? ''}`)
    }
  }

  // Fallback: append
  const needsSeparator = !text.endsWith('\n')
  return text + (needsSeparator ? '\n' : '') + `**${fieldPath}:** ${newValue}`
}

export function countOccurrences(haystack: string, needle: string): number {
  let count = 0; let pos = 0
  while (true) {
    const idx = haystack.indexOf(needle, pos)
    if (idx === -1) break
    count++; pos = idx + needle.length
  }
  return count
}

// Parses the system:active-narratives entry into structured thread objects.
export function extractActiveThreads(narrativeText: string): Array<any> {
  const threads: Array<any> = []
  const lines = narrativeText.split('\n')
  let currentCategory = ''
  for (const line of lines) {
    if (line.includes('**Ascension Threads')) currentCategory = 'Ascension'
    if (line.includes('**Dissolution Threads')) currentCategory = 'Dissolution'
    const threadMatch = line.match(/^\s*-\s*\*\*(\w[\w_]*)\*\*\s*(?:\((\w+)\))?/)
    if (threadMatch) {
      threads.push({
        thread_name: threadMatch[1],
        category: currentCategory,
        character: threadMatch[2] || 'unknown',
        status: 'Active'
      })
    }
  }
  return threads
}

// Normalises a Weight-1 / Weight-2 value to the [0, 1] float range the
// probability formula expects. Values > 1 are treated as a 0–100 integer
// scale and divided by 100; values already in [0, 1] pass through unchanged.
export function normalizeWeight(raw: number): number {
  return raw > 1 ? Math.min(1, raw / 100) : raw
}

// Maps tokens from a composite Sensory-Profile string to individual profile
// fields. Tokens are comma-separated; each is matched against keyword
// patterns for temperature, scent, texture, sound, and visual categories.
export function inferFromSensoryComposite(composite: string): Record<string, string | null> {
  const result: Record<string, string | null> = {
    temperature: null, scent: null, texture: null, sound_signature: null, visual_descriptors: null,
  }
  for (const token of composite.split(/[,;]+/).map(t => t.trim()).filter(Boolean)) {
    const t = token.toLowerCase()
    if (!result.temperature && /warm|hot|cold|cool|chill|heat|blooded|thermal|endotherm|ectotherm|fever/.test(t))
      result.temperature = token
    else if (!result.scent && /cortisol|adrenalin|musk|scent|odou?r|smell|pheromone|hormonal|metabolic|lactic|sweat/.test(t))
      result.scent = token
    else if (!result.texture && /tissue|density|dense|soft|firm|tender|tough|smooth|rough|texture|marbl|fat|muscle/.test(t))
      result.texture = token
    else if (!result.sound_signature && /sound|audio|growl|whisper|heartbeat|pulse|breath|vocal|silent|hum|vibrat/.test(t))
      result.sound_signature = token
    else if (!result.visual_descriptors && /visual|appear|colou?r|pigment|translucent|opaque|glow|pattern|mark|spot|stripe/.test(t))
      result.visual_descriptors = token
  }
  return result
}

// Extracts the raw string value of a field without numeric coercion.
// Pass 1: markdown bold  **Field:** value  or  - **Field (desc):** value
// Pass 2: loose line-start  Field: value  or  # Field: value  or  - Field: value  or  Field = value
// Handles AI-written lore that omits or mangles markdown bold syntax.
export function extractRawField(text: string, fieldPath: string): string | null {
  const escapedField = fieldPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

  // Pass 1: markdown bold
  const boldMatch = text.match(new RegExp(
    `^\\s*(?:-\\s+)?\\*\\*${escapedField}(?:\\s*\\([^)]*\\))?:\\*\\*\\s*(.+?)\\s*$`,
    'im'
  ))
  if (boldMatch) return boldMatch[1].trim()

  // Pass 2: loose — any line-start field separator, no bold required
  const looseMatch = text.match(new RegExp(
    `^\\s*(?:#+\\s*)?(?:-\\s+)?${escapedField}(?:\\s*\\([^)]*\\))?\\s*[:=]\\s*(.+?)\\s*$`,
    'im'
  ))
  return looseMatch ? looseMatch[1].trim() : null
}

// Extracts timeline/status/processor fields from a character lore entry.
// v0.2.0 — strengthened to match **Consumption-Timeline:** (new standard) with fallbacks.
export function extractConsumptionInfo(characterText: string): any {
  // Match **Consumption-Timeline:** first (new standard), then legacy formats
  const timelineMatch =
    characterText.match(/\*\*Consumption[- ]Timeline:\*\*\s*(.+?)(?:\n|$)/i) ||
    characterText.match(/\*\*Projected[- ]Consumption[- ]Timeline:\*\*\s*(.+?)(?:\n|$)/i)

  const statusMatch =
    characterText.match(/\*\*Status:\*\*\s*(.+?)(?:\n|$)/i) ||
    characterText.match(/Status[*-:]*\s*(.+?)(?:\n|$)/i)

  const processorMatch =
    characterText.match(/\*\*Processor:\*\*\s*(.+?)(?:\n|$)/i) ||
    characterText.match(/Processor[*-:]*\s*(.+?)(?:\n|$)/i)

  return {
    timeline_remaining: timelineMatch ? timelineMatch[1].trim() : null,
    status: statusMatch ? statusMatch[1].trim() : 'active',
    processor: processorMatch ? processorMatch[1].trim() : 'unknown'
  }
}

// Parses lore text into named sections delimited by #, ##, or ###.
// Returns sections map, not_found list, and warnings array.
export function parseLoreSections(
  text: string,
  requestedSections: string[],
  mode: 'strict' | 'loose' = 'loose'
): { sections: Record<string, string>; not_found: string[]; warnings: string[] } {
  const warnings: string[] = []
  const sections: Record<string, string> = {}
  const not_found: string[] = []

  if (requestedSections.length === 0) {
    warnings.push('no_sections_requested')
    return { sections, not_found, warnings }
  }

  function normalize(h: string): string {
    if (mode === 'loose') {
      return h.trim().replace(/\s+/g, ' ').toLowerCase().replace(/:$/, '')
    }
    return h.trim().toLowerCase()
  }

  const lines = text.split('\n')
  const headingRe = /^#{1,3}\s+(.+?)\s*$/

  const boundaries: Array<{ heading: string; lineIdx: number }> = []
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(headingRe)
    if (m) boundaries.push({ heading: m[1].trim(), lineIdx: i })
  }

  if (boundaries.length === 0) {
    warnings.push('no_sections_found')
    not_found.push(...requestedSections)
    return { sections, not_found, warnings }
  }

  // Build normalized-heading → content map; first non-empty occurrence wins for duplicates
  const sectionMap = new Map<string, string>()
  for (let i = 0; i < boundaries.length; i++) {
    const { heading, lineIdx } = boundaries[i]
    const endIdx = i + 1 < boundaries.length ? boundaries[i + 1].lineIdx : lines.length
    const content = lines.slice(lineIdx + 1, endIdx).join('\n').trim()
    const key = normalize(heading)
    if (sectionMap.has(key)) {
      warnings.push(`duplicate_section:${heading}`)
      // Upgrade from empty to non-empty if a later occurrence has content
      if (sectionMap.get(key) === '' && content !== '') {
        sectionMap.set(key, content)
      }
    } else {
      sectionMap.set(key, content)
    }
  }

  for (const req of requestedSections) {
    const found = sectionMap.get(normalize(req))
    if (found !== undefined) {
      sections[req] = found
      if (found === '') warnings.push(`empty_section:${req}`)
    } else {
      not_found.push(req)
    }
  }

  return { sections, not_found, warnings }
}

// Applies a section-targeted insert to lore text. Returns the mutated text and
// metadata, or an error object. No KV I/O — pure text transformation.
export function applyAppendToSection(
  text: string,
  sectionName: string,
  insertText: string,
  position: 'end' | 'start',
  autoCreate: boolean
):
  | { ok: true; mutatedText: string; action: 'appended' | 'prepended' | 'created' | 'replaced_empty'; warnings: string[] }
  | { ok: false; error: string; section?: string; hint?: string } {
  function normSec(h: string): string {
    return h.trim().replace(/\s+/g, ' ').toLowerCase().replace(/:$/, '')
  }
  // Join two text fragments, inserting a single space only when both boundary
  // characters are non-whitespace (avoids double-space or merged words).
  function joinAtBoundary(left: string, right: string): string {
    if (!left || !right) return left + right
    const lc = left[left.length - 1]
    const rc = right[0]
    if (/\S/.test(lc) && /\S/.test(rc)) return left + ' ' + right
    return left + right
  }

  const normalizedTarget = normSec(sectionName)

  // Locate all ## headings. headingEnd is the position of the '\n' that ends the
  // heading line — we search from m.index so trailing \s in \s*$ can't swallow it.
  const headingRe = /^##\s+(.+?)\s*$/gm
  const headings: Array<{ heading: string; start: number; headingEnd: number }> = []
  let m: RegExpExecArray | null
  while ((m = headingRe.exec(text)) !== null) {
    const nlPos = text.indexOf('\n', m.index)
    headings.push({ heading: m[1].trim(), start: m.index, headingEnd: nlPos === -1 ? text.length : nlPos })
  }

  // Find first matching heading; count duplicates for the warning.
  let targetIdx = -1
  let dupCount = 0
  for (let i = 0; i < headings.length; i++) {
    if (normSec(headings[i].heading) === normalizedTarget) {
      if (targetIdx === -1) targetIdx = i
      dupCount++
    }
  }

  const warnings: string[] = []
  if (dupCount > 1) warnings.push('duplicate_section')

  if (targetIdx === -1) {
    if (!autoCreate) {
      return { ok: false, error: 'section_not_found', section: sectionName, hint: 'Set auto_create: true to create this section automatically.' }
    }
    const trimmedEntry = text.trimEnd()
    const newText = `${trimmedEntry}\n\n## ${sectionName}\n${insertText.trim()}\n`
    warnings.push('section_created')
    return { ok: true, mutatedText: newText, action: 'created', warnings }
  }

  const h = headings[targetIdx]
  // contentStart is the char after the \n that follows the heading line.
  const contentStart = Math.min(h.headingEnd + 1, text.length)
  const contentEnd = targetIdx + 1 < headings.length ? headings[targetIdx + 1].start : text.length
  const sectionContent = text.slice(contentStart, contentEnd)

  if (sectionContent.trim() === '') {
    // Empty section: text becomes the sole content.
    const newText = text.slice(0, contentStart) + insertText.trim() + '\n' + text.slice(contentEnd)
    return { ok: true, mutatedText: newText, action: 'replaced_empty', warnings }
  }

  let newSectionContent: string
  let action: 'appended' | 'prepended'

  if (position === 'end') {
    const trimmedContent = sectionContent.trimEnd()
    const trailingWS = sectionContent.slice(trimmedContent.length)
    newSectionContent = joinAtBoundary(trimmedContent, insertText) + trailingWS
    action = 'appended'
  } else {
    const leadingWSMatch = sectionContent.match(/^\s*/)
    const leadingWS = leadingWSMatch ? leadingWSMatch[0] : ''
    const trimmedContent = sectionContent.slice(leadingWS.length)
    newSectionContent = leadingWS + joinAtBoundary(insertText, trimmedContent)
    action = 'prepended'
  }

  const newText = text.slice(0, contentStart) + newSectionContent + text.slice(contentEnd)
  return { ok: true, mutatedText: newText, action, warnings }
}
