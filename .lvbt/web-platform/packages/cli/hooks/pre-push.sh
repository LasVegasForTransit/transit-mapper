#!/usr/bin/env sh
# Runs the same check CI runs before anything leaves the laptop, so a red CI
# run is rare rather than routine. CI is still the authority.
set -eu
ROOT=$(git rev-parse --show-toplevel)
LOCAL_ENV_VARS=$(git rev-parse --local-env-vars)
while IFS= read -r variable; do
  unset "$variable"
done <<EOF
$LOCAL_ENV_VARS
EOF
# Git passes the refs being pushed on standard input; keep them for Git LFS.
REFS=$(cat)
cd "$ROOT"
pnpm check
# A repository that stores files with Git LFS uploads their objects with the
# push, as the hook `git lfs install` writes would. Only after the check passes.
if command -v git-lfs >/dev/null 2>&1 && grep -qs 'filter=lfs' "$ROOT/.gitattributes"; then
  printf '%s\n' "$REFS" | git lfs pre-push "$@"
fi
