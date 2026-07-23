#!/usr/bin/env node
/**
 * Merge coverage reports from multiple shards into a single report.
 * Used by CI to combine coverage data from parallel test runs (issue #483).
 */
import fs from 'node:fs'
import path from 'node:path'
import { createCoverageMap } from 'istanbul-lib-coverage'
import { createReporter } from 'istanbul-lib-report'
import reports from 'istanbul-reports'

const COVERAGE_SHARDS_DIR = './coverage-shards'
const OUTPUT_DIR = './coverage'

// Ensure output directory exists
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true })
}

// Find all coverage-final.json files in shard directories
const shardDirs = fs
  .readdirSync(COVERAGE_SHARDS_DIR)
  .filter((f) => fs.statSync(path.join(COVERAGE_SHARDS_DIR, f)).isDirectory())
  .sort()

if (shardDirs.length === 0) {
  console.error('No coverage shard directories found in', COVERAGE_SHARDS_DIR)
  process.exit(1)
}

// Merge all coverage maps
const map = createCoverageMap()
for (const shardDir of shardDirs) {
  const coverageFile = path.join(COVERAGE_SHARDS_DIR, shardDir, 'coverage-final.json')
  if (!fs.existsSync(coverageFile)) {
    console.warn(`No coverage-final.json found in ${shardDir}, skipping`)
    continue
  }

  const coverage = JSON.parse(fs.readFileSync(coverageFile, 'utf8'))
  map.merge(coverage)
}

// Write merged coverage
fs.writeFileSync(
  path.join(OUTPUT_DIR, 'coverage-final.json'),
  JSON.stringify(map.toJSON(), null, 2),
)

// Generate reports
const reporter = createReporter()
reporter.addAll(['lcov', 'text', 'json-summary'])
reporter.write(map)

console.log('✓ Coverage merged successfully from', shardDirs.length, 'shards')
