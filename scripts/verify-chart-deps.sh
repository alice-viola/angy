#!/usr/bin/env bash
# Integration test: verify chart.js and vue-chartjs dependencies
# Starts from clean state, installs, and verifies everything works.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "=== Chart Dependencies Integration Test ==="
echo "Project root: $PROJECT_ROOT"

# Step 1: Clean state — remove node_modules to ensure fresh install
echo ""
echo "[1/5] Cleaning state (removing node_modules)..."
rm -rf "$PROJECT_ROOT/node_modules"

# Step 2: Fresh install
echo "[2/5] Running npm install from clean state..."
cd "$PROJECT_ROOT"
npm install --silent
echo "  ✓ npm install succeeded"

# Step 3: Verify package.json contains both dependencies
echo "[3/5] Checking package.json dependencies..."
node -e "
  const pkg = require('./package.json');
  const deps = pkg.dependencies || {};
  const checks = ['chart.js', 'vue-chartjs'];
  let ok = true;
  for (const dep of checks) {
    if (deps[dep]) {
      console.log('  ✓ ' + dep + ': ' + deps[dep]);
    } else {
      console.error('  ✗ ' + dep + ' NOT FOUND in dependencies');
      ok = false;
    }
  }
  if (!ok) process.exit(1);
"

# Step 4: Verify modules are resolvable
echo "[4/5] Verifying modules are resolvable..."
node -e "
  const chartjs = require.resolve('chart.js');
  console.log('  ✓ chart.js resolves to: ' + chartjs);
  const vueChartjs = require.resolve('vue-chartjs');
  console.log('  ✓ vue-chartjs resolves to: ' + vueChartjs);
"

# Step 5: Verify tree-shakeable named exports exist (not chart.js/auto)
echo "[5/5] Verifying chart.js named exports available..."
node -e "
  // Verify the registration pattern works (ESM re-exported as CJS)
  const cjs = require('chart.js');
  const needed = ['Chart', 'CategoryScale', 'LinearScale', 'PointElement',
    'LineElement', 'BarElement', 'ArcElement', 'Title', 'Tooltip', 'Legend', 'Filler'];
  let ok = true;
  for (const name of needed) {
    if (cjs[name]) {
      // exists
    } else {
      console.error('  ✗ chart.js missing export: ' + name);
      ok = false;
    }
  }
  if (ok) console.log('  ✓ All required chart.js components available');
  else process.exit(1);
"

echo ""
echo "=== All checks passed ==="
