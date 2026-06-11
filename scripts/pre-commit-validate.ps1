# Pre-commit validation script for Windows
# Usage: .\scripts\pre-commit-validate.ps1
# Or add to git hook: git config core.hooksPath scripts

param(
  [switch]$SkipTests = $false
)

$ErrorActionPreference = "Stop"

function Write-CheckHeader([string]$Message) {
  Write-Host ""
  Write-Host "[*] $Message" -ForegroundColor Cyan
}

function Write-Success([string]$Message) {
  Write-Host "✓ $Message" -ForegroundColor Green
}

function Write-Error([string]$Message) {
  Write-Host "✗ $Message" -ForegroundColor Red
}

Write-Host ""
Write-Host "Running pre-commit validation..." -ForegroundColor Yellow

try {
  # 1. Check markdown linting
  Write-CheckHeader "Checking markdown linting"
  $markdownResult = & pnpm fix:md 2>&1
  if ($LASTEXITCODE -ne 0) {
    Write-Error "Markdown linting failed"
    Write-Host $markdownResult
    exit 1
  }
  Write-Success "Markdown linting passed"

  # 2. Check if CHANGELOG.md should be updated
  Write-CheckHeader "Checking CHANGELOG.md requirement"
  $stagedFiles = & git diff --cached --name-only
  $requiresChangelog = $stagedFiles | Where-Object { $_ -match '(src/|docs/|wrangler|CLAUDE)' }

  if ($requiresChangelog) {
    if (-not ($stagedFiles | Where-Object { $_ -eq "CHANGELOG.md" })) {
      Write-Error "CHANGELOG.md must be updated when modifying src/, docs/, or wrangler config"
      Write-Host "  Add an entry to CHANGELOG.md under [Unreleased]"
      exit 1
    }
  }
  Write-Success "CHANGELOG.md check passed"

  # 3. Check docs requirement (mirrors check-docs CI gate)
  Write-CheckHeader "Checking docs requirement"
  $stagedFiles = & git diff --cached --name-only
  $hasSrcChanges = $stagedFiles | Where-Object { $_ -match '^src/' }
  $hasDocsFile   = $stagedFiles | Where-Object { $_ -match '^docs/' }

  if ($hasSrcChanges -and -not $hasDocsFile) {
    Write-Host "  ⚠  No docs/ file staged." -ForegroundColor Yellow
    Write-Host "     Your PR body must include a '## Documentation' section, or" -ForegroundColor Yellow
    Write-Host "     add/update a file under docs/ — otherwise check-docs CI will fail." -ForegroundColor Yellow
  }
  Write-Success "Docs check passed"

  # 4. Run tests (optional with -SkipTests flag)
  if (-not $SkipTests) {
    Write-CheckHeader "Running test suite"
    $testResult = & pnpm test 2>&1
    if ($LASTEXITCODE -ne 0) {
      Write-Error "Tests failed"
      Write-Host $testResult
      exit 1
    }
    Write-Success "Tests passed"
  }
  else {
    Write-Host "(Tests skipped with -SkipTests flag)" -ForegroundColor Gray
  }

  Write-Host ""
  Write-Host "All pre-commit checks passed!" -ForegroundColor Green
  exit 0
} catch {
  Write-Error "Pre-commit validation failed: $_"
  exit 1
}
