/** Version-scoped Python runtime owned by the npm launcher, never global pip. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { VERSION } = require('./config');

class PythonRuntime {
  constructor({ spawnSync, env, platform, root, version = VERSION }) {
    this.spawnSync = spawnSync;
    this.env = { ...env, PRINT_AT_SOC_NO_POSTINSTALL: '1' };
    this.platform = platform;
    this.version = version;
    this.root = root || path.join(os.homedir(), '.PrintAtSoC', 'maintenance-runtime');
  }

  executable(directory) {
    return path.join(directory, this.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  }

  candidates() {
    return this.env.PSOC_PYTHON
      ? [[this.env.PSOC_PYTHON, []]]
      : [['python3', []], ['python', []], ...(this.platform === 'win32' ? [['py', ['-3']]] : [])];
  }

  probe(command, prefix, source) {
    const result = this.spawnSync(command, [...prefix, '-I', '-c', source], {
      stdio: 'ignore', timeout: 5000, windowsHide: true, env: this.env,
    });
    return !result.error && result.status === 0;
  }

  compatible(command, prefix = []) {
    return this.probe(command, prefix,
      `import print_at_soc.maintenance; from print_at_soc import __version__; assert __version__ == ${JSON.stringify(this.version)}`);
  }

  find() {
    const local = this.executable(path.join(this.root, this.version));
    if (this.ownedRoot() && this.ownedVersion(this.version) && fs.existsSync(local)
        && this.compatible(local)) return { command: local, prefix: [] };
    for (const [command, prefix] of this.candidates()) {
      if (this.compatible(command, prefix)) return { command, prefix };
    }
    return null;
  }

  _validateRoot() {
    for (const candidate of [path.dirname(this.root), this.root]) {
      let entry;
      try { entry = fs.lstatSync(candidate); } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      if (entry && (entry.isSymbolicLink() || !entry.isDirectory())) {
        throw new Error(`Maintenance runtime path must be a directory, never a symbolic link: ${candidate}`);
      }
    }
  }

  ownedRoot() {
    this._validateRoot();
    const receipt = path.join(this.root, '.owner.json');
    if (!fs.existsSync(receipt) || !fs.lstatSync(receipt).isFile()) return null;
    const owner = JSON.parse(fs.readFileSync(receipt, 'utf8'));
    return owner.package === 'print-at-soc' && owner.manager === 'npm' ? this.root : null;
  }

  ownedVersion(version) {
    const directory = path.join(this.root, version);
    if (!fs.existsSync(directory) || !fs.lstatSync(directory).isDirectory()) return false;
    const receipt = path.join(directory, '.print-soc-runtime.json');
    return fs.existsSync(receipt) && fs.lstatSync(receipt).isFile()
      && JSON.parse(fs.readFileSync(receipt, 'utf8')).version === version;
  }

  bootstrap() {
    if (!/^\d+\.\d+\.\d+$/.test(this.version)) throw new Error('The npm package has no valid Tide version');
    const candidate = this.candidates().find(([command, prefix]) => this.probe(command, prefix,
      'import sys, venv; assert sys.version_info >= (3, 8)'));
    if (!candidate) throw new Error('Python 3.8+ with venv is required. Install Python, then rerun print-soc --install; no desktop files were changed.');
    this._validateRoot();
    if (fs.existsSync(this.root) && !this.ownedRoot() && fs.readdirSync(this.root).length) {
      throw new Error('The maintenance runtime directory has unrecognized contents; inspect it before retrying.');
    }
    fs.mkdirSync(this.root, { recursive: true });
    const receipt = path.join(this.root, '.owner.json');
    if (!fs.existsSync(receipt)) fs.writeFileSync(receipt,
      JSON.stringify({ package: 'print-at-soc', manager: 'npm' }), { flag: 'wx', mode: 0o600 });
    const destination = path.join(this.root, this.version);
    const stage = fs.mkdtempSync(path.join(this.root, '.stage-'));
    const [command, prefix] = candidate;
    const execute = (binary, args) => {
      const result = this.spawnSync(binary, args, { stdio: 'inherit', shell: false, env: this.env });
      if (result.error || result.status !== 0) {
        const error = new Error('Shared maintenance runtime setup failed. The desktop was not changed; rerun print-soc --install to retry.');
        error.exitCode = result.signal === 'SIGINT' || result.status === 130 ? 130 : 1;
        throw error;
      }
    };
    console.log(`Preparing Print@SoC maintenance runtime ${this.version}\nLocation: ${destination}`);
    try {
      console.log('[1/3] Create an isolated Python environment');
      execute(command, [...prefix, '-I', '-m', 'venv', stage]);
      const stagedPython = this.executable(stage);
      console.log('[2/3] Install the matching maintenance package from PyPI');
      execute(stagedPython, ['-I', '-m', 'pip', '--isolated', 'install', '--disable-pip-version-check', '--no-input', `print-at-soc==${this.version}`]);
      console.log('[3/3] Verify the runtime before opening the desktop setup wizard');
      if (!this.compatible(stagedPython)) throw new Error('The installed maintenance runtime did not match the npm package version');
      fs.writeFileSync(path.join(stage, '.print-soc-runtime.json'), JSON.stringify({ version: this.version }), { flag: 'wx', mode: 0o600 });
      if (fs.existsSync(destination)) {
        // Another explicit installer may have finished while pip was running.
        if (!this.ownedVersion(this.version) || !this.compatible(this.executable(destination))) throw new Error('An incomplete runtime already exists. Remove that version directory after inspecting it, then retry.');
      } else {
        fs.renameSync(stage, destination);
      }
      return { command: this.executable(destination), prefix: [] };
    } finally {
      fs.rmSync(stage, { recursive: true, force: true });
    }
  }

  cleanup() {
    if (!this.ownedRoot()) return;
    // Only generations bearing our receipts are owned; retain unrelated files.
    for (const name of fs.readdirSync(this.root)) {
      if (!/^\d+\.\d+\.\d+$/.test(name)) continue;
      const directory = path.join(this.root, name);
      if (fs.lstatSync(directory).isSymbolicLink()) throw new Error('Refusing to follow a maintenance runtime symlink during cleanup');
      if (!this.ownedVersion(name)) {
        throw new Error(`Runtime ownership could not be verified: ${directory}; cleanup is incomplete`);
      }
      fs.rmSync(directory, { recursive: true });
    }
    const remaining = fs.readdirSync(this.root);
    if (remaining.length === 1 && remaining[0] === '.owner.json') {
      fs.unlinkSync(path.join(this.root, '.owner.json'));
      fs.rmdirSync(this.root);
    }
  }
}

module.exports = { PythonRuntime };
