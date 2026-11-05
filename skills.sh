#!/bin/sh
# skills.sh — install this repository's OpenCode skills from skills/ into
# ~/.opencode/skills/ so OpenCode loads them as agent skills.
#
# Each skill lives at skills/incremental/<name>/SKILL.md and is installed to
# ~/.opencode/skills/incremental-<name>/SKILL.md (the directory name is the
# skill id OpenCode uses). Override the OpenCode skills home with
# OPSKILLS_HOME, e.g. OPSKILLS_HOME=/tmp/opencode-skills ./skills.sh.
#
# Usage:
#   ./skills.sh            # install every skill under skills/incremental/
#   ./skills.sh engine     # install only the named skill(s)
#
set -eu

ROOT="$(cd "$(dirname "$0")" && pwd)"
SKILLS_DIR="$ROOT/skills"
OPSKILLS_DIR="${OPSKILLS_HOME:-$HOME/.opencode/skills}"

install_skill() {
  # $1: skill name, e.g. engine, verify, adapter
  local skill="$1"
  local src="$SKILLS_DIR/incremental/$skill/SKILL.md"
  local dest="$OPSKILLS_DIR/incremental-$skill"

  if [ ! -f "$src" ]; then
    echo "skills.sh: no such skill '$skill' (expected $src)" >&2
    return 1
  fi

  mkdir -p "$dest"
  cp "$src" "$dest/SKILL.md"
  echo "skills.sh: installed $skill -> $dest/SKILL.md"
}

main() {
  mkdir -p "$OPSKILLS_DIR"

  if [ "$#" -eq 0 ]; then
    installed=0
    for src in "$SKILLS_DIR"/incremental/*/SKILL.md; do
      # Skip the glob itself when nothing matches.
      [ -f "$src" ] || continue
      skill="$(basename "$(dirname "$src")")"
      install_skill "$skill" || true
      installed=$((installed + 1))
    done
    if [ "$installed" -eq 0 ]; then
      echo "skills.sh: no skills found under $SKILLS_DIR/incremental/" >&2
      exit 1
    fi
    echo "skills.sh: installed $installed skill(s) into $OPSKILLS_DIR"
  else
    for skill in "$@"; do
      install_skill "$skill"
    done
  fi
}

main "$@"
