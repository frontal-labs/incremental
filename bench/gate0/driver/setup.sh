#!/bin/sh
# One-time setup of the replay tree W (a scratch git repo, not the Os repo).
# node_modules directories are APFS copy-on-write clones of the Os ones, so the
# pnpm relative links resolve inside W (a symlink to the Os node_modules would
# resolve workspace packages back into the dirty Os checkout).
set -e
S="$1"; OS=/Users/gabrielfonseca/Desktop/os
W="$S/W"
mkdir -p "$W"
git init -q "$W"
echo "node_modules/" >> "$W/.git/info/exclude"
cd "$OS"
while read -r d; do
  mkdir -p "$W/$(dirname "$d")"
  cp -cR "$OS/$d" "$W/$d"
done < "$S/nm_dirs.txt"
# The one absolute link in the Os node_modules points into the Os checkout.
rm "$W/packages/llm/node_modules/@types"
ln -s ../../../node_modules/@types "$W/packages/llm/node_modules/@types"
echo SETUP_DONE
