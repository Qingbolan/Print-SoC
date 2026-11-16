const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { MaintenanceBridge } = require('../lib/maintenance');
const { VERSION } = require('../lib/config');
let passed = 0;
function test(name, run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'print-soc-runtime-test-'));
  try { run(directory); passed += 1; console.log(`✓ ${name}`); }
  finally { fs.rmSync(directory, { recursive: true, force: true }); }
}
function fixture(directory, handler) {
  const runtimeRoot = path.join(directory, 'maintenance-runtime');
  const calls = [];
  const python = path.join(runtimeRoot, VERSION, 'bin', 'python');
  const bridge = new MaintenanceBridge({
    env: { PYTHONPATH: '/unrelated/source', PIP_TARGET: '/unrelated/site-packages' },
    interactive: false, runtimeRoot,
    spawnSync(command, args, options) {
      calls.push({ command, args, options });
      if (handler) { const result = handler(command, args, options); if (result) return result; }
      if (args.includes('-c')) {
        const source = args[args.length - 1];
        return { status: source.includes('import sys, venv') || command.startsWith(runtimeRoot) ? 0 : 1 };
      }
      if (args.includes('venv')) {
        const stage = args[args.length - 1];
        fs.mkdirSync(path.join(stage, 'bin'));
        fs.writeFileSync(path.join(stage, 'bin', 'python'), 'isolated-python');
      }
      return { status: 0 };
    },
  });
  return { bridge, calls, runtimeRoot, python };
}
function provision(directory, handler) {
  const value = fixture(directory, handler);
  value.bridge.run(['self', 'update', '--yes']);
  value.calls.length = 0;
  return value;
}
test('Explicit installation stages the exact npm version and retains terminal progress', directory => {
  const { bridge, calls, runtimeRoot, python } = fixture(directory);
  assert.strictEqual(bridge.run(['self', 'update', '--force', '--yes']), 0);
  assert(fs.existsSync(python));
  const pip = calls.find(call => call.args.includes('pip'));
  assert(pip.command.startsWith(path.join(runtimeRoot, '.stage-')));
  assert(pip.args.includes(`print-at-soc==${VERSION}`));
  assert(pip.args.includes('--isolated'));
  assert.strictEqual(pip.options.stdio, 'inherit');
  assert(calls.every(call => call.options.env.PRINT_AT_SOC_NO_POSTINSTALL === '1'));
  assert(calls.filter(call => call.args.includes('-c')).every(call => call.args.includes('-I')));
  const invocation = calls[calls.length - 1];
  assert.strictEqual(invocation.command, python);
  assert.strictEqual(invocation.options.env.PSOC_OWNED_RUNTIME_ROOT, runtimeRoot);
  assert(!fs.readdirSync(runtimeRoot).some(name => name.startsWith('.stage-')));
});
test('Subsequent invocations reuse the matching private runtime offline', directory => {
  const { bridge, calls, python } = provision(directory);
  bridge.run(['self', 'update', '--check']);
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].command, python);
  assert(calls[0].args.includes('--check'));
});
test('Unattended bootstrap requires authorization before any directory mutation', directory => {
  const { bridge, calls, runtimeRoot } = fixture(directory);
  assert.throws(() => bridge.run(['self', 'update']), /requires --yes/);
  assert(!fs.existsSync(runtimeRoot));
  assert(calls.every(call => call.args.includes('-c')));
});
test('Check, help, recovery and ordinary launch never bootstrap dependencies', directory => {
  for (const args of [['self', 'update', '--check'], ['self', 'update', '--help'], ['self', 'update', '--yes']]) {
    const { bridge, calls, runtimeRoot } = fixture(directory);
    assert.throws(() => bridge.run(args, { allowBootstrap: false }), /Run "print-soc --install"/);
    assert.strictEqual(bridge.recover(), 0);
    bridge.maybeAutoUpdate();
    assert(!fs.existsSync(runtimeRoot));
    assert(calls.every(call => call.args.includes('-c')));
  }
});
test('No Python interpreter gives actionable guidance without creating an installation', directory => {
  const { bridge, runtimeRoot } = fixture(directory, () => ({ status: 1 }));
  assert.throws(() => bridge.run(['self', 'update', '--yes']), /Python 3.8\+ with venv is required/);
  assert(!fs.existsSync(runtimeRoot));
});
test('Failed package download removes staging and preserves the existing desktop', directory => {
  const desktop = path.join(directory, 'existing-desktop');
  fs.writeFileSync(desktop, 'old-desktop');
  const { bridge, calls, runtimeRoot, python } = fixture(directory, (command, args) => args.includes('pip') ? { status: 1 } : null);
  assert.throws(() => bridge.run(['self', 'update', '--yes']), /desktop was not changed/);
  assert.strictEqual(fs.readFileSync(desktop, 'utf8'), 'old-desktop');
  assert(!fs.existsSync(python));
  assert(!fs.readdirSync(runtimeRoot).some(name => name.startsWith('.stage-')));
  assert(!calls.some(call => call.args.includes('print_at_soc')));
});
test('Bootstrap cancellation keeps exit status 130 and removes its staging area', directory => {
  const { bridge, runtimeRoot } = fixture(directory, (command, args) => args.includes('pip') ? { status: null, signal: 'SIGINT' } : null);
  assert.throws(() => bridge.run(['self', 'update', '--yes']), error => error.exitCode === 130);
  assert.deepStrictEqual(fs.readdirSync(runtimeRoot), ['.owner.json']);
});
test('Purge removes owned Python only after the running cleanup service has returned', directory => {
  let python;
  const state = provision(directory, (command, args, options) => {
    if (options.env.PSOC_MAINTENANCE_RESULT) {
      assert(fs.existsSync(python));
      fs.writeFileSync(options.env.PSOC_MAINTENANCE_RESULT, JSON.stringify({ status: 'uninstalled', purge: true }));
    }
    return null;
  });
  python = state.python;
  assert.strictEqual(state.bridge.run(['self', 'uninstall', '--purge', '--yes']), 0);
  assert(!fs.existsSync(state.runtimeRoot));
  assert(!state.calls.some(call => call.command === 'npm'));
});
test('Keep-data uninstall retains its private runtime and CLI for reinstall', directory => {
  const { bridge, python, calls } = provision(directory, (command, args, options) => {
    if (options.env.PSOC_MAINTENANCE_RESULT) fs.writeFileSync(options.env.PSOC_MAINTENANCE_RESULT, JSON.stringify({ status: 'uninstalled', purge: false }));
    return null;
  });
  bridge.run(['self', 'uninstall', '--keep-data', '--yes']);
  assert(fs.existsSync(python));
  assert(!calls.some(call => call.command === 'npm'));
});
test('Preview and failed cleanup never remove the private runtime', directory => {
  for (const fail of [false, true]) {
    const { bridge, python } = provision(directory, (command, args, options) => {
      if (options.env.PSOC_MAINTENANCE_RESULT) {
        fs.writeFileSync(options.env.PSOC_MAINTENANCE_RESULT, JSON.stringify({ status: 'uninstalled', purge: true }));
        return { status: fail ? 1 : 0 };
      }
      return null;
    });
    const args = ['self', 'uninstall', '--purge', '--yes', ...(fail ? [] : ['--dry-run'])];
    assert.strictEqual(bridge.run(args), fail ? 1 : 0);
    assert(fs.existsSync(python));
  }
});
test('Cleanup preserves unrelated files and rejects a redirected version directory', directory => {
  const { bridge, runtimeRoot } = provision(directory);
  const unrelated = path.join(runtimeRoot, 'notes.txt');
  fs.writeFileSync(unrelated, 'keep');
  const target = path.join(directory, 'external');
  fs.mkdirSync(target);
  fs.writeFileSync(path.join(target, 'important.txt'), 'keep');
  fs.symlinkSync(target, path.join(runtimeRoot, '1.2.3'), 'dir');
  assert.throws(() => bridge.python.cleanup(), /symlink/);
  assert(fs.existsSync(path.join(target, 'important.txt')));
  assert(fs.existsSync(unrelated));
});
test('Runtime roots with unknown contents or symlink ancestors are never claimed', directory => {
  const { bridge, runtimeRoot } = fixture(directory);
  fs.mkdirSync(runtimeRoot);
  fs.writeFileSync(path.join(runtimeRoot, 'important.txt'), 'keep');
  assert.throws(() => bridge.run(['self', 'update', '--yes']), /unrecognized contents/);
  assert(fs.existsSync(path.join(runtimeRoot, 'important.txt')));
  fs.rmSync(runtimeRoot, { recursive: true });
  fs.symlinkSync(path.join(directory, 'missing-target'), runtimeRoot, 'dir');
  assert.throws(() => bridge.python.bootstrap(), /symbolic link/);
  assert(!fs.existsSync(path.join(directory, 'missing-target')));
});
console.log(`${passed} runtime tests passed`);
