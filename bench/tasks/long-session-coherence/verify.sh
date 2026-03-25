#!/bin/bash
set -euo pipefail
WORKDIR="$1"
cd "$WORKDIR"
npm install --silent 2>/dev/null
npx vitest run --reporter=verbose 2>&1 || npm test -- --run 2>&1 || { echo 'FAIL: tests failed'; exit 1; }
npx tsc --noEmit
# Verify at least 5 source modules exist
SOURCE_COUNT=$(find src -name '*.ts' ! -name '*.test.ts' | wc -l | tr -d ' ')
if [ "$SOURCE_COUNT" -lt 5 ]; then
  echo "FAIL: expected at least 5 source files, found $SOURCE_COUNT"
  exit 1
fi
# Verify at least 5 test files
TEST_COUNT=$(find src -name '*.test.ts' | wc -l | tr -d ' ')
if [ "$TEST_COUNT" -lt 5 ]; then
  echo "FAIL: expected at least 5 test files, found $TEST_COUNT"
  exit 1
fi
# Verify at least 15 test cases (it( or test( calls)
TEST_CASE_COUNT=$(grep -r 'it(\|test(' src --include='*.test.ts' | wc -l | tr -d ' ')
if [ "$TEST_CASE_COUNT" -lt 15 ]; then
  echo "FAIL: expected at least 15 test cases, found $TEST_CASE_COUNT"
  exit 1
fi
echo "PASS: $SOURCE_COUNT source files, $TEST_COUNT test files, $TEST_CASE_COUNT test cases"
