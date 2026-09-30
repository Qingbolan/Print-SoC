#!/bin/bash

# Local testing script for Print@SoC Python package

set -e

echo "================================"
echo "Print@SoC Python Local Test Script"
echo "================================"
echo

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Step 1: Check Python version
echo -e "${YELLOW}[1/6] Checking Python version...${NC}"
python_version=$(python --version 2>&1 | awk '{print $2}')
echo "Python version: $python_version"

if ! python -c "import sys; sys.exit(0 if sys.version_info >= (3, 8) else 1)"; then
    echo -e "${RED}Error: Python 3.8+ required${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Python version OK${NC}"
echo

# Step 2: Create virtual environment
echo -e "${YELLOW}[2/6] Creating virtual environment...${NC}"
if [ -d "venv" ]; then
    echo "Removing existing venv..."
    rm -rf venv
fi
python -m venv venv
source venv/bin/activate
echo -e "${GREEN}✓ Virtual environment created${NC}"
echo

# Step 3: Install package in editable mode
echo -e "${YELLOW}[3/6] Installing package in editable mode...${NC}"
pip install --upgrade pip
pip install -e . pytest
python -m pytest tests -q
echo -e "${GREEN}✓ Package installed${NC}"
echo

# Step 4: Test CLI commands
echo -e "${YELLOW}[4/6] Testing CLI commands...${NC}"

echo "Testing: print-soc --version"
print-soc --version
echo

echo "Testing: print-soc --help"
print-soc --help
echo

echo "Testing: print-soc --path"
print-soc --path
echo

echo "Testing: print-soc printer --help"
print-soc printer --help
echo

echo "Testing: print-soc config show --json"
print-soc config show --json
echo

echo -e "${GREEN}✓ CLI commands work${NC}"
echo

# Step 5: Test package import
echo -e "${YELLOW}[5/6] Testing Python import...${NC}"
python << 'EOF'
import print_at_soc
print(f"Package version: {print_at_soc.__version__}")
print(f"Author: {print_at_soc.__author__}")

from print_at_soc import config
print(f"Config VERSION: {config.VERSION}")
print(f"Install directory: {config.INSTALL_DIR}")

from print_at_soc.downloader import get_platform_key
platform_key = get_platform_key()
print(f"Detected platform: {platform_key}")
EOF
echo -e "${GREEN}✓ Python import successful${NC}"
echo

# Step 6: Build package
echo -e "${YELLOW}[6/6] Testing package build...${NC}"
pip install build twine
python -m build

echo "Checking package..."
twine check dist/*

echo -e "${GREEN}✓ Package build successful${NC}"
echo

# Summary
echo "================================"
echo -e "${GREEN}All tests passed! ✓${NC}"
echo "================================"
echo
echo "Next steps:"
echo "1. Test installation: print-soc --install"
echo "2. Build desktop app: cd ../app && npm run tauri:build"
echo "3. Upload to GitHub Releases"
echo "4. Test download: print-soc"
echo

echo "To publish to TestPyPI:"
echo "  twine upload --repository testpypi dist/*"
echo

echo "To deactivate virtual environment:"
echo "  deactivate"
