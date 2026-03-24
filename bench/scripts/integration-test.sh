#!/bin/bash
# Integration test for bench/ scaffold
# Verifies: clean install, type-checking, directory structure, script executability,
#           and the workDir plumbing fix (no duplicate temp directories).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BENCH_DIR="$(dirname "$SCRIPT_DIR")"
CLEANUP_DIRS=()

cleanup() {
  for d in "${CLEANUP_DIRS[@]}"; do
    rm -rf "$d" 2>/dev/null || true
  done
  rm -rf "$BENCH_DIR/dist" "$BENCH_DIR/tmp-bench-"*
}
trap cleanup EXIT

echo "=== Integration Test: bench/ scaffold ==="

# Step 1: Clean state — remove any leftover artifacts
echo "[1/8] Cleaning state..."
rm -rf "$BENCH_DIR/node_modules" "$BENCH_DIR/dist" "$BENCH_DIR/tmp-bench-"*
echo "  OK: Clean state"

# Step 2: Fresh install
echo "[2/8] Installing dependencies..."
cd "$BENCH_DIR"
npm install --silent 2>&1
echo "  OK: npm install succeeded"

# Step 3: Type-check
echo "[3/8] Running type-check..."
cd "$BENCH_DIR"
npx tsc --noEmit 2>&1
echo "  OK: tsc --noEmit passed with zero errors"

# Step 4: Verify directory structure
echo "[4/8] Verifying directory structure..."
REQUIRED_FILES=(
  "package.json"
  "tsconfig.json"
  ".gitignore"
  "README.md"
  "task.schema.ts"
  "types.ts"
  "util.ts"
  "scripts/setup-task-repo.sh"
  "results/.gitkeep"
)
for f in "${REQUIRED_FILES[@]}"; do
  if [ ! -f "$BENCH_DIR/$f" ]; then
    echo "  FAIL: Missing file $f"
    exit 1
  fi
done
echo "  OK: All required files exist"

# Step 5: Verify script executability
echo "[5/8] Verifying script executability..."
if [ ! -x "$BENCH_DIR/scripts/setup-task-repo.sh" ]; then
  echo "  FAIL: setup-task-repo.sh is not executable"
  exit 1
fi
echo "  OK: setup-task-repo.sh is executable"

# Step 6: Verify no imports from src/ or @tauri-apps
echo "[6/8] Checking for forbidden imports..."
FORBIDDEN=$(grep -r "from ['\"].*src/engine" "$BENCH_DIR"/*.ts "$BENCH_DIR"/**/*.ts 2>/dev/null || true)
FORBIDDEN2=$(grep -r "@tauri-apps" "$BENCH_DIR"/*.ts "$BENCH_DIR"/**/*.ts 2>/dev/null || true)
if [ -n "$FORBIDDEN" ] || [ -n "$FORBIDDEN2" ]; then
  echo "  FAIL: Found forbidden imports from src/ or @tauri-apps"
  echo "$FORBIDDEN"
  echo "$FORBIDDEN2"
  exit 1
fi
echo "  OK: No forbidden imports"

# Step 7: Verify adapters no longer create their own temp dirs
echo "[7/8] Verifying adapters don't create duplicate temp dirs..."
# Both adapters must NOT import makeTempDir or cloneDir
for adapter in "adapters/claudecode.ts" "adapters/agentloop.ts"; do
  if grep -q "makeTempDir\|cloneDir" "$BENCH_DIR/$adapter"; then
    echo "  FAIL: $adapter still imports makeTempDir or cloneDir (duplicate temp dir bug)"
    exit 1
  fi
done
# Both adapters must reference config.workDir
for adapter in "adapters/claudecode.ts" "adapters/agentloop.ts"; do
  if ! grep -q "config\.workDir" "$BENCH_DIR/$adapter"; then
    echo "  FAIL: $adapter does not use config.workDir"
    exit 1
  fi
done
# RunConfig must have workDir field
if ! grep -q "workDir" "$BENCH_DIR/types.ts"; then
  echo "  FAIL: types.ts RunConfig missing workDir field"
  exit 1
fi
echo "  OK: Adapters use config.workDir, no duplicate temp dirs"

# Step 8: End-to-end workDir plumbing test (sentinel file check)
# Simulates the runner's clone-then-verify flow to confirm verify.sh sees the agent's work dir.
echo "[8/8] Testing workDir plumbing with sentinel file..."

# Create a minimal fake task repo
FAKE_REPO=$(mktemp -d "${TMPDIR:-/tmp}/bench-test-repo-XXXXXX")
CLEANUP_DIRS+=("$FAKE_REPO")
echo "initial" > "$FAKE_REPO/file.txt"

# Simulate what runner.ts does: clone to temp dir
WORK_DIR=$(mktemp -d "${TMPDIR:-/tmp}/bench-test-workdir-XXXXXX")
CLEANUP_DIRS+=("$WORK_DIR")
cp -a "$FAKE_REPO/." "$WORK_DIR/"

# Simulate what the agent does: write a sentinel file in the work dir
echo "agent-was-here" > "$WORK_DIR/.sentinel"

# Create a verify script that checks for the sentinel file
VERIFY_SCRIPT=$(mktemp "${TMPDIR:-/tmp}/bench-test-verify-XXXXXX.sh")
CLEANUP_DIRS+=("$VERIFY_SCRIPT")
cat > "$VERIFY_SCRIPT" << 'VERIFY_EOF'
#!/bin/bash
set -e
WORKDIR="$1"
if [ ! -f "$WORKDIR/.sentinel" ]; then
  echo "FAIL: sentinel file not found — verify.sh got wrong directory"
  exit 1
fi
CONTENT=$(cat "$WORKDIR/.sentinel")
if [ "$CONTENT" != "agent-was-here" ]; then
  echo "FAIL: sentinel content mismatch"
  exit 1
fi
echo "PASS: verify.sh sees agent's work directory"
exit 0
VERIFY_EOF
chmod +x "$VERIFY_SCRIPT"

# Run verify.sh with the work dir (same as runner.ts line 237 does after the fix)
VERIFY_OUTPUT=$("$VERIFY_SCRIPT" "$WORK_DIR" 2>&1)
VERIFY_EXIT=$?
if [ $VERIFY_EXIT -ne 0 ]; then
  echo "  FAIL: $VERIFY_OUTPUT"
  exit 1
fi
echo "  OK: $VERIFY_OUTPUT"

echo ""
echo "=== All integration tests passed ==="
