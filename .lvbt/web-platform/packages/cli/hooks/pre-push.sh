#!/usr/bin/env sh
# Runs the same check CI runs before anything leaves the laptop, so a red CI
# run is rare rather than routine. CI is still the authority.
set -eu
ROOT=$(git rev-parse --show-toplevel)
unset $(git rev-parse --local-env-vars)
cd "$ROOT"
pnpm check
