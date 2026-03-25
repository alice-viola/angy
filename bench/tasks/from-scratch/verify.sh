#!/bin/bash
set -euo pipefail
WORKDIR="$1"
cd "$WORKDIR"
npm install --silent 2>/dev/null
npx vitest run --reporter=verbose 2>&1 || npm test -- --run 2>&1 || { echo 'FAIL: tests failed'; exit 1; }
npx tsc --noEmit
# Verify all 4 endpoint patterns exist
grep -r 'GET.*todos\|app.get.*todo' src/ > /dev/null || { echo 'FAIL: GET /api/todos not found'; exit 1; }
grep -r 'POST.*todos\|app.post.*todo' src/ > /dev/null || { echo 'FAIL: POST /api/todos not found'; exit 1; }
grep -r 'PUT.*todos\|app.put.*todo' src/ > /dev/null || { echo 'FAIL: PUT /api/todos not found'; exit 1; }
grep -r 'DELETE.*todos\|app.delete.*todo' src/ > /dev/null || { echo 'FAIL: DELETE /api/todos not found'; exit 1; }
