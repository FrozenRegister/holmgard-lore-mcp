import { readFileSync } from 'fs'

const content = readFileSync('src/__tests__/worker.test.ts', 'utf8')
const lines = content.split('\n')

// Find all top-level describe blocks
const blocks = []
let start = -1
let name = ''
let depth = 0
let inBlock = false

for (let i = 0; i < lines.length; i++) {
  const line = lines[i]

  if (!inBlock && line.includes("describe('")) {
    start = i
    const m = line.match(/describe\('([^']+)'/)
    name = m ? m[1] : `block-${i}`
    inBlock = true
    depth = 0
    // Count braces on this line
    for (const ch of line) { if (ch === '{') depth++; if (ch === '}') depth-- }
    if (depth <= 0) {
      inBlock = false
      blocks.push({ name, start, end: i })
      start = -1
    }
    continue
  }

  if (inBlock) {
    for (const ch of line) { if (ch === '{') depth++; if (ch === '}') depth-- }
    if (depth <= 0) {
      inBlock = false
      blocks.push({ name, start, end: i })
      start = -1
    }
  }
}

console.log(JSON.stringify(blocks, null, 2))
console.log('\nTotal blocks:', blocks.length)