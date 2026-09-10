#!/usr/bin/env sh
#
# Adds an attribution footer when a coding agent is driving the commit. A diff
# cannot say who wrote it, so the footer is written at the one moment the
# information exists: while the agent is still the thing running git.
#
# It is a floor, not the whole rule. An agent that names its own model writes a
# better footer than this can: the environment says which TOOL is running but
# never which MODEL. This never overwrites a footer that is already there, so a
# precise `Co-Authored-By: <model> <…>` survives and only a missing one gets the
# tool-level fallback.
set -e
MSG_FILE="$1"
COMMIT_SOURCE="${2:-}"

# Nothing to attribute for messages git composes itself. `squash` covers the
# rebase/fixup path, where the footers already belong to the commits being
# combined.
case "$COMMIT_SOURCE" in
  merge | squash) exit 0 ;;
esac

# Which agent, if any. CODEX_SESSION_ID is present in every Codex session;
# AI_AGENT is the cross-vendor spelling and CLAUDECODE is Claude Code's own
# boolean. None says which model, which is why the fallback names the tool.
if [ -n "${CODEX_SESSION_ID:-}" ]; then
  AUTHOR='Codex <noreply@openai.com>'
elif [ -n "${AI_AGENT:-}" ]; then
  AUTHOR='Claude Code <noreply@anthropic.com>'
elif [ "${CLAUDECODE:-}" = "1" ]; then
  AUTHOR='Claude Code <noreply@anthropic.com>'
else
  exit 0
fi

# Already attributed, by the agent itself or by an earlier run of this hook on
# the commit being amended.
if grep -qi '^Co-Authored-By:' "$MSG_FILE"; then
  exit 0
fi

# An empty message means the commit is about to be aborted anyway.
if ! grep -qv -e '^#' -e '^[[:space:]]*$' "$MSG_FILE"; then
  exit 0
fi

# Append inside the existing footer block when there is one, so a
# `BREAKING CHANGE:` footer keeps its new neighbour rather than being split
# into a paragraph of its own. Comments stay where they are: git strips them.
awk -v footer="Co-Authored-By: $AUTHOR" '
  { lines[NR] = $0 }
  END {
    last = 0
    for (i = 1; i <= NR; i++) {
      if (lines[i] !~ /^#/ && lines[i] !~ /^[[:space:]]*$/) last = i
    }
    start = 1
    for (i = last; i >= 1; i--) {
      if (lines[i] ~ /^[[:space:]]*$/) { start = i + 1; break }
    }
    joinable = (last > 0)
    for (i = start; i <= last; i++) {
      if (lines[i] !~ /^[A-Za-z][A-Za-z-]*: / &&
          lines[i] !~ /^BREAKING[ -]CHANGE: / &&
          lines[i] !~ /^[[:space:]]+[^[:space:]]/) { joinable = 0; break }
    }
    for (i = 1; i <= NR; i++) {
      if (i == last + 1) {
        if (!joinable) print ""
        print footer
      }
      print lines[i]
    }
    if (last == NR) {
      if (!joinable) print ""
      print footer
    }
  }
' "$MSG_FILE" >"$MSG_FILE.tmp"
mv "$MSG_FILE.tmp" "$MSG_FILE"
