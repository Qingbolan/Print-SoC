/**
 * Binary downloader for Print@SoC
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  BINARY_DIR,
  VERSION_FILE,
  PLATFORM_BINARIES
} = require('./config');

/**
 * Get platform key for current system
 */
function getPlatformKey() {
  const platform = os.platform();
  const arch = os.arch();

  // Map Node.js arch to our naming
  let normalizedArch = arch;
  if (arch === 'x64' || arch === 'ia32') {
    normalizedArch = 'x64';
  } else if (arch === 'arm64') {
    normalizedArch = 'arm64';
  }

  const platformKey = `${platform}_${normalizedArch}`;

  const platformMap = {
    'darwin_arm64': 'darwin_arm64',
    'darwin_x64': 'darwin_x64',
    'linux_x64': 'linux_x64',
    'win32_x64': 'win32_x64'
  };

  if (!platformMap[platformKey]) {
    throw new Error(
      `Unsupported platform: ${platform} ${arch}\n` +
      `Supported platforms: macOS (Intel/ARM), Windows (x64), Linux (x64)`
    );
  }

  return platformMap[platformKey];
}

/**
 * Try to discover installed Windows executable location.
 */
function findWindowsInstalledExe(productName = 'Print_at_SoC', exeName = 'Print_at_SoC.exe') {
  if (process.platform !== 'win32') return null;

  const candidates = [];
  const pf = process.env['ProgramFiles'];
  const pf86 = process.env['ProgramFiles(x86)'];
  const localApp = process.env['LOCALAPPDATA'];
  if (pf) candidates.push(path.join(pf, productName, exeName));
  if (pf86) candidates.push(path.join(pf86, productName, exeName));
  if (localApp) candidates.push(path.join(localApp, 'Programs', productName, exeName));

  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }

  // Registry probe for DisplayIcon/InstallLocation
  try {
    const { execSync } = require('child_process');
    const roots = [
      'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
      'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
      'HKLM\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall'
    ];
    for (const root of roots) {
      try {
        const out = execSync(`reg query "${root}" /s`, { encoding: 'utf8' });
        const lines = out.split(/\r?\n/);
        let block = [];
        for (const line of lines) {
          if (/^HKEY/i.test(line)) {
            // process previous block
            if (block.length) {
              const blk = block.join('\n');
              if (/DisplayName\s+REG_\w+\s+.*Print_at_SoC/i.test(blk)) {
                const mIcon = blk.match(/DisplayIcon\s+REG_\w+\s+([^\r\n]+)/i);
                if (mIcon && mIcon[1]) {
                  const p = mIcon[1].split(',')[0].trim();
                  if (fs.existsSync(p)) return p;
                }
                const mInst = blk.match(/InstallLocation\s+REG_\w+\s+([^\r\n]+)/i);
                if (mInst && mInst[1]) {
                  const p = path.join(mInst[1].trim(), exeName);
                  if (fs.existsSync(p)) return p;
                }
              }
            }
            block = [line];
          } else if (line.trim()) {
            block.push(line);
          }
        }
        // final block
        if (block.length) {
          const blk = block.join('\n');
          if (/DisplayName\s+REG_\w+\s+.*Print_at_SoC/i.test(blk)) {
            const mIcon = blk.match(/DisplayIcon\s+REG_\w+\s+([^\r\n]+)/i);
            if (mIcon && mIcon[1]) {
              const p = mIcon[1].split(',')[0].trim();
              if (fs.existsSync(p)) return p;
            }
            const mInst = blk.match(/InstallLocation\s+REG_\w+\s+([^\r\n]+)/i);
            if (mInst && mInst[1]) {
              const p = path.join(mInst[1].trim(), exeName);
              if (fs.existsSync(p)) return p;
            }
          }
        }
      } catch (_) { /* ignore */ }
    }
  } catch (_) { /* ignore */ }

  return null;
}

/**
 * Best-effort search for the executable inside any .app bundle.
 * Returns the first plausible binary found under *.app/Contents/MacOS/.
 */
function findMacOsAppBinary(baseDir) {
  try {
    // Recursively walk baseDir to find .app bundles
    const stack = [baseDir];
    while (stack.length) {
      const current = stack.pop();
      const entries = fs.readdirSync(current, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(current, entry.name);
        if (entry.isDirectory()) {
          if (entry.name.endsWith('.app')) {
            const macosDir = path.join(fullPath, 'Contents', 'MacOS');
            if (fs.existsSync(macosDir) && fs.statSync(macosDir).isDirectory()) {
              const files = fs.readdirSync(macosDir);
              // Prefer executable files
              const executables = [];
              const others = [];
              for (const f of files) {
                const p = path.join(macosDir, f);
                if (fs.statSync(p).isFile()) {
                  const mode = fs.statSync(p).mode;
                  if (mode & 0o111) executables.push(p);
                  else others.push(p);
                }
              }
              if (executables.length > 0) return executables[0];
              if (others.length > 0) return others[0];
            }
          } else {
            stack.push(fullPath);
          }
        }
      }
    }
  } catch (_) {
    // Ignore errors and fall back
  }
  return null;
}

/**
 * Get the path to the executable for current platform
 */
function getBinaryPath() {
  const platformKey = getPlatformKey();
  const config = PLATFORM_BINARIES[platformKey];

  const expectedPath = path.join(BINARY_DIR, config.executablePath);

  if (config.isBundle) {
    if (fs.existsSync(expectedPath)) return expectedPath;
    const discovered = findMacOsAppBinary(BINARY_DIR);
    if (discovered) return discovered;
    return expectedPath; // last resort; caller will error if missing
  }

  // Windows MSI installs to system dirs. Try to discover actual install location.
  if (platformKey === 'win32_x64') {
    const discovered = findWindowsInstalledExe();
    if (discovered) return discovered;
  }

  // Linux: if expected binary not found, fall back to AppImage in bin dir
  if (platformKey.startsWith('linux_') && !fs.existsSync(expectedPath)) {
    try {
      const files = fs.readdirSync(BINARY_DIR);
      const appImage = files.find(f => f.toLowerCase().endsWith('.appimage'));
      if (appImage) return path.join(BINARY_DIR, appImage);
    } catch (_) { /* ignore */ }
  }

  return expectedPath;
}

/**
 * Check if binary is already installed
 */
function isInstalled() {
  try {
    const platformKey = getPlatformKey();
    const config = PLATFORM_BINARIES[platformKey];
    const binaryPath = getBinaryPath();
    if (fs.existsSync(binaryPath)) return true;

    if (config.isBundle) {
      const discovered = findMacOsAppBinary(BINARY_DIR);
      return !!(discovered && fs.existsSync(discovered));
    }
    if (platformKey === 'win32_x64') {
      const discovered = findWindowsInstalledExe();
      return !!(discovered && fs.existsSync(discovered));
    }
    // Linux: check for any AppImage as a fallback
    if (platformKey.startsWith('linux_')) {
      try {
        const files = fs.readdirSync(BINARY_DIR);
        const appImage = files.find(f => f.toLowerCase().endsWith('.appimage'));
        if (appImage && fs.existsSync(path.join(BINARY_DIR, appImage))) return true;
      } catch (_) { /* ignore */ }
    }
    return false;
  } catch (_) {
    return false;
  }
}

/**
 * Get the currently installed version
 */
function getInstalledVersion() {
  if (fs.existsSync(VERSION_FILE)) {
    return fs.readFileSync(VERSION_FILE, 'utf8').trim();
  }
  return null;
}

/** Install through the single transactional maintenance implementation. */
async function downloadAndInstall(force = false, options = [], allowBootstrap = true) {
  if (isInstalled() && !force) return;
  const { MaintenanceBridge } = require('./maintenance');
  const status = new MaintenanceBridge().run(['self', 'update', ...(force ? ['--force'] : []), ...options], { allowBootstrap });
  if (status !== 0) throw new Error(`Desktop setup exited with status ${status}`);
}

async function checkAndInstall() {
  if (!isInstalled()) {
    await downloadAndInstall(false, [], false);
  }
}

module.exports = {
  getPlatformKey,
  getBinaryPath,
  isInstalled,
  getInstalledVersion,
  downloadAndInstall,
  checkAndInstall
};
