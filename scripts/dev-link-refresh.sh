#!/usr/bin/env bash
# Rebuild the widget and push it into the running local chat-web dev server.
#
# Local dev topology (see chat-web .env.local):
#   chat-api  : http://localhost:8787  (tsx watch — hot-reloads itself)
#   chat-web  : http://localhost:3939  (next dev)
#   widget    : installed into chat-web from a local tarball (this script)
#
# Run after editing chat-widget src/. chat-api and chat-web edits hot-reload on
# their own; only the packed widget needs this manual round-trip.
set -euo pipefail

WIDGET_DIR="$(cd "$(dirname "$0")/.." && pwd)"
WEB_DIR="$WIDGET_DIR/../chat-web"

cd "$WIDGET_DIR"
npm run build
TARBALL="$WIDGET_DIR/$(npm pack --silent 2>/dev/null | tail -1)"

cd "$WEB_DIR"
npm install --force "$TARBALL"
rm -rf .next

echo
echo "✓ widget rebuilt + installed into chat-web ($TARBALL)"
echo "  next dev on :3939 will recompile on the next request; if it looks"
echo "  stale, restart it:  pkill -f 'next dev' && npm run dev -- -p 3939"
