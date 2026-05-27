#!/bin/bash

# ============================================================
# Culmina RMS — Phase 9B-1 file deployment script
# Run from Git Bash in C:\Users\Joe\recipe-app
# Usage: bash deploy-9b1.sh
# ============================================================

PROJECT="$(pwd)"
ZIP="$PROJECT/zip"

echo "🚀 Deploying Phase 9B-1 files..."
echo "   Project: $PROJECT"
echo "   Zip:     $ZIP"
echo ""

if [ ! -d "$ZIP" ]; then
  echo "❌ Zip folder not found at: $ZIP"
  exit 1
fi

deploy() {
  local src="$ZIP/$1"
  local dst="$PROJECT/$2"
  if [ ! -f "$src" ]; then
    echo "⚠  SKIP (not found): $1"
    return
  fi
  mkdir -p "$(dirname "$dst")"
  cp "$src" "$dst"
  echo "✓  $1"
}

deploy "schema_v9_waitlist.sql"    "supabase/schema_v9_waitlist.sql"
deploy "types.ts"                  "src/lib/types.ts"
deploy "AppShell.tsx"              "src/components/AppShell.tsx"
deploy "WaitlistModule.tsx"        "src/components/WaitlistModule.tsx"
deploy "join-page.tsx"             "src/app/join/[locationId]/page.tsx"
deploy "location-info-route.ts"    "src/app/api/location-info/[locationId]/route.ts"
deploy "waitlist-join-route.ts"    "src/app/api/waitlist/join/route.ts"
deploy "waitlist-action-route.ts"  "src/app/api/waitlist/action/route.ts"

echo ""
echo "✅ Done. Run:"
echo "   git add -A && git commit -m \"Phase 9B-1\" && git push && vercel --prod"
