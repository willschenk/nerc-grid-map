#!/usr/bin/env bash
# Publish the built site to the gh-pages branch (GitHub Pages, deploy-from-branch).
# Builds first via the npm "deploy" script. Uses a throwaway repo in a temp dir so
# the main working tree and its history are never touched.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

if [ ! -d dist ]; then
  echo "dist/ not found. Run 'npm run build' first." >&2
  exit 1
fi

# Disable Jekyll so Astro's _astro/ assets are served as-is.
touch dist/.nojekyll

remote="$(git remote get-url origin)"
tmp="$(mktemp -d)"
cp -R dist/. "$tmp/"
(
  cd "$tmp"
  git init -q -b gh-pages
  git add -A
  git commit -q -m "Deploy $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  git push -q -f "$remote" gh-pages
)
rm -rf "$tmp"
echo "Deployed dist/ to gh-pages on $remote"
