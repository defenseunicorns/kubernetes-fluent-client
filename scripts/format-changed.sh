#!/usr/bin/env bash
set -euo pipefail

BASE="${1:-origin/main}"

ts_files=$(git diff --name-only --diff-filter=ACMRTUXB "$BASE" -- 'src/**' 'e2e/**' | grep -E '\.(ts|js|mts|mjs)$' || true)
fmt_files=$(git diff --name-only --diff-filter=ACMRTUXB "$BASE" | grep -E '\.(ts|js|mts|mjs|json|yaml|yml|md)$' || true)

if [ -n "$ts_files" ]; then
  echo "Linting changed files..."
  npx eslint $ts_files
else
  echo "No lint targets changed."
fi

if [ -n "$fmt_files" ]; then
  echo "Checking formatting of changed files..."
  npx prettier --check $fmt_files
else
  echo "No format targets changed."
fi
