#!/bin/bash
set -euo pipefail
WORKDIR="$1"
cd "$WORKDIR"
npm install --silent 2>/dev/null
npm test
# Also verify the DELETE endpoint exists in source
grep -r 'delete\|DELETE' src/server.ts > /dev/null 2>&1 || { echo 'FAIL: DELETE endpoint not found in server.ts'; exit 1; }
