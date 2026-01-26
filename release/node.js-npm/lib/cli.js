#!/usr/bin/env node

/**
 * Command-line interface for Print@SoC
 */

const { spawn } = require('child_process');
const os = require('os');

const {
  checkAndInstall,
  getBinaryPath,
  isInstalled,
  downloadAndInstall
} = require('./downloader');

const { VERSION } = require('./config');

/**
 * Print usage information
 */
function printUsage() {
  console.log(`
Print@SoC v${VERSION}
Smart Printing for NUS SoC

Usage:
  print-at-soc           Launch the application
  print-at-soc --help    Show this help message
  print-at-soc --version Show version information
  print-at-soc --install Force reinstall the binary
  print-at-soc --path    Show binary installation path
  print-at-soc --doctor  Linux: check runtime deps and exit
  print-at-soc --no-check  Linux: skip runtime checks (warn-only)

Examples:
  print-at-soc          # Start the application
  `);
}

function linuxRuntimeCheck() {
  try {
    const { execSync } = require('child_process');
    const fs = require('fs');
    function hasLib(name) {
      try {
        const out = execSync('ldconfig -p', { encoding: 'utf8' });
        return out.includes(name);
      } catch {
        return false;
      }
    }
    const missing = [];
    const hasWebkit = hasLib('libwebkit2gtk-4.1.so.0') || hasLib('libwebkit2gtk-4.0.so.37');
    if (!hasWebkit) missing.push('WebKitGTK');
    if (!hasLib('libgtk-3.so.0')) missing.push('GTK3');
    if (!(hasLib('libayatana-appindicator3.so.1') || hasLib('libappindicator3.so') || hasLib('libappindicator-gtk3.so'))) {
      missing.push('AppIndicator3');
    }
    const fuseMissing = !hasLib('libfuse.so.2');
    if (fuseMissing) missing.push('FUSE (libfuse2)');
    if (!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) missing.push('GUI session (X11/Wayland)');

    if (!missing.length) return { ok: true, fuseMissing };

    let distro = '';
    try {
      const osRelease = fs.readFileSync('/etc/os-release', 'utf8');
      const idLike = (osRelease.match(/^ID_LIKE=(.*)$/m)?.[1] || '').replace(/"/g, '').toLowerCase();
      const id = (osRelease.match(/^ID=(.*)$/m)?.[1] || '').replace(/"/g, '').toLowerCase();
      distro = idLike || id;
    } catch {}

    console.error('Missing Linux runtime dependencies:');
    for (const m of missing) console.error(`  - ${m}`);
    console.error('\nInstall suggestions:');
    if (distro.includes('debian') || distro.includes('ubuntu')) {
      console.error('  sudo apt update && sudo apt install -y libwebkit2gtk-4.1-0 libgtk-3-0 libayatana-appindicator3-1 libfuse2');
    } else if (distro.includes('fedora') || distro.includes('rhel') || distro.includes('centos')) {
      console.error('  sudo dnf install -y webkit2gtk4.1 gtk3 libappindicator-gtk3 fuse');
    } else if (distro.includes('arch') || distro.includes('manjaro')) {
      console.error('  sudo pacman -S --needed webkit2gtk-4.1 gtk3 libappindicator-gtk3 fuse2');
    } else if (distro.includes('suse') || distro.includes('opensuse')) {
      console.error('  sudo zypper install -y libwebkit2gtk-4_1-0 gtk3-tools libappindicator3-1 libfuse2');
    } else {
      console.error('  Install WebKitGTK 4.1+, GTK3, AppIndicator3, and libfuse2 via your package manager.');
    }

    return { ok: missing.length === 1 && missing[0].startsWith('FUSE'), fuseMissing };
  } catch (e) {
    return { ok: true, fuseMissing: false };
  }
}

/**
 * Main CLI function
 */
async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    printUsage();
    return 0;
  }

  if (args.includes('--version') || args.includes('-v')) {
    console.log(`Print@SoC v${VERSION}`);
    return 0;
  }

  if (args.includes('--install')) {
    try {
      await downloadAndInstall(true);
      return 0;
    } catch (error) {
      console.error(`Installation failed: ${error.message}`);
      return 1;
    }
  }

  if (args.includes('--path')) {
    if (isInstalled()) {
      console.log(`Binary path: ${getBinaryPath()}`);
      console.log('Installed: Yes');
    } else {
      console.log('Binary not installed yet. Run "print-at-soc" to install.');
    }
    return 0;
  }

  try {
    await checkAndInstall();
  } catch (error) {
    console.error(`Error during installation check: ${error.message}`);
    return 1;
  }

  const binaryPath = getBinaryPath();

  if (!isInstalled()) {
    console.error(`Error: Binary not found at ${binaryPath}`);
    console.error('Try running "print-at-soc --install" to reinstall');
    return 1;
  }

  let extraEnv = {};
  if (os.platform() === 'linux') {
    const skipChecks = args.includes('--no-check') || !!process.env.PRINT_AT_SOC_NO_CHECKS;
    const strict = !!process.env.PRINT_AT_SOC_STRICT_CHECKS;
    if (args.includes('--doctor')) {
      linuxRuntimeCheck();
      return 0;
    }
    if (!skipChecks) {
      const { ok, fuseMissing } = linuxRuntimeCheck();
      if (!ok && strict) return 1;
      if (fuseMissing) {
        console.error('\nFUSE missing: will attempt extraction-run fallback.');
        extraEnv = { APPIMAGE_EXTRACT_AND_RUN: '1' };
      }
    }
  }

  console.log('Launching Print@SoC...');

  return new Promise((resolve) => {
    let command = binaryPath;
    let commandArgs = args;

    if (os.platform() === 'darwin' && binaryPath.includes('.app/')) {
      const appBundle = binaryPath.split('.app/')[0] + '.app';

      try {
        const { execSync } = require('child_process');
        execSync(`xattr -dr com.apple.quarantine "${appBundle}"`, {
          stdio: 'ignore'
        });
      } catch (error) {}

      command = 'open';
      commandArgs = [appBundle, ...args];
    }

    const wrapperFlags = new Set(['--no-check', '--doctor', '--install', '--path', '--help', '-h', '--version', '-v']);
    const filteredArgs = commandArgs.filter(a => !wrapperFlags.has(a));

    const child = spawn(command, filteredArgs, {
      stdio: 'inherit',
      detached: false,
      env: { ...process.env, ...extraEnv }
    });

    child.on('error', (error) => {
      console.error(`Failed to launch application: ${error.message}`);
      resolve(1);
    });

    child.on('exit', (code) => {
      resolve(code || 0);
    });

    process.on('SIGINT', () => {
      child.kill('SIGINT');
      console.log('\nApplication closed by user');
      resolve(0);
    });
  });
}

main()
  .then((exitCode) => {
    process.exit(exitCode);
  })
  .catch((error) => {
    console.error('Unexpected error:', error);
    process.exit(1);
  });
