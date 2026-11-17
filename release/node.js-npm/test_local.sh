#!/bin/bash
# Read-only regression checks for the retained source launcher.
set -euo pipefail
cd "$(dirname "$0")"
npm test
node lib/cli.js --version
node lib/cli.js --help
node lib/cli.js --path
