#!/bin/bash
set -euo pipefail
WORKDIR="$1"
cd "$WORKDIR"
npm install --silent 2>/dev/null
npm test
# Verify the jwt module exists and JWT logic is consolidated
test -f src/lib/jwt.ts || { echo 'FAIL: src/lib/jwt.ts not found'; exit 1; }
npx tsc --noEmit
