#!/usr/bin/env node
// Folds .changelog/fragments/*.md into CHANGELOG.md's "## [Unreleased]" section,
// grouping by ### heading (Added/Changed/Fixed/...), then deletes the consumed
// fragment files. See docs/ai-automation-pipeline.md and the changelog-assemble.yml
// workflow (workflow_dispatch only — this is a deliberate human trigger, not run
// automatically on every push, since folding a large fragment backlog in one shot
// is a consequential one-time action).
//
// Usage: node scripts/assemble-changelog.mjs [--dry-run]

import { readFileSync, writeFileSync, readdirSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'

const FRAGMENTS_DIR = '.changelog/fragments'
const CHANGELOG_PATH = 'CHANGELOG.md'
const UNRELEASED_HEADING = '## [Unreleased]'

const dryRun = process.argv.includes('--dry-run')

// Real fragments in this repo aren't uniformly formatted: some start straight
// with a "### Added"-style heading (the convention going forward), some have a
// leading "# Title" or "## Title" line before the first ### heading, and some
// have no ### heading at all (just a title + bullets). None of that content is
// discarded — a leading title folds into the first (or only) section instead of
// being dropped, and a fragment with no heading at all defaults to DEFAULT_HEADING.
const DEFAULT_HEADING = '### Added'

function parseFragment(filename, text) {
  const lines = text.split('\n')
  const sections = []
  const preamble = []
  let current = null

  for (const line of lines) {
    if (/^###\s+/.test(line)) {
      current = { heading: line.trim(), lines: [] }
      sections.push(current)
    } else if (current) {
      current.lines.push(line)
    } else {
      preamble.push(line)
    }
  }

  // A fragment's own "# Title" / "## Title" line must never land in CHANGELOG.md
  // as a literal heading — that would corrupt the document's heading hierarchy
  // (a stray ## between ### Changed and ### Added reads as a new release section).
  // Demote it to a bold *list item* rather than a standalone bold paragraph —
  // markdownlint's MD036 (no-emphasis-as-heading) flags a lone bold paragraph as
  // "should have been a heading," but a bold list item reads as a normal entry.
  const demoted = preamble.map((l) => {
    const m = l.match(/^#{1,6}\s+(.+)$/)
    return m ? `- **${m[1].trim()}**` : l
  })
  const preambleText = demoted.join('\n').trim()

  if (sections.length === 0) {
    if (preambleText === '') return []
    console.log(`${filename}: no ### heading found — defaulting to "${DEFAULT_HEADING}"`)
    return [{ heading: DEFAULT_HEADING, body: preambleText }]
  }

  if (preambleText !== '') {
    console.log(
      `${filename}: folding leading title/content into its first "${sections[0].heading}" section`,
    )
    sections[0].lines.unshift('', preambleText, '')
  }

  return sections
    .map((s) => ({ heading: s.heading, body: s.lines.join('\n').trim() }))
    .filter((s) => s.body !== '')
}

// Splits the text between "## [Unreleased]" and the next "## " heading (or EOF)
// into a leading preamble (blank lines before the first ###) and an ordered list
// of { heading, content } sections, so existing order/formatting is preserved.
function splitSections(body) {
  const parts = body.split(/(?=^### )/m)
  const preamble = /^### /.test(parts[0] ?? '') ? '' : (parts.shift() ?? '')
  const sections = parts.map((p) => {
    const newlineIdx = p.indexOf('\n')
    return {
      heading: p.slice(0, newlineIdx).trim(),
      content: p.slice(newlineIdx + 1),
    }
  })
  return { preamble, sections }
}

// Normalizes every section to end with exactly one blank line, regardless of how
// its content was merged — this is what actually guarantees consistent spacing
// between sections, rather than trying to craft each insertion string exactly right.
function serialize(preamble, sections) {
  return (
    preamble + sections.map((s) => `${s.heading}\n${s.content.replace(/\s+$/, '')}\n\n`).join('')
  )
}

function main() {
  const fragmentFiles = readdirSync(FRAGMENTS_DIR)
    .filter((f) => f.endsWith('.md'))
    .sort()

  if (fragmentFiles.length === 0) {
    console.log('No pending changelog fragments.')
    return
  }

  const changelog = readFileSync(CHANGELOG_PATH, 'utf8')
  const unreleasedIdx = changelog.indexOf(UNRELEASED_HEADING)
  if (unreleasedIdx === -1) {
    throw new Error(`Could not find "${UNRELEASED_HEADING}" in ${CHANGELOG_PATH}`)
  }

  const afterUnreleased = unreleasedIdx + UNRELEASED_HEADING.length
  const nextTopHeadingMatch = changelog.slice(afterUnreleased).match(/\n## \S/)
  const unreleasedEnd = nextTopHeadingMatch
    ? afterUnreleased + nextTopHeadingMatch.index
    : changelog.length

  const head = changelog.slice(0, afterUnreleased)
  const tail = changelog.slice(unreleasedEnd)
  const { preamble, sections } = splitSections(changelog.slice(afterUnreleased, unreleasedEnd))

  const consumed = []
  const skipped = []

  for (const file of fragmentFiles) {
    const path = join(FRAGMENTS_DIR, file)
    const text = readFileSync(path, 'utf8')

    let parsed
    try {
      parsed = parseFragment(file, text)
    } catch (err) {
      console.error(`Skipping ${file}: ${err.message}`)
      skipped.push(file)
      continue
    }

    if (parsed.length === 0) {
      console.error(`Skipping ${file}: no non-empty ### section found`)
      skipped.push(file)
      continue
    }

    for (const { heading, body } of parsed) {
      const existing = sections.find((s) => s.heading === heading)
      if (existing) {
        existing.content = `${existing.content.replace(/\s+$/, '')}\n\n${body}\n\n`
      } else {
        sections.push({ heading, content: `\n${body}\n\n` })
      }
    }

    consumed.push(path)
  }

  if (consumed.length === 0) {
    console.log('No fragments could be assembled (all skipped — see errors above).')
    process.exitCode = skipped.length > 0 ? 1 : 0
    return
  }

  const newUnreleasedBody = serialize(preamble, sections)
  // Collapse across the whole document, not just the Unreleased body, so a
  // boundary between segments (e.g. Unreleased's own trailing blank line meeting
  // an empty tail at EOF) can't produce 2+ consecutive blank lines either —
  // then guarantee exactly one trailing newline, no trailing blank line.
  const newChangelog =
    (head + newUnreleasedBody + tail).replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '') + '\n'

  if (dryRun) {
    console.log(`[dry-run] Would assemble ${consumed.length} fragment(s):`)
    for (const path of consumed) console.log(`  - ${path}`)
    if (skipped.length > 0) {
      console.log(
        `[dry-run] Would leave ${skipped.length} fragment(s) in place (parse errors above):`,
      )
      for (const file of skipped) console.log(`  - ${file}`)
    }
    return
  }

  writeFileSync(CHANGELOG_PATH, newChangelog)
  for (const path of consumed) unlinkSync(path)

  console.log(`Assembled ${consumed.length} fragment(s) into ${CHANGELOG_PATH}.`)
  if (skipped.length > 0) {
    console.log(
      `Left ${skipped.length} fragment(s) in place (parse errors above) — fix and re-run:`,
    )
    for (const file of skipped) console.log(`  - ${file}`)
    process.exitCode = 1
  }
}

main()
