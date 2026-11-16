/**
 * Package-manager boundary for the shared Print@SoC maintenance service.
 * Desktop release selection and transactions belong to the Python service.
 * This boundary owns only its private Python runtime and npm package removal.
 */
const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PythonRuntime } = require('./python-runtime');

class MaintenanceBridge {
  constructor(options = {}) {
    this.spawnSync = options.spawnSync || childProcess.spawnSync;
    this.env = { ...(options.env || process.env), PRINT_AT_SOC_NO_POSTINSTALL: '1' };
    this.platform = options.platform || process.platform;
    this.stderr = options.stderr || console;
    this.interactive = options.interactive === undefined
      ? Boolean(process.stdin.isTTY && process.stdout.isTTY) : options.interactive;
    this.runtime = undefined;
    this.python = new PythonRuntime({ spawnSync: this.spawnSync, env: this.env, platform: this.platform, root: options.runtimeRoot });
  }

  findRuntime(required = true) {
    if (this.runtime !== undefined) {
      if (!this.runtime && required) this.missingRuntime();
      return this.runtime;
    }
    this.runtime = this.python.find();
    if (this.runtime) return this.runtime;
    this.runtime = null;
    if (required) this.missingRuntime();
    return null;
  }

  missingRuntime() {
    throw new Error(
      'The matching Print@SoC maintenance runtime is not available. Run "print-soc --install" ' +
      'to prepare an isolated runtime using Python 3.8+, or set PSOC_PYTHON to a Python ' +
      'environment containing this exact print-at-soc version. Your existing desktop installation was not changed.'
    );
  }

  exitStatus(result) {
    if (result.error) throw result.error;
    if (result.signal === 'SIGINT') return 130;
    if (result.signal === 'SIGTERM') return 143;
    return Number.isInteger(result.status) ? result.status : 1;
  }

  invoke(args, additionalEnv = {}) {
    const runtime = this.findRuntime();
    const ownedRoot = this.python.ownedRoot();
    return this.exitStatus(this.spawnSync(runtime.command,
      [...runtime.prefix, '-I', '-m', 'print_at_soc', ...args], {
        stdio: 'inherit', shell: false,
        env: { ...this.env, PSOC_PACKAGE_MANAGER: 'npm',
          ...(ownedRoot ? { PSOC_OWNED_RUNTIME_ROOT: ownedRoot } : {}), ...additionalEnv },
      }));
  }

  run(args, { allowBootstrap = true } = {}) {
    const explicitUpdate = args[0] === 'self' && args[1] === 'update';
    const inspection = args.includes('--check') || args.includes('--help') || args.includes('-h');
    if (allowBootstrap && explicitUpdate && !inspection && !this.findRuntime(false)) {
      if ((!this.interactive || args.includes('--non-interactive')) && !args.includes('--yes') && !args.includes('-y')) {
        throw new Error('Preparing the maintenance runtime without interaction requires --yes. Run print-soc --install --yes to continue.');
      }
      this.runtime = this.python.bootstrap();
    }
    const uninstall = args[0] === 'self' && args[1] === 'uninstall';
    const removeCli = uninstall && args.includes('--remove-cli');
    if (!uninstall) return this.invoke(args);
    const dryRun = args.includes('--dry-run') || args.includes('--help') || args.includes('-h');
    if (removeCli && !dryRun && (!this.interactive || args.includes('--non-interactive')) && !args.includes('--yes')) {
      throw new Error('Removing the npm CLI without interaction requires --yes. Preview first with --dry-run.');
    }
    // A successful exit alone could mean a declined review. Require a completion
    // receipt written only after the Python service completes the actual removal.
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'print-soc-uninstall-'));
    const receipt = path.join(directory, 'result.json');
    try {
      const status = this.invoke(args.filter(arg => arg !== '--remove-cli'), {
        ...(removeCli ? { PSOC_REMOVE_CLI: '1' } : {}), PSOC_MAINTENANCE_RESULT: receipt,
      });
      if (status !== 0 || dryRun || !fs.existsSync(receipt)) return status;
      const result = JSON.parse(fs.readFileSync(receipt, 'utf8'));
      if (result.status !== 'uninstalled') return status;
      if (result.purge || removeCli) this.python.cleanup();
      if (!removeCli) return status;
      // Remove only this npm package. Global Python environments and other
      // packages are never removed by the npm launcher.
      const npm = this.platform === 'win32' ? 'cmd.exe' : 'npm';
      const npmArgs = this.platform === 'win32'
        ? ['/d', '/s', '/c', 'npm uninstall -g print-at-soc']
        : ['uninstall', '-g', 'print-at-soc'];
      return this.exitStatus(this.spawnSync(npm, npmArgs, {
        stdio: 'inherit', shell: false, env: this.env,
      }));
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  }

  recover() {
    // Recovery is local and runs before checking whether a binary exists. An
    // interrupted directory swap must not be mistaken for a fresh installation.
    const runtime = this.findRuntime(false);
    if (!runtime) return 0;
    return this.exitStatus(this.spawnSync(runtime.command,
      [...runtime.prefix, '-I', '-c', 'from print_at_soc.update_service import UpdateService; UpdateService().recover()'], {
        stdio: 'inherit', shell: false,
        env: { ...this.env, PSOC_PACKAGE_MANAGER: 'npm' },
      }));
  }

  maybeAutoUpdate() {
    // Called only on ordinary desktop launches. MCP and structured print jobs
    // never execute update checks or receive maintenance output.
    const runtime = this.findRuntime(false);
    if (!runtime) return;
    try {
      const result = this.spawnSync(runtime.command,
        [...runtime.prefix, '-I', '-c', 'from print_at_soc.maintenance import maybe_auto_update; raise SystemExit(maybe_auto_update() or 0)'], {
          stdio: 'inherit', shell: false,
          env: { ...this.env, PSOC_PACKAGE_MANAGER: 'npm' },
        });
      if (result.status === 130 || result.signal === 'SIGINT') return 130;
      if (result.error || (result.status !== 0 && result.status !== null)) {
        this.stderr.error('Automatic update check did not finish; continuing with the installed application. Use print-soc self update --check for details.');
      }
    } catch (_) {
      this.stderr.error('Automatic update check is unavailable; continuing with the installed application.');
    }
  }
}

module.exports = { MaintenanceBridge };
