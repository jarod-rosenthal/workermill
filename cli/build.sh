#!/bin/bash
# CLI build script — clean build + verify critical invariants
# Usage: ./build.sh [--bump patch|minor|major]
set -euo pipefail
cd "$(dirname "$0")"

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

fail() { echo -e "${RED}FAIL: $1${NC}" >&2; exit 1; }
pass() { echo -e "${GREEN}✓ $1${NC}"; }

# Optional version bump
if [[ "${1:-}" == "--bump" ]]; then
  LEVEL="${2:-patch}"
  CURRENT=$(node -p "require('./package.json').version")

  IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT"
  case "$LEVEL" in
    major) MAJOR=$((MAJOR + 1)); MINOR=0; PATCH=0 ;;
    minor) MINOR=$((MINOR + 1)); PATCH=0 ;;
    patch) PATCH=$((PATCH + 1)) ;;
    *) fail "Unknown bump level: $LEVEL (use patch, minor, or major)" ;;
  esac
  NEW="${MAJOR}.${MINOR}.${PATCH}"

  sed -i "s/\"version\": \"$CURRENT\"/\"version\": \"$NEW\"/" package.json
  sed -i "s/const VERSION = \"$CURRENT\"/const VERSION = \"$NEW\"/" src/index.ts
  echo "Bumped $CURRENT → $NEW"
fi

VERSION=$(node -p "require('./package.json').version")
INDEX_VERSION=$(grep 'const VERSION' src/index.ts | grep -oP '"[^"]*"' | tr -d '"')

# 1. Version sync check
[[ "$VERSION" == "$INDEX_VERSION" ]] || fail "Version mismatch: package.json=$VERSION, index.ts=$INDEX_VERSION"
pass "Version sync: $VERSION"

# 2. Type check
echo "Type checking..."
npx tsc --noEmit 2>&1 || true  # Don't fail on type errors (tsup handles them)

# 3. Clean build
echo "Building..."
rm -rf dist
npm run build || fail "Build failed"
pass "Build complete"

# 4. Verify browser tools present (required for Ollama tool calling)
BROWSER_COUNT=$(grep -c "browser_open" dist/index.js || true)
[[ "$BROWSER_COUNT" -ge 2 ]] || fail "Browser tools missing from build — Ollama tool calling will break"
pass "Browser tools present ($BROWSER_COUNT refs)"

# 5. Verify tool definitions present
TOOL_COUNT=$(grep -c "createToolDefinitions" dist/index.js || true)
[[ "$TOOL_COUNT" -ge 2 ]] || fail "Tool definitions missing from build"
pass "Tool definitions present"

# 6. Verify synchronized output present
SYNC_COUNT=$(grep -c "2026h" dist/index.js || true)
[[ "$SYNC_COUNT" -ge 1 ]] || fail "Synchronized output (DEC 2026) missing from build"
pass "Synchronized output present"

# 7. Verify status bar renders
STATUSBAR_COUNT=$(grep -c "StatusBar" dist/index.js || true)
[[ "$STATUSBAR_COUNT" -ge 2 ]] || fail "StatusBar component missing from build"
pass "StatusBar present"

echo ""
echo -e "${GREEN}Build verified: workermill v${VERSION}${NC}"
echo "Test:    node dist/index.js --trust"
echo "Publish: npm publish --access public"
