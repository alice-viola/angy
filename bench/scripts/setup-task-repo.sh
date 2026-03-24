#!/bin/bash
# Usage: ./setup-task-repo.sh <task-dir>
# Initialises git repos for all task repo/ directories (or a single one)
set -euo pipefail
TASKS_DIR="$(dirname "$0")/../tasks"
for dir in "$TASKS_DIR"/*/repo; do
  if [ -d "$dir" ] && [ ! -d "$dir/.git" ]; then
    echo "Initialising $dir"
    git -C "$dir" init
    git -C "$dir" add -A
    git -C "$dir" commit -m "initial state"
  fi
done
