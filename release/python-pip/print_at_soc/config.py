"""Configuration for Print@SoC"""

from pathlib import Path

# Version
VERSION = "0.1.0"

# GitHub repository
GITHUB_REPO = "Qingbolan/Print-SoC"
GITHUB_API_URL = f"https://api.github.com/repos/{GITHUB_REPO}/releases/latest"

# Local installation paths
HOME_DIR = Path.home()
INSTALL_DIR = HOME_DIR / ".PrintAtSoC"
BINARY_DIR = INSTALL_DIR / "bin"
VERSION_FILE = INSTALL_DIR / "version.txt"

# Platform-specific binary names and configurations
PLATFORM_BINARIES = {
    "darwin_arm64": {
        "asset_name": "Print_at_SoC_macos_aarch64.app.tar.gz",
        "executable_path": "Print_at_SoC.app/Contents/MacOS/Print_at_SoC",
        "is_bundle": True,
        "description": "macOS Apple Silicon (M1/M2/M3)"
    },
    "darwin_x86_64": {
        "asset_name": "Print_at_SoC_macos_x86_64.app.tar.gz",
        "executable_path": "Print_at_SoC.app/Contents/MacOS/Print_at_SoC",
        "is_bundle": True,
        "description": "macOS Intel"
    },
    "linux_x86_64": {
        "asset_name": "Print_at_SoC_linux_x86_64.AppImage",
        "executable_path": "Print_at_SoC",
        "is_bundle": False,
        "description": "Linux (AppImage - universal format)"
    },
    "windows_x86_64": {
        "asset_name": "Print_at_SoC_windows_x86_64_setup.exe",
        "asset_name_fallback": "Print_at_SoC_windows_x86_64.msi",
        "executable_path": "Print_at_SoC.exe",
        "is_bundle": False,
        "description": "Windows 10/11 (64-bit)",
        "installer_type": "nsis"
    }
}

def ensure_dirs():
    """Ensure installation directories exist"""
    INSTALL_DIR.mkdir(parents=True, exist_ok=True)
    BINARY_DIR.mkdir(parents=True, exist_ok=True)
