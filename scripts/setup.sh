#!/usr/bin/env bash
# Installs dependencies and builds the engine + server.
# Works with a normal `npm install` (real deployments) and also falls back
# to a manual workspace link + globally-installed TypeScript when the npm
# registry isn't reachable (as in some sandboxed dev environments).
set -e

cd "$(dirname "$0")/.."
ROOT="$(pwd)"

echo "==> Installing dependencies (npm workspaces)..."
if npm install --no-audit --no-fund; then
  echo "==> npm install succeeded."
else
  echo "!! npm install failed (offline / registry unreachable)."
  echo "!! Falling back to a manual workspace link + global TypeScript."
  echo "!! You will need 'tsc' and 'tsx' available globally for this path."
  mkdir -p "$ROOT/server/node_modules/@poker"
  ln -sfn "$ROOT/packages/engine" "$ROOT/server/node_modules/@poker/engine"
fi

echo "==> Building @poker/engine..."
(cd "$ROOT/packages/engine" && npx --no-install tsc -p tsconfig.json 2>/dev/null || tsc -p tsconfig.json)

echo "==> Building server..."
(cd "$ROOT/server" && npx --no-install tsc -p tsconfig.json 2>/dev/null || tsc -p tsconfig.json)

echo "==> Done. Run 'npm run start -w server' (or 'node server/dist/index.js') to launch."
