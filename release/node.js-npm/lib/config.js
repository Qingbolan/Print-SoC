/**
 * Configuration for Print@SoC npm package
 */

const path = require('path');
const os = require('os');

// Version (read from package.json to avoid drift)
let VERSION = '0.0.0';
try {
  VERSION = require('../package.json').version || VERSION;
} catch (_) {}

// GitHub repository
const GITHUB_REPO = 'Qingbolan/Print-SoC';
const GITHUB_API_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;

// Local installation paths
const HOME_DIR = os.homedir();
const INSTALL_DIR = path.join(HOME_DIR, '.PrintAtSoC');
const BINARY_DIR = path.join(INSTALL_DIR, 'bin');
const VERSION_FILE = path.join(INSTALL_DIR, 'version.txt');

// Platform-specific binary names and configurations
const PLATFORM_BINARIES = {
  'darwin_arm64': {
    assetName: 'Print_at_SoC_macos_aarch64.app.tar.gz',
    executablePath: 'Print_at_SoC.app/Contents/MacOS/Print_at_SoC',
    isBundle: true,
    description: 'macOS Apple Silicon (M1/M2/M3)'
  },
  'darwin_x64': {
    assetName: 'Print_at_SoC_macos_x86_64.app.tar.gz',
    executablePath: 'Print_at_SoC.app/Contents/MacOS/Print_at_SoC',
    isBundle: true,
    description: 'macOS Intel'
  },
  'linux_x64': {
    assetName: 'Print_at_SoC_linux_x86_64.AppImage',
    executablePath: 'Print_at_SoC',
    isBundle: false,
    description: 'Linux (AppImage - universal format)'
  },
  'win32_x64': {
    assetName: 'Print_at_SoC_windows_x86_64_setup.exe',
    assetNameFallback: 'Print_at_SoC_windows_x86_64.msi',
    executablePath: 'Print_at_SoC.exe',
    isBundle: false,
    description: 'Windows 10/11 (64-bit)',
    installerType: 'nsis'
  }
};

module.exports = {
  VERSION,
  GITHUB_REPO,
  GITHUB_API_URL,
  HOME_DIR,
  INSTALL_DIR,
  BINARY_DIR,
  VERSION_FILE,
  PLATFORM_BINARIES
};
