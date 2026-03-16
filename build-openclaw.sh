#!/usr/bin/env bash
# Build OpenClaw from source and ensure CLI is globally available.
#
# Prerequisites:
#   - Node.js >= 22.16.0
#   - pnpm (for dependency management)
#   - npm link already done (first-time setup: bash build-openclaw.sh --link)
#
# Usage:
#   bash build-openclaw.sh          # Standard build (recommended after code changes)
#   bash build-openclaw.sh --quick  # Minimal build (tsdown only, fastest)
#   bash build-openclaw.sh --full   # Full build including canvas/a2ui bundle (needs global tsc)
#   bash build-openclaw.sh --link   # Build + re-create global npm link (first-time setup)

set -euo pipefail
cd "$(dirname "$0")"

MODE="${1:-standard}"

echo "=== Building OpenClaw ($MODE) ==="
echo "    Node: $(node --version)"
echo ""

case "$MODE" in
  --full)
    # Full build - requires tsc in PATH (npm i -g typescript)
    pnpm build
    ;;
  --quick)
    # Fastest: only TypeScript compilation + postbuild
    node scripts/tsdown-build.mjs
    node scripts/runtime-postbuild.mjs
    ;;
  --link)
    # Standard build + global npm link (first-time setup)
    node scripts/tsdown-build.mjs
    node scripts/runtime-postbuild.mjs
    (cd ui && npx vite build) 2>/dev/null || echo "    (UI build skipped)"
    pnpm build:plugin-sdk:dts 2>/dev/null || echo "    (plugin SDK dts skipped)"
    echo ""
    echo "=== Linking globally via npm ==="
    npm link
    ;;
  *)
    # Standard build: core compile + metadata + UI (skip canvas bundle)
    node scripts/tsdown-build.mjs
    node scripts/runtime-postbuild.mjs
    (cd ui && npx vite build) 2>/dev/null || echo "    (UI build skipped)"
    pnpm build:plugin-sdk:dts 2>/dev/null || echo "    (plugin SDK dts skipped)"
    node --import tsx scripts/write-build-info.ts 2>/dev/null || true
    node --import tsx scripts/write-cli-startup-metadata.ts 2>/dev/null || true
    ;;
esac

echo ""

# Verify CLI is available
VERSION=$(openclaw --version 2>&1) || {
  echo "ERROR: openclaw CLI not found in PATH."
  echo "Run first-time setup: bash build-openclaw.sh --link"
  exit 1
}
echo "=== Build complete ==="
echo "    $VERSION"
echo "    CLI: $(which openclaw)"
