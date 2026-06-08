import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const rootDir = resolve(__dirname, '..')
const testsDir = resolve(rootDir, 'tests')

mkdirSync(testsDir, { recursive: true })

const content = readFileSync(resolve(rootDir, 'test-holmgard-mcp.Tests.ps1'), 'utf8')
const lines = content.split(/\r?\n/)

// BeforeAll ends at line 150 (0-indexed: 149)
const beforeAllStart = 0
const beforeAllEnd = 150 // exclusive

// Describe blocks with names and their start lines (1-indexed)
const describeBlocks = [
  { name: 'Core MCP Methods', start: 152 },
  { name: 'Basic Tool Operations', start: 181 },
  { name: 'Consumption Timelines', start: 210 },
  { name: 'Thread Operations', start: 222 },
  { name: 'Topic Validation', start: 229 },
  { name: 'Search Operations', start: 246 },
  { name: 'Lore CRUD Operations', start: 269 },
  { name: 'Field Increment Operations', start: 304 },
  { name: 'Patch Operations', start: 342 },
  { name: 'Batch Operations', start: 412 },
  { name: 'Resolve Interaction', start: 493 },
  { name: 'Analyze Utility', start: 545 },
  { name: 'Map Integration', start: 601 },
  { name: 'Thread Tick Operations', start: 660 },
  { name: 'Field Extraction - Bullet + Descriptor Format', start: 693 },
  { name: 'Resolve Interaction - Bullet Format Weights', start: 732 },
  { name: 'Direct-Read Tools', start: 766 },
  { name: 'Inventory Transfer Operations', start: 859 },
  { name: 'Scene Operations', start: 897 },
  { name: 'State Stage Operations', start: 956 },
  { name: 'Sensory Profile Operations', start: 985 },
  { name: 'Compatibility Operations', start: 1012 },
  { name: 'Entity Generation and Encounters', start: 1046 },
  { name: 'Location and Exit Operations', start: 1093 },
  { name: 'Append to Section Operations', start: 1123 },
  { name: 'Canonical Fixture Tests', start: 1187 },
  { name: 'Weight Integer Boundaries', start: 1258 },
  { name: 'Admin Endpoints', start: 1300 },
]

// Find end line for each block by tracking brace depth
function findBlockEnd(startLine1) {
  let depth = 0
  let inString = false
  let stringChar = ''
  let inHereString = false

  for (let i = startLine1 - 1; i < lines.length; i++) {
    const line = lines[i]
    for (let j = 0; j < line.length; j++) {
      const ch = line[j]
      const prev = j > 0 ? line[j-1] : ''

      if (inString) {
        if (ch === stringChar && prev !== '\\') inString = false
        continue
      }
      if (inHereString) {
        // Skip until '@ at start of line
        continue
      }
      if (ch === "'" || ch === '"') { inString = true; stringChar = ch; continue }

      if (ch === '{') depth++
      if (ch === '}') depth--
    }

    if (i >= startLine1 && depth === 0) {
      return i + 1 // return 1-indexed inclusive end line
    }
  }
  return lines.length
}

// Compute end lines
const blocks = describeBlocks.map(b => ({
  name: b.name,
  start: b.start,
  end: findBlockEnd(b.start),
}))

console.log('Blocks found:')
for (const b of blocks) {
  console.log(`  ${b.name}: ${b.start}-${b.end} (${b.end - b.start + 1} lines)`)
}

// File grouping (map of output filename -> block names)
const grouping = {
  'protocol': ['Core MCP Methods', 'Basic Tool Operations'],
  'timeline': ['Consumption Timelines', 'Thread Operations'],
  'crud': ['Topic Validation', 'Search Operations', 'Lore CRUD Operations'],
  'mutations': ['Field Increment Operations', 'Patch Operations', 'Batch Operations'],
  'resolve': ['Resolve Interaction', 'Resolve Interaction - Bullet Format Weights'],
  'analysis': ['Analyze Utility', 'Map Integration'],
  'thread-tick': ['Thread Tick Operations'],
  'field-extraction': ['Field Extraction - Bullet + Descriptor Format'],
  'entities': ['Direct-Read Tools', 'Entity Generation and Encounters', 'Compatibility Operations', 'Location and Exit Operations'],
  'inventory': ['Inventory Transfer Operations'],
  'scenes': ['Scene Operations', 'State Stage Operations'],
  'sensory': ['Sensory Profile Operations'],
  'narrative': ['Append to Section Operations'],
  'fixtures': ['Canonical Fixture Tests', 'Weight Integer Boundaries'],
  'admin': ['Admin Endpoints'],
}

// Write each group to its own file
for (const [filename, blockNames] of Object.entries(grouping)) {
  let output = '. $PSScriptRoot\\common.ps1\n\n'

  for (const name of blockNames) {
    const block = blocks.find(b => b.name === name)
    if (!block) {
      console.error(`MISSING block: ${name}`)
      continue
    }
    const blockLines = lines.slice(block.start - 1, block.end)
    output += blockLines.join('\n') + '\n\n'
  }

  const filepath = resolve(testsDir, `${filename}.Tests.ps1`)
  writeFileSync(filepath, output, 'utf8')
  console.log(`Wrote ${filepath}`)
}

console.log('\nDone. Split into ' + Object.keys(grouping).length + ' files.')