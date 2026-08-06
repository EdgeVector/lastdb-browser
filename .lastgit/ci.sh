#!/usr/bin/env bash
# Required CI gate for lastdb-browser (context: ci-required).
#
# The app is a Vite/React SPA plus a zero-dependency Node bridge. There is no
# node to talk to inside CI, so this gate proves the tree builds and the bridge
# parses — not that it can reach a database.
set -euo pipefail

echo "== node =="
node --version
npm --version

echo "== install =="
# `npm ci` needs the lockfile to match package.json; that is the point of the gate.
npm ci

echo "== build =="
npm run build
test -f dist/index.html || { echo "FAIL: dist/index.html not produced"; exit 1; }

echo "== bridge syntax =="
node --check server.mjs

echo "== shell entrypoints parse =="
bash -n .lastgit/ci.sh
bash -n bin/lastdb-browser
bash -n bin/lastdb-browser-host-track-post-install

echo "== venue + inert mirror =="
# The GitHub copy is a read-only mirror; a workflow directory here would give it
# something to run.
test "$(head -n 1 .last-stack/pr-venue)" = "lastgit"
test ! -e .github/workflows

echo "== artifact declaration covers what the launcher needs =="
# host-track packs exactly `.lastgit/artifacts.json` paths. If the launcher, the
# post-install, or a build input is missing from that list, the installed app is
# broken in a way nothing else here would catch.
for required in README.md bin index.html package.json package-lock.json server.mjs src vite.config.js; do
  grep -q "\"$required\"" .lastgit/artifacts.json \
    || { echo "FAIL: $required missing from .lastgit/artifacts.json"; exit 1; }
done

echo "== no host identity in shipped tree =="
# The public mirror must not carry usernames, home paths, emails or private IPs.
if grep -rnE '/Users/[a-z]|[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}|192\.168\.|10\.[0-9]+\.[0-9]+\.[0-9]+|100\.[0-9]+\.[0-9]+\.[0-9]+' \
     --include='*.js' --include='*.jsx' --include='*.mjs' --include='*.json' \
     --include='*.md' --include='*.html' --include='*.css' \
     src server.mjs README.md 2>/dev/null; then
  echo "FAIL: host identity leaked into the shipped tree"
  exit 1
fi

echo "CI OK"
