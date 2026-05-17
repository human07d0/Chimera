#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Check .env
if [ ! -f .env ]; then
  echo "Error: .env not found. Copy .env.example to .env and configure it:"
  echo "  cp .env.example .env"
  exit 1
fi

# Check bun
if ! command -v bun &>/dev/null; then
  echo "Bun is not installed. Installing..."
  curl -fsSL https://bun.sh/install | bash
  export BUN_INSTALL="$HOME/.bun"
  export PATH="$BUN_INSTALL/bin:$PATH"
  if ! command -v bun &>/dev/null; then
    echo "Error: Bun installation failed. Please install manually: https://bun.sh"
    exit 1
  fi
  echo "Bun installed successfully."
fi

# Check index.js
if [ ! -f index.js ]; then
  echo "Error: index.js not found. Please ensure the release archive was extracted correctly."
  exit 1
fi

exec bun run index.js "$@"
