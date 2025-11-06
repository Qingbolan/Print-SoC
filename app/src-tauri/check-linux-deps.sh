#!/bin/bash
# EasyPaper Linux Dependencies Check Script
# This script checks if all required runtime dependencies are installed

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "=========================================="
echo "EasyPaper Dependency Check"
echo "=========================================="
echo ""

# Function to check if a library is installed
check_library() {
    local lib_name=$1
    local pkg_name=$2
    local check_cmd=$3

    if eval "$check_cmd" &> /dev/null; then
        echo -e "${GREEN}✓${NC} $lib_name is installed"
        return 0
    else
        echo -e "${RED}✗${NC} $lib_name is NOT installed"
        echo -e "  ${YELLOW}Install with:${NC} $pkg_name"
        return 1
    fi
}

# Detect package manager
if command -v apt-get &> /dev/null; then
    PKG_MANAGER="apt-get"
    INSTALL_CMD="sudo apt-get install -y"
elif command -v dnf &> /dev/null; then
    PKG_MANAGER="dnf"
    INSTALL_CMD="sudo dnf install -y"
elif command -v yum &> /dev/null; then
    PKG_MANAGER="yum"
    INSTALL_CMD="sudo yum install -y"
elif command -v pacman &> /dev/null; then
    PKG_MANAGER="pacman"
    INSTALL_CMD="sudo pacman -S --noconfirm"
elif command -v zypper &> /dev/null; then
    PKG_MANAGER="zypper"
    INSTALL_CMD="sudo zypper install -y"
else
    PKG_MANAGER="unknown"
    INSTALL_CMD="Please install manually"
fi

echo "Detected package manager: $PKG_MANAGER"
echo ""

# Track missing dependencies
MISSING_DEPS=0

# Check dependencies based on package manager
case $PKG_MANAGER in
    "apt-get")
        echo "Checking dependencies for Debian/Ubuntu..."
        echo ""

        check_library "WebKitGTK 4.1 or 4.0" "$INSTALL_CMD libwebkit2gtk-4.1-0 || $INSTALL_CMD libwebkit2gtk-4.0-37" \
            "ldconfig -p | grep -q 'libwebkit2gtk-4\.[01]'" || MISSING_DEPS=$((MISSING_DEPS+1))

        check_library "GTK 3" "$INSTALL_CMD libgtk-3-0" \
            "ldconfig -p | grep -q libgtk-3" || MISSING_DEPS=$((MISSING_DEPS+1))

        check_library "AppIndicator" "$INSTALL_CMD libayatana-appindicator3-1" \
            "ldconfig -p | grep -q libayatana-appindicator3" || MISSING_DEPS=$((MISSING_DEPS+1))

        check_library "librsvg" "$INSTALL_CMD librsvg2-2" \
            "ldconfig -p | grep -q librsvg-2" || MISSING_DEPS=$((MISSING_DEPS+1))

        check_library "OpenSSL" "$INSTALL_CMD libssl3 || $INSTALL_CMD libssl1.1" \
            "ldconfig -p | grep -q libssl" || MISSING_DEPS=$((MISSING_DEPS+1))
        ;;

    "dnf"|"yum")
        echo "Checking dependencies for Fedora/RHEL/CentOS..."
        echo ""

        check_library "WebKitGTK" "$INSTALL_CMD webkit2gtk4.1 || $INSTALL_CMD webkit2gtk3" \
            "ldconfig -p | grep -q libwebkit2gtk" || MISSING_DEPS=$((MISSING_DEPS+1))

        check_library "GTK 3" "$INSTALL_CMD gtk3" \
            "ldconfig -p | grep -q libgtk-3" || MISSING_DEPS=$((MISSING_DEPS+1))

        check_library "AppIndicator" "$INSTALL_CMD libappindicator-gtk3" \
            "ldconfig -p | grep -q libappindicator" || MISSING_DEPS=$((MISSING_DEPS+1))

        check_library "librsvg" "$INSTALL_CMD librsvg2" \
            "ldconfig -p | grep -q librsvg-2" || MISSING_DEPS=$((MISSING_DEPS+1))

        check_library "OpenSSL" "$INSTALL_CMD openssl-libs" \
            "ldconfig -p | grep -q libssl" || MISSING_DEPS=$((MISSING_DEPS+1))
        ;;

    "pacman")
        echo "Checking dependencies for Arch Linux..."
        echo ""

        check_library "WebKitGTK" "$INSTALL_CMD webkit2gtk" \
            "pacman -Q webkit2gtk" || MISSING_DEPS=$((MISSING_DEPS+1))

        check_library "GTK 3" "$INSTALL_CMD gtk3" \
            "pacman -Q gtk3" || MISSING_DEPS=$((MISSING_DEPS+1))

        check_library "AppIndicator" "$INSTALL_CMD libappindicator-gtk3" \
            "pacman -Q libappindicator-gtk3" || MISSING_DEPS=$((MISSING_DEPS+1))

        check_library "librsvg" "$INSTALL_CMD librsvg" \
            "pacman -Q librsvg" || MISSING_DEPS=$((MISSING_DEPS+1))

        check_library "OpenSSL" "$INSTALL_CMD openssl" \
            "pacman -Q openssl" || MISSING_DEPS=$((MISSING_DEPS+1))
        ;;

    "zypper")
        echo "Checking dependencies for openSUSE..."
        echo ""

        check_library "WebKitGTK" "$INSTALL_CMD webkit2gtk3" \
            "ldconfig -p | grep -q libwebkit2gtk" || MISSING_DEPS=$((MISSING_DEPS+1))

        check_library "GTK 3" "$INSTALL_CMD gtk3" \
            "ldconfig -p | grep -q libgtk-3" || MISSING_DEPS=$((MISSING_DEPS+1))

        check_library "AppIndicator" "$INSTALL_CMD libappindicator3-1" \
            "ldconfig -p | grep -q libappindicator" || MISSING_DEPS=$((MISSING_DEPS+1))

        check_library "librsvg" "$INSTALL_CMD librsvg" \
            "ldconfig -p | grep -q librsvg-2" || MISSING_DEPS=$((MISSING_DEPS+1))

        check_library "OpenSSL" "$INSTALL_CMD libopenssl1_1" \
            "ldconfig -p | grep -q libssl" || MISSING_DEPS=$((MISSING_DEPS+1))
        ;;

    *)
        echo -e "${YELLOW}Unknown package manager.${NC}"
        echo "Please manually ensure the following libraries are installed:"
        echo "  - WebKitGTK 4.0 or 4.1"
        echo "  - GTK 3"
        echo "  - AppIndicator"
        echo "  - librsvg2"
        echo "  - OpenSSL"
        ;;
esac

echo ""
echo "=========================================="

if [ $MISSING_DEPS -eq 0 ]; then
    echo -e "${GREEN}All dependencies are installed!${NC}"
    echo "You can run EasyPaper without issues."
    exit 0
else
    echo -e "${RED}Missing $MISSING_DEPS dependencies.${NC}"
    echo ""
    echo "Install all missing dependencies at once:"

    case $PKG_MANAGER in
        "apt-get")
            echo "$INSTALL_CMD libwebkit2gtk-4.1-0 libgtk-3-0 libayatana-appindicator3-1 librsvg2-2 libssl3"
            ;;
        "dnf"|"yum")
            echo "$INSTALL_CMD webkit2gtk4.1 gtk3 libappindicator-gtk3 librsvg2 openssl-libs"
            ;;
        "pacman")
            echo "$INSTALL_CMD webkit2gtk gtk3 libappindicator-gtk3 librsvg openssl"
            ;;
        "zypper")
            echo "$INSTALL_CMD webkit2gtk3 gtk3 libappindicator3-1 librsvg libopenssl1_1"
            ;;
    esac

    echo ""
    echo -e "${YELLOW}Note:${NC} If using AppImage, most dependencies are bundled."
    echo "However, some system libraries like glibc must match your system."
    exit 1
fi
