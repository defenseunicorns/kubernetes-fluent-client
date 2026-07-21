#!/usr/bin/env bash
set -euo pipefail

BASE="${1:-origin/${GITHUB_BASE_REF:-main}}"

mapfile -t ts_files < <(git diff --name-only --diff-filter=ACMRTUXB "$BASE" -- 'src/**' 'e2e/**' | grep -E '\.(ts|js|mts|mjs)$' || true)
mapfile -t fmt_files < <(git diff --name-only --diff-filter=ACMRTUXB "$BASE" | grep -E '\.(ts|js|mts|mjs|json|yaml|yml|md)$' || true)

if [ ${#ts_files[@]} -gt 0 ]; then
  echo "Linting changed files..."
  npx eslint --max-warnings 0 "${ts_files[@]}"
else
  echo "No lint targets changed."
fi

if [ ${#fmt_files[@]} -gt 0 ]; then
  echo "Checking formatting of changed files..."
  npx prettier --check "${fmt_files[@]}"
else
  echo "No format targets changed."
fi
