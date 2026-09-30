#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/app"
npm run tauri:build "$@"
