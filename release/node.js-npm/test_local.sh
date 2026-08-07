#!/bin/bash

# Local testing script for Print@SoC npm package

set -e

echo "================================"
echo "Print@SoC npm Test Script"
echo "================================"
echo

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Step 1: Check Node.js version
echo -e "${YELLOW}[1/6] Checking Node.js version...${NC}"
node_version=$(node --version)
echo "Node.js version: $node_version"

# Check if Node.js >= 14
if ! node -e "process.exit(parseInt(process.version.slice(1).split('.')[0]) >= 14 ? 0 : 1)"; then
    echo -e "${RED}Error: Node.js 14+ required${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Node.js version OK${NC}"
echo

# Step 2: Install dependencies
echo -e "${YELLOW}[2/6] Installing dependencies...${NC}"
npm install
echo -e "${GREEN}✓ Dependencies installed${NC}"
echo

# Step 3: Run tests
echo -e "${YELLOW}[3/6] Running tests...${NC}"
npm test
echo -e "${GREEN}✓ Tests passed${NC}"
echo

# Step 4: Test CLI commands
echo -e "${YELLOW}[4/6] Testing CLI commands...${NC}"

echo "Testing: node lib/cli.js --version"
node lib/cli.js --version
echo

echo "Testing: node lib/cli.js --help"
node lib/cli.js --help
echo

echo "Testing: node lib/cli.js --path"
node lib/cli.js --path
echo

echo -e "${GREEN}✓ CLI commands work${NC}"
echo

# Step 5: Test package structure
echo -e "${YELLOW}[5/6] Checking package structure...${NC}"

# Check if all required files exist
required_files=(
    "lib/cli.js"
    "lib/config.js"
    "lib/downloader.js"
    "package.json"
    "README.md"
    "LICENSE"
)

for file in "${required_files[@]}"; do
    if [ ! -f "$file" ]; then
        echo -e "${RED}Error: Missing required file: $file${NC}"
        exit 1
    fi
done

echo -e "${GREEN}✓ All required files present${NC}"
echo

# Step 6: Test npm pack
echo -e "${YELLOW}[6/6] Testing npm pack...${NC}"
npm pack --dry-run

echo -e "${GREEN}✓ Package structure valid${NC}"
echo

# Summary
echo "================================"
echo -e "${GREEN}All tests passed! ✓${NC}"
echo "================================"
echo
echo "Next steps:"
echo "1. Test installation: node lib/cli.js --install"
echo "2. Build desktop app: cd ../app && npm run tauri:build"
echo "3. Upload to GitHub Releases"
echo "4. Test download: node lib/cli.js"
echo
echo "To link globally for testing:"
echo "  npm link"
echo "  print-soc --version"
echo
echo "To publish to npm:"
echo "  npm login"
echo "  npm publish"
