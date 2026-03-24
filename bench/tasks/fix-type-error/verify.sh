#!/bin/bash
set -euo pipefail
WORKDIR="$1"
cd "$WORKDIR"
npm install --silent 2>/dev/null
npx tsc --noEmit
npm test
