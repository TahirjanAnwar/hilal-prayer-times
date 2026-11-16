#!/bin/sh
# Builds the macOS .dmg. Run on a Mac:  sh build-mac.command
cd "$(dirname "$0")" || exit 1
if ! command -v npm >/dev/null 2>&1; then
  echo "Node.js is not installed. Install the LTS version from https://nodejs.org and run this again."
  exit 1
fi
npm install && npm run dist:mac && open dist
