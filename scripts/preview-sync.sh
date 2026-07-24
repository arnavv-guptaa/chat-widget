#!/usr/bin/env bash
# Rebuild the widget and push it into ../chat-web for local preview.
# The tarball is the only way to preview unmerged widget code — the registry
# version can't contain work that hasn't shipped.
set -euo pipefail
cd "$(dirname "$0")/.."
echo "→ building widget…"
npm run build
echo "→ packing…"
PKG=$(npm pack --silent | tail -1)
# chat-web pins mordn-chat-widget-0.14.1.tgz; keep that filename stable so its
# package.json spec keeps resolving regardless of the version in package.json.
cp "$PKG" mordn-chat-widget-0.14.1.tgz
echo "→ installing into chat-web…"
cd ../chat-web
npm install --force ../chat-widget/mordn-chat-widget-0.14.1.tgz --silent

# MUST clear .next: Next copies deps into .next/vendor-chunks at first compile
# and does NOT re-copy them when node_modules changes underneath it. Without
# this the dev server keeps serving the widget bundle from whenever the cache
# was first built, so the install silently has no effect in the browser.
echo "→ clearing .next (stale vendor-chunks would mask the new build)…"
rm -rf .next

VER=$(node -e "console.log(require('./node_modules/@mordn/chat-widget/package.json').version)")
echo "✓ synced $VER → chat-web"
echo "  RESTART the dev server (npx next dev -p 3939) — .next was cleared."
