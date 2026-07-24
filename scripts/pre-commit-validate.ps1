# Pre-commit validation script for Windows
# Usage: .\scripts\pre-commit-validate.ps1
# Or add to git hook: git config core.hooksPath scripts
#
# Policy: this is the FAST local gate (type-check, lint, markdown, changelog fragment).
# The full test suite + coverage run in CI (~2 min). Tests are OFF by default
# here; pass -WithTests to run the full suite locally when you specifically want it.
# (-SkipTests is accepted for backward compatibility and is now a no-op, since
# tests are already skipped by default.)

param(
  [switch]$WithTests = $false,
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
  # 1. Test layout (fast — no dependencies needed, just git ls-files)
  Write-CheckHeader "Checking test file layout"
  $layoutResult = & pnpm run check:test-layout 2>&1
  if ($LASTEXITCODE -ne 0) {
    Write-Error "Test layout check failed"
    Write-Host $layoutResult
    exit 1
  }
  Write-Success "Test layout check passed"

  # 2. TypeScript type checking (fast)
  Write-CheckHeader "Checking TypeScript types"
  $typeResult = & pnpm run type-check 2>&1
  if ($LASTEXITCODE -ne 0) {
    Write-Error "Type checking failed"
    Write-Host $typeResult
    exit 1
  }
  Write-Success "Type checking passed"

  # 3. Lint (fast)
  Write-CheckHeader "Checking lint"
  $lintResult = & pnpm run lint 2>&1
  if ($LASTEXITCODE -ne 0) {
    Write-Error "Lint failed"
    Write-Host $lintResult
    exit 1
  }
  Write-Success "Lint passed"

  # 4. Check markdown linting
  Write-CheckHeader "Checking markdown linting"
  $markdownResult = & pnpm fix:md 2>&1
  if ($LASTEXITCODE -ne 0) {
    Write-Error "Markdown linting failed"
    Write-Host $markdownResult
    exit 1
  }
  Write-Success "Markdown linting passed"

  # 5. Check if a changelog fragment should be added (mirrors check-changelog CI gate)
  Write-CheckHeader "Checking changelog fragment requirement"
  $stagedFiles = & git diff --cached --name-only

  # A changelog fragment may have been added in an earlier commit on this branch
  # rather than the one currently being made (multi-commit PRs are the norm
  # here). Checking only staged files would false-fail on every later commit
  # once the fragment has already landed. Widen the check to the whole branch
  # diff against the merge-base with main, falling back to staged-only when no
  # base ref is resolvable.
  $baseRef = $null
  & git rev-parse --verify -q origin/main *> $null
  if ($LASTEXITCODE -eq 0) {
    $baseRef = (& git merge-base origin/main HEAD 2>$null)
  } else {
    & git rev-parse --verify -q main *> $null
    if ($LASTEXITCODE -eq 0) {
      $baseRef = (& git merge-base main HEAD 2>$null)
    }
  }
  $branchChanged = @()
  if ($baseRef) {
    $branchChanged = & git diff $baseRef --name-only 2>$null
  }
  $allChanged = @($stagedFiles) + @($branchChanged) | Where-Object { $_ } | Select-Object -Unique

  $requiresChangelog = $allChanged | Where-Object { $_ -match '^(src/|docs/|wrangler\.jsonc$|CLAUDE\.md$)' }

  if ($requiresChangelog) {
    if (-not ($allChanged | Where-Object { $_ -match '^\.changelog/fragments/.*\.md$' })) {
      Write-Error "A changelog fragment is required when modifying src/, docs/, wrangler.jsonc, or CLAUDE.md"
      Write-Host "  Add a file under .changelog/fragments/ (e.g. .changelog/fragments/my-feature.md)"
      exit 1
    }
  }
  Write-Success "Changelog fragment check passed"

  # 6. Check docs requirement (mirrors check-docs CI gate)
  Write-CheckHeader "Checking docs requirement"
  $hasSrcChanges = $allChanged | Where-Object { $_ -match '^src/' }
  $hasDocsFile   = $allChanged | Where-Object { $_ -match '^docs/' }

  if ($hasSrcChanges -and -not $hasDocsFile) {
    Write-Host "  ⚠  No docs/ file staged." -ForegroundColor Yellow
    Write-Host "     Your PR body must include a '## Documentation' section, or" -ForegroundColor Yellow
    Write-Host "     add/update a file under docs/ — otherwise check-docs CI will fail." -ForegroundColor Yellow
  }
  Write-Success "Docs check passed"

  # 7. Run tests (opt-in with -WithTests; the full suite + coverage otherwise run in CI)
  if ($WithTests) {
    Write-CheckHeader "Running full test suite"
    $testResult = & pnpm test 2>&1
    if ($LASTEXITCODE -ne 0) {
      Write-Error "Tests failed"
      Write-Host $testResult
      exit 1
    }
    Write-Success "Tests passed"
  }
  else {
    Write-Host "(Full test suite left to CI — pass -WithTests to run it locally)" -ForegroundColor Gray
  }

  Write-Host ""
  Write-Host "All pre-commit checks passed!" -ForegroundColor Green
  exit 0
} catch {
  Write-Error "Pre-commit validation failed: $_"
  exit 1
}
