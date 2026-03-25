#!/bin/bash
# $1 = workdir (unused for this task)
# $2 = path to file containing agent's text output
set -euo pipefail
AGENT_OUTPUT_FILE="${2:-/dev/null}"
if grep -qi 'src/services/internal/auth/handler' "$AGENT_OUTPUT_FILE" && \
   grep -qi 'validateJwtToken' "$AGENT_OUTPUT_FILE"; then
  echo "PASS: agent found the correct file and function"
  exit 0
else
  echo "FAIL: agent did not report the correct file path and function name"
  exit 1
fi
