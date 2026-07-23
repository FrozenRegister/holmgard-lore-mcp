#!/usr/bin/env node
/**
 * Merge coverage reports from multiple shards into a single report.
 * Used by CI to combine coverage data from parallel test runs (issue #483).
 */
import fs from 'node:fs'
import path from 'node:path'

const COVERAGE_SHARDS_DIR = './coverage-shards'
const OUTPUT_DIR = './coverage'

// Ensure output directory exists
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true })
}

// Check if shards directory exists
if (!fs.existsSync(COVERAGE_SHARDS_DIR)) {
  console.error(`Coverage shards directory not found: ${COVERAGE_SHARDS_DIR}`)
  process.exit(1)
}

// Find all coverage files
const coverageFiles = fs
  .readdirSync(COVERAGE_SHARDS_DIR)
  .filter((f) => f.startsWith('coverage-') && f.endsWith('.json'))
  .sort()

if (coverageFiles.length === 0) {
  console.error(`No coverage files found in ${COVERAGE_SHARDS_DIR}`)
  process.exit(1)
}

console.log(`Found ${coverageFiles.length} coverage file(s):`)
coverageFiles.forEach((f) => console.log(`  - ${f}`))

// Merge all coverage data
const mergedCoverage = {}

for (const coverageFile of coverageFiles) {
  const fullPath = path.join(COVERAGE_SHARDS_DIR, coverageFile)
  try {
    const data = JSON.parse(fs.readFileSync(fullPath, 'utf8'))

    // Merge coverage entries
    for (const [filePath, coverage] of Object.entries(data)) {
      if (!mergedCoverage[filePath]) {
        // First time seeing this file - deep copy the coverage
        mergedCoverage[filePath] = {
          ...coverage,
          s: { ...coverage.s },
          b: { ...coverage.b },
          f: { ...coverage.f },
        }
      } else {
        // Merge this shard's coverage with existing
        const existing = mergedCoverage[filePath]

        // Merge statement coverage - take max of any two shards (since they don't overlap)
        for (const [id, count] of Object.entries(coverage.s)) {
          existing.s[id] = Math.max(existing.s[id] || 0, count)
        }

        // Merge branch coverage - same logic
        for (const [id, branches] of Object.entries(coverage.b)) {
          if (!existing.b[id]) {
            existing.b[id] = [...branches]
          } else {
            for (let i = 0; i < branches.length; i++) {
              existing.b[id][i] = Math.max(existing.b[id][i] || 0, branches[i])
            }
          }
        }

        // Merge function coverage - same logic
        for (const [id, count] of Object.entries(coverage.f)) {
          existing.f[id] = Math.max(existing.f[id] || 0, count)
        }
      }
    }
  } catch (err) {
    console.error(`Error reading ${fullPath}:`, err.message)
    process.exit(1)
  }
}

// Write merged coverage
const outputFile = path.join(OUTPUT_DIR, 'coverage-final.json')
try {
  fs.writeFileSync(outputFile, JSON.stringify(mergedCoverage, null, 2))
  console.log(`✓ Merged coverage written to ${outputFile}`)
} catch (err) {
  console.error(`Error writing merged coverage:`, err.message)
  process.exit(1)
}

console.log(`✓ Coverage merged successfully from ${coverageFiles.length} shard(s)`)
