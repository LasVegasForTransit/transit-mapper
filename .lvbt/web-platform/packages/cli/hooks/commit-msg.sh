#!/usr/bin/env sh
# Validates the whole commit message against the organization grammar and the
# repository's own scope list (.lvbt/commit-scopes.txt, read from the current
# directory, which git sets to the repository root for hooks).
set -eu

MESSAGE_FILE="$1"
SUBJECT=$(head -n 1 "$MESSAGE_FILE")

# Git writes these subjects itself; they do not name an authored change.
case "$SUBJECT" in
  "Merge "*|"Revert "*|"fixup!"*|"squash!"*|"amend!"*) exit 0 ;;
esac

HOOKS_DIR=$(cd "$(dirname "$0")" && pwd)
exec node "$HOOKS_DIR/../plugins/lvbt-contributions/scripts/validate-commit-message.mjs" "$MESSAGE_FILE"
