#!/usr/bin/env bash
set -e

SKIP_TESTS=false
for arg in "$@"; do
  [[ "$arg" == "--skip-tests" ]] && SKIP_TESTS=true
done

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RESET='\033[0m'

echo ""
echo -e "${YELLOW}Running pre-commit validation...${RESET}"

# [1/4] Markdown linting
echo ""
echo "[1/4] Checking markdown linting"
if ! pnpm fix:md; then
  echo -e "${RED}✗ Markdown linting failed${RESET}"
  exit 1
fi
echo -e "${GREEN}✓ Markdown linting passed${RESET}"

# [2/4] CHANGELOG.md requirement
echo ""
echo "[2/4] Checking CHANGELOG.md requirement"
STAGED=$(git diff --cached --name-only)
REQUIRES_CHANGELOG=$(echo "$STAGED" | grep -E '(src/|docs/|wrangler|CLAUDE)' || true)

if [[ -n "$REQUIRES_CHANGELOG" ]]; then
  if ! echo "$STAGED" | grep -qx 'CHANGELOG.md'; then
    echo -e "${RED}✗ CHANGELOG.md must be updated when modifying src/, docs/, or wrangler config${RESET}"
    echo "  Add an entry to CHANGELOG.md under [Unreleased]"
    exit 1
  fi
fi
echo -e "${GREEN}✓ CHANGELOG.md check passed${RESET}"

# [3/4] Docs warning
echo ""
echo "[3/4] Checking docs requirement"
HAS_SRC=$(echo "$STAGED" | grep -E '^src/' || true)
HAS_DOCS=$(echo "$STAGED" | grep -E '^docs/' || true)

if [[ -n "$HAS_SRC" && -z "$HAS_DOCS" ]]; then
  echo -e "${YELLOW}  ⚠  No docs/ file staged.${RESET}"
  echo -e "${YELLOW}     Your PR body must include a '## Documentation' section, or${RESET}"
  echo -e "${YELLOW}     add/update a file under docs/ — otherwise check-docs CI will fail.${RESET}"
fi
echo -e "${GREEN}✓ Docs check passed${RESET}"

# [4/4] Tests
echo ""
echo "[4/4] Running test suite"
if [[ "$SKIP_TESTS" == "true" ]]; then
  echo "(Tests skipped with --skip-tests flag)"
else
  if ! pnpm test; then
    echo -e "${RED}✗ Tests failed${RESET}"
    exit 1
  fi
  echo -e "${GREEN}✓ Tests passed${RESET}"
fi

echo ""
echo -e "${GREEN}All pre-commit checks passed!${RESET}"
exit 0
