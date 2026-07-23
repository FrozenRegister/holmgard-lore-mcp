#!/usr/bin/env node
/**
 * Merge coverage reports from multiple shards into a single report.
 * Used by CI to combine coverage data from parallel test runs (issue #483).
 *
 * This script manually merges coverage-final.json files from all shards
 * without external dependencies.
 */
import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'

const COVERAGE_SHARDS_DIR = './coverage-shards'
const OUTPUT_DIR = './coverage'

// Ensure output directory exists
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true })
}

// Find all coverage-final.json files recursively in shard directories
const findCoverageFiles = (dir) => {
  const files = []
  const entries = fs.readdirSync(dir, { withFileTypes: true })

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      // Recursively search subdirectories
      files.push(...findCoverageFiles(fullPath))
    } else if (entry.name === 'coverage-final.json') {
      files.push(fullPath)
    }
  }

  return files
}

// Check if shards directory exists
if (!fs.existsSync(COVERAGE_SHARDS_DIR)) {
  console.error(`Coverage shards directory not found: ${COVERAGE_SHARDS_DIR}`)
  process.exit(1)
}

const coverageFiles = findCoverageFiles(COVERAGE_SHARDS_DIR)

if (coverageFiles.length === 0) {
  console.error(`No coverage-final.json files found in ${COVERAGE_SHARDS_DIR}`)
  process.exit(1)
}

console.log(`Found ${coverageFiles.length} coverage file(s):`)
coverageFiles.forEach((f) => console.log(`  - ${f}`))

// Merge all coverage data
const mergedCoverage = {}

for (const coverageFile of coverageFiles) {
  try {
    const data = JSON.parse(fs.readFileSync(coverageFile, 'utf8'))

    // Merge coverage entries
    for (const [filePath, coverage] of Object.entries(data)) {
      if (!mergedCoverage[filePath]) {
        mergedCoverage[filePath] = {
          ...coverage,
          s: { ...coverage.s },
          b: { ...coverage.b },
          f: { ...coverage.f },
        }
      } else {
        // Merge statement coverage
        for (const [id, count] of Object.entries(coverage.s)) {
          mergedCoverage[filePath].s[id] = (mergedCoverage[filePath].s[id] || 0) + count
        }
        // Merge branch coverage
        for (const [id, branches] of Object.entries(coverage.b)) {
          if (!mergedCoverage[filePath].b[id]) {
            mergedCoverage[filePath].b[id] = [...branches]
          } else {
            for (let i = 0; i < branches.length; i++) {
              mergedCoverage[filePath].b[id][i] = (mergedCoverage[filePath].b[id][i] || 0) + branches[i]
            }
          }
        }
        // Merge function coverage
        for (const [id, count] of Object.entries(coverage.f)) {
          mergedCoverage[filePath].f[id] = (mergedCoverage[filePath].f[id] || 0) + count
        }
      }
    }
  } catch (err) {
    console.error(`Error reading ${coverageFile}:`, err.message)
    process.exit(1)
  }
}

// Write merged coverage
const outputFile = path.join(OUTPUT_DIR, 'coverage-final.json')
fs.writeFileSync(outputFile, JSON.stringify(mergedCoverage, null, 2))
console.log(`✓ Merged coverage written to ${outputFile}`)

// Generate lcov report using Istanbul if available
try {
  // Try to use nyc or istanbul if available
  const reportFile = path.join(OUTPUT_DIR, 'lcov.info')

  // Use node modules from vitest
  const nycCmd = `npx nyc report --reporter=lcov --reporter=json-summary --reporter=text --report-dir=${OUTPUT_DIR} --temp-dir=${OUTPUT_DIR}`
  console.log(`Generating reports with nyc...`)

  // Create a minimal .nycrc to point to our coverage directory
  const nycConfig = {
    'report-dir': OUTPUT_DIR,
    'temp-dir': OUTPUT_DIR,
    'all': false,
    'reporter': ['lcov', 'json-summary', 'text'],
  }
  fs.writeFileSync('.nycrc.json', JSON.stringify(nycConfig, null, 2))

  try {
    execSync(`npx nyc report --reporter=lcov --reporter=json-summary --reporter=text --temp-dir=${OUTPUT_DIR}`, {
      stdio: 'inherit',
    })
    console.log('✓ Reports generated successfully')
  } catch {
    // If nyc fails, at least we have the merged coverage-final.json
    console.warn('⚠ nyc report generation failed, but merged coverage-final.json is available')
  } finally {
    // Clean up the temp config
    if (fs.existsSync('.nycrc.json')) {
      fs.unlinkSync('.nycrc.json')
    }
  }
} catch (err) {
  console.warn('⚠ Could not generate reports:', err.message)
}

console.log(`✓ Coverage merged successfully from ${coverageFiles.length} shard(s)`)
