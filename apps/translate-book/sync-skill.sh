#!/usr/bin/env bash
# Vendor a pinned copy of the translate-book skill into this app bundle.
#
# The upstream repo (/home/megyo/projects/translate-book) stays the source of
# truth (CLAUDE.md decision 13 / PRD Implementation Notes); this script copies a
# snapshot into apps/translate-book/skill/ and records the source commit so the
# bundle is reproducible. The Foreman progress.json convention is appended as an
# overlay so it lives in the bundle without forking upstream (coordinate a
# backward-compatible upstream PR separately — IMPLEMENTATION_PLAN Phase 8).
#
# Usage: ./sync-skill.sh [path-to-translate-book-repo]
set -euo pipefail

SRC="${1:-/home/megyo/projects/translate-book}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="$HERE/skill"
OVERLAY="$HERE/skill-overlay/progress.md"

if [[ ! -f "$SRC/SKILL.md" ]]; then
  echo "error: no SKILL.md under '$SRC' — pass the translate-book repo path" >&2
  exit 1
fi

rm -rf "$DEST"
mkdir -p "$DEST/scripts"

# The skill prompt + the python pipeline + its templates. No tests, no caches.
cp "$SRC/SKILL.md" "$DEST/SKILL.md"
[[ -f "$SRC/AGENTS.md" ]] && cp "$SRC/AGENTS.md" "$DEST/AGENTS.md"
cp "$SRC"/scripts/*.py "$DEST/scripts/"
cp "$SRC"/scripts/*.html "$DEST/scripts/" 2>/dev/null || true

# Append the Foreman progress.json convention to the vendored prompt.
if [[ -f "$OVERLAY" ]]; then
  cat "$OVERLAY" >> "$DEST/SKILL.md"
fi

# Pin: record exactly what was vendored.
COMMIT="$(git -C "$SRC" rev-parse HEAD 2>/dev/null || echo "unknown")"
{
  echo "source: $SRC"
  echo "commit: $COMMIT"
  echo "overlay: skill-overlay/progress.md (Foreman progress.json convention)"
} > "$DEST/VENDOR.txt"

echo "Vendored translate-book skill -> $DEST (commit ${COMMIT:0:12})"
