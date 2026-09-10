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
cd "$ROOT"
pnpm check
