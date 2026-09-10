#!/usr/bin/env sh
# Formats the staged files and scans them for secrets. Fast by design: a slow
# hook gets bypassed with --no-verify, and a bypassed hook enforces nothing.
# CI is the guarantee; this exists so CI is rarely the thing that tells you.
set -eu
ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"

STAGED="$(git diff --cached --name-only --diff-filter=ACMR)"
[ -z "$STAGED" ] && exit 0

if ! pnpm --silent exec lint-staged --config "$ROOT/package.json"; then
  printf '\n  Commit blocked: lint-staged could not format everything.\n' >&2
  printf '    fix:  pnpm check:fix\n\n' >&2
  exit 1
fi

# Filenames are checked against the staged tree, so a misnamed file is caught
# at the commit rather than at push or in CI.
if ! pnpm --silent exec lvbt check filenames --staged; then
  printf '\n  Commit blocked: a source or test filename is out of contract.\n' >&2
  printf '    fix:  rename the file and update its imports\n\n' >&2
  exit 1
fi

# Secret scanning, net 1 of 3. CI and GitHub push protection are the others,
# because this one is bypassable by design.
if command -v gitleaks >/dev/null 2>&1; then
  if ! gitleaks git --staged --redact --no-banner 2>/dev/null; then
    printf '\n  Commit blocked: a secret was detected in the staged changes.\n' >&2
    printf '  Remove it, then rotate it. Assume anything written down is burned.\n\n' >&2
    exit 1
  fi
else
  printf '  note: gitleaks is not installed, skipping the local secret scan.\n' >&2
  printf '        CI still scans. Install it with: brew install gitleaks\n' >&2
fi
