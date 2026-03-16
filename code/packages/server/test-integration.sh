#!/usr/bin/env bash
# Integration test: verify @angycode/server package scaffolding from clean state
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MONO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "=== Integration Test: @angycode/server scaffold ==="

# Step 1: Clean state — remove node_modules and dist to simulate fresh clone
echo "[1/6] Cleaning build artifacts..."
rm -rf "$SCRIPT_DIR/dist"
rm -rf "$SCRIPT_DIR/node_modules"
rm -rf "$MONO_ROOT/node_modules"

# Step 2: Install dependencies from zero
echo "[2/6] Installing dependencies from clean state..."
cd "$MONO_ROOT"
npm install --silent 2>&1

# Step 3: Verify workspace linking — @angycode/core resolves
echo "[3/6] Verifying workspace dependency resolution..."
CORE_LINK="$MONO_ROOT/node_modules/@angycode/core"
if [ ! -L "$CORE_LINK" ] && [ ! -d "$CORE_LINK" ]; then
  echo "FAIL: @angycode/core not linked in node_modules"
  exit 1
fi
SERVER_LINK="$MONO_ROOT/node_modules/@angycode/server"
if [ ! -L "$SERVER_LINK" ] && [ ! -d "$SERVER_LINK" ]; then
  echo "FAIL: @angycode/server not linked in node_modules"
  exit 1
fi
echo "  @angycode/core and @angycode/server workspace links present"

# Step 4: Verify TypeScript is available
echo "[4/6] Verifying TypeScript availability..."
cd "$SCRIPT_DIR"
TS_VERSION=$(npx tsc --version 2>&1)
if [[ ! "$TS_VERSION" =~ ^Version ]]; then
  echo "FAIL: TypeScript not available: $TS_VERSION"
  exit 1
fi
echo "  TypeScript: $TS_VERSION"

# Step 5: Verify tsconfig references are wired
echo "[5/6] Verifying tsconfig references..."
cd "$MONO_ROOT"
SERVER_REF=$(node -e "
  const ts = JSON.parse(require('fs').readFileSync('tsconfig.json', 'utf8'));
  const hasServer = ts.references.some(r => r.path === 'packages/server');
  console.log(hasServer ? 'OK' : 'FAIL');
")
if [ "$SERVER_REF" != "OK" ]; then
  echo "FAIL: packages/server not in root tsconfig references"
  exit 1
fi
echo "  Root tsconfig.json references packages/server"

# Step 6: Verify hono and @hono/node-server are installed
echo "[6/6] Verifying key dependencies..."
cd "$SCRIPT_DIR"
HONO_CHECK=$(node -e "
  try {
    require.resolve('hono', { paths: ['$MONO_ROOT'] });
    require.resolve('@hono/node-server', { paths: ['$MONO_ROOT'] });
    require.resolve('nanoid', { paths: ['$MONO_ROOT'] });
    console.log('OK');
  } catch (e) {
    console.log('FAIL: ' + e.message);
  }
")
if [ "$HONO_CHECK" != "OK" ]; then
  echo "FAIL: Missing dependencies: $HONO_CHECK"
  exit 1
fi
echo "  hono, @hono/node-server, nanoid all resolve"

echo ""
echo "=== All integration checks passed ==="
