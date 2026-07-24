#!/usr/bin/env bash
set -e

# Policy: this is the FAST local gate (type-check, lint, markdown, changelog fragment).
# The full test suite + coverage run in CI (~2 min). Tests are OFF by default
# here; pass --with-tests to run the full suite locally when you specifically
# want it. (--skip-tests is accepted for backward compatibility and is a no-op,
# since tests are already skipped by default.)

WITH_TESTS=false
for arg in "$@"; do
  [[ "$arg" == "--with-tests" ]] && WITH_TESTS=true
done

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RESET='\033[0m'

echo ""
echo -e "${YELLOW}Running pre-commit validation...${RESET}"

# [1/7] Test layout (fast — no dependencies needed, just git ls-files)
echo ""
echo "[1/7] Checking test file layout"
if ! pnpm run check:test-layout; then
  echo -e "${RED}✗ Test layout check failed${RESET}"
  exit 1
fi
echo -e "${GREEN}✓ Test layout check passed${RESET}"

# [2/7] TypeScript type checking
echo ""
echo "[2/7] Checking TypeScript types"
if ! pnpm run type-check; then
  echo -e "${RED}✗ Type checking failed${RESET}"
  exit 1
fi
echo -e "${GREEN}✓ Type checking passed${RESET}"

# [3/7] Lint
echo ""
echo "[3/7] Checking lint"
if ! pnpm run lint; then
  echo -e "${RED}✗ Lint failed${RESET}"
  exit 1
fi
echo -e "${GREEN}✓ Lint passed${RESET}"

# [4/7] Markdown linting
echo ""
echo "[4/7] Checking markdown linting"
if ! pnpm fix:md; then
  echo -e "${RED}✗ Markdown linting failed${RESET}"
  exit 1
fi
echo -e "${GREEN}✓ Markdown linting passed${RESET}"

# [5/7] Changelog fragment requirement (mirrors check-changelog CI gate)
echo ""
echo "[5/7] Checking changelog fragment requirement"
STAGED=$(git diff --cached --name-only)

# A changelog fragment may have been added in an earlier commit on this branch
# rather than the one currently being made (multi-commit PRs are the norm
# here — see PR #550, 25 commits). Checking only $STAGED would false-fail on
# every later commit once the fragment has already landed. Widen the check to
# the whole branch diff against the merge-base with main, falling back to
# staged-only when no base ref is resolvable (e.g. a shallow clone with no
# origin/main, or committing directly on main).
BASE_REF=""
if git rev-parse --verify -q origin/main >/dev/null 2>&1; then
  BASE_REF=$(git merge-base origin/main HEAD 2>/dev/null || true)
elif git rev-parse --verify -q main >/dev/null 2>&1; then
  BASE_REF=$(git merge-base main HEAD 2>/dev/null || true)
fi
BRANCH_CHANGED=""
if [[ -n "$BASE_REF" ]]; then
  BRANCH_CHANGED=$(git diff "$BASE_REF" --name-only 2>/dev/null || true)
fi
ALL_CHANGED=$(printf '%s\n%s\n' "$STAGED" "$BRANCH_CHANGED" | sed '/^$/d' | sort -u)

REQUIRES_CHANGELOG=$(echo "$ALL_CHANGED" | grep -E '^(src/|docs/|wrangler\.jsonc$|CLAUDE\.md$)' || true)

if [[ -n "$REQUIRES_CHANGELOG" ]]; then
  if ! echo "$ALL_CHANGED" | grep -q '^\.changelog/fragments/.*\.md$'; then
    echo -e "${RED}✗ A changelog fragment is required when modifying src/, docs/, wrangler.jsonc, or CLAUDE.md${RESET}"
    echo "  Add a file under .changelog/fragments/ (e.g. .changelog/fragments/my-feature.md)"
    exit 1
  fi
fi
echo -e "${GREEN}✓ Changelog fragment check passed${RESET}"

# [6/7] Docs warning
echo ""
echo "[6/7] Checking docs requirement"
HAS_SRC=$(echo "$ALL_CHANGED" | grep -E '^src/' || true)
HAS_DOCS=$(echo "$ALL_CHANGED" | grep -E '^docs/' || true)

if [[ -n "$HAS_SRC" && -z "$HAS_DOCS" ]]; then
  echo -e "${YELLOW}  ⚠  No docs/ file staged.${RESET}"
  echo -e "${YELLOW}     Your PR body must include a '## Documentation' section, or${RESET}"
  echo -e "${YELLOW}     add/update a file under docs/ — otherwise check-docs CI will fail.${RESET}"
fi
echo -e "${GREEN}✓ Docs check passed${RESET}"

# [7/7] Tests (opt-in; the full suite + coverage otherwise run in CI)
echo ""
echo "[7/7] Running full test suite"
if [[ "$WITH_TESTS" == "true" ]]; then
  if ! pnpm test; then
    echo -e "${RED}✗ Tests failed${RESET}"
    exit 1
  fi
  echo -e "${GREEN}✓ Tests passed${RESET}"
else
  echo "(Full test suite left to CI — pass --with-tests to run it locally)"
fi

echo ""
echo -e "${GREEN}All pre-commit checks passed!${RESET}"
exit 0
