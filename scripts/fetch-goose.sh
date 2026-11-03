#!/bin/sh
# Fetches the pinned Goose toolchain (v2026.3) into .toolchain/goose/ and checks
# its SHA-256 before extracting. Used by `make setup` on a fresh clone.
# Platforms: macos-arm64 and linux-x64 (the release has no linux-arm64 build).
set -eu
VERSION=v2026.3
case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) PLATFORM=macos-arm64; DIR=darwin-arm64; SHA256=2ffaaf46b3edde27aed03fcd9ebe73e9b6639cac30d8a6915f7dc00795b7aedf ;;
  Linux-x86_64) PLATFORM=linux-x64; DIR=linux-x86_64; SHA256=06ac30284338269d3996d457412bf4f2b47c1f9a5601de65b6317187fe78d5c9 ;;
  *) echo "fetch-goose: no pinned Goose $VERSION for $(uname -s)-$(uname -m)" >&2; exit 1 ;;
esac
DEST="$(cd "$(dirname "$0")/.." && pwd)/.toolchain/goose"
TARBALL="goose-$VERSION-$PLATFORM.tar.gz"
mkdir -p "$DEST"
# The Makefile finds the toolchain at goose-$VERSION-$(uname -s | lower)-$(uname -m).
if [ -x "$DEST/goose-$VERSION-$DIR/goose" ]; then
  echo "goose $VERSION already present"; exit 0
fi
TMP="$DEST/$TARBALL.part"
curl -fsSL -o "$TMP" "https://github.com/aardappel/goose/releases/download/$VERSION/$TARBALL"
if command -v sha256sum >/dev/null 2>&1; then GOT=$(sha256sum "$TMP" | cut -d' ' -f1); else GOT=$(shasum -a 256 "$TMP" | cut -d' ' -f1); fi
if [ "$GOT" != "$SHA256" ]; then
  rm -f "$TMP"; echo "fetch-goose: SHA-256 mismatch for $TARBALL (got $GOT)" >&2; exit 1
fi
tar -xzf "$TMP" -C "$DEST"
rm -f "$TMP"
mv "$DEST/goose-$VERSION-$PLATFORM" "$DEST/goose-$VERSION-$DIR"
echo "goose $VERSION installed at $DEST/goose-$VERSION-$DIR"
