#!/bin/bash
set -e

# List of packages to publish (directories with package.json that have built successfully)
PACKAGES=(
    "mcp"
    "bindings/node"
    "packages/engine"
    "packages/sdk"
    "adapters/strace"
    "adapters/turbopack"
)

echo "Packages to publish:"
for pkg in "${PACKAGES[@]}"; do
    echo "  - $pkg"
done
echo ""

# Prompt for OTP once
read -p "Enter OTP: " OTP
echo ""

for pkg in "${PACKAGES[@]}"; do
    echo "Publishing $pkg..."
    cd "/Users/gabriel/Desktop/incremental/$pkg"
    npm publish --otp="$OTP" --access=public
    cd - > /dev/null
    echo "Published $pkg successfully"
    echo ""
done

echo "All packages published!"
