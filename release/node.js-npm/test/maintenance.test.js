const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { MaintenanceBridge } = require('../lib/maintenance');

let passed = 0;
function test(name, run) {
  run();
  passed += 1;
  console.log(`✓ ${name}`);
}

function bridgeWith(handler, extra = {}) {
  const calls = [];
  const spawnSync = (command, args, options) => {
    calls.push({ command, args, options });
    return handler(command, args, options);
  };
  return { bridge: new MaintenanceBridge({ spawnSync, env: {}, interactive: false, ...extra }), calls };
}

test('Missing runtime fails a read-only check without preparing dependencies', () => {
  const { bridge, calls } = bridgeWith(() => ({ status: 1 }));
  assert.throws(() => bridge.run(['self', 'update', '--check']), /matching Print@SoC maintenance runtime/);
  assert(calls.every(call => call.args.includes('-c')));
  assert(calls.every(call => call.options.stdio === 'ignore'));
});

test('Python module invocation preserves arguments and terminal input', () => {
  const { bridge, calls } = bridgeWith(() => ({ status: 0 }), { env: { PSOC_PYTHON: '/runtime with spaces/python' } });
  assert.strictEqual(bridge.run(['self', 'update', '--check', '--plain']), 0);
  assert.strictEqual(calls.length, 2);
  assert.deepStrictEqual(calls[1].args, ['-I', '-m', 'print_at_soc', 'self', 'update', '--check', '--plain']);
  assert.strictEqual(calls[1].command, '/runtime with spaces/python');
  assert.strictEqual(calls[1].options.stdio, 'inherit');
  assert.strictEqual(calls[1].options.shell, false);
  assert.strictEqual(calls[1].options.env.PSOC_PACKAGE_MANAGER, 'npm');
});

test('Cancellation and error exit statuses are preserved', () => {
  const { bridge } = bridgeWith((command, args) => args.includes('-c') ? ({ status: 0 }) : ({ status: null, signal: 'SIGINT' }));
  assert.strictEqual(bridge.run(['self', 'update']), 130);
});

test('Unattended CLI removal requires explicit yes', () => {
  const { bridge, calls } = bridgeWith(() => ({ status: 0 }));
  assert.throws(() => bridge.run(['self', 'uninstall', '--remove-cli']), /requires --yes/);
  assert.strictEqual(calls.length, 0);
});

test('Declined cleanup cannot remove the npm launcher', () => {
  const { bridge, calls } = bridgeWith(() => ({ status: 0 }));
  assert.strictEqual(bridge.run(['self', 'uninstall', '--remove-cli', '--yes']), 0);
  assert(!calls.some(call => call.command === 'npm'));
  const invocation = calls[1];
  assert(!invocation.args.includes('--remove-cli'));
  assert.strictEqual(invocation.options.env.PSOC_REMOVE_CLI, '1');
  assert(!fs.existsSync(path.dirname(invocation.options.env.PSOC_MAINTENANCE_RESULT)));
});

test('A real cleanup receipt gates npm removal and never invokes global pip', () => {
  const { bridge, calls } = bridgeWith((command, args, options) => {
    if (options.env.PSOC_MAINTENANCE_RESULT) {
      fs.writeFileSync(options.env.PSOC_MAINTENANCE_RESULT, JSON.stringify({ status: 'uninstalled' }), { flag: 'wx' });
    }
    return { status: 0 };
  });
  assert.strictEqual(bridge.run(['self', 'uninstall', '--remove-cli', '--yes', '--purge']), 0);
  const removal = calls[calls.length - 1];
  assert.strictEqual(removal.command, 'npm');
  assert.deepStrictEqual(removal.args, ['uninstall', '-g', 'print-at-soc']);
  assert(!calls.some(call => call.args.includes('pip')));
});

test('Dry-run never removes npm even if a child writes a receipt', () => {
  const { bridge, calls } = bridgeWith((command, args, options) => {
    if (options.env.PSOC_MAINTENANCE_RESULT) fs.writeFileSync(options.env.PSOC_MAINTENANCE_RESULT, '{"status":"uninstalled"}');
    return { status: 0 };
  });
  assert.strictEqual(bridge.run(['self', 'uninstall', '--remove-cli', '--dry-run']), 0);
  assert(!calls.some(call => call.command === 'npm'));
});

test('Failed cleanup never removes npm even if a receipt exists', () => {
  const { bridge, calls } = bridgeWith((command, args, options) => {
    if (options.env.PSOC_MAINTENANCE_RESULT) {
      fs.writeFileSync(options.env.PSOC_MAINTENANCE_RESULT, '{"status":"uninstalled"}');
      return { status: 1 };
    }
    return { status: 0 };
  });
  assert.strictEqual(bridge.run(['self', 'uninstall', '--remove-cli', '--yes']), 1);
  assert(!calls.some(call => call.command === 'npm'));
});

test('Automatic maintenance is quiet when Python is missing', () => {
  const errors = [];
  const { bridge } = bridgeWith(() => ({ error: new Error('ENOENT'), status: null }), { stderr: { error: text => errors.push(text) } });
  bridge.maybeAutoUpdate();
  assert.deepStrictEqual(errors, []);
});

test('Windows uses py -3 and a fixed npm command', () => {
  const { bridge, calls } = bridgeWith((command, args, options) => {
    if (args.includes('-c')) return { status: command === 'py' ? 0 : 1 };
    if (options.env.PSOC_MAINTENANCE_RESULT) fs.writeFileSync(options.env.PSOC_MAINTENANCE_RESULT, '{"status":"uninstalled"}');
    return { status: 0 };
  }, { platform: 'win32' });
  bridge.run(['self', 'uninstall', '--remove-cli', '--yes']);
  const invoke = calls.find(call => call.args.includes('-m'));
  assert.deepStrictEqual(invoke.args.slice(0, 4), ['-3', '-I', '-m', 'print_at_soc']);
  const removal = calls[calls.length - 1];
  assert.strictEqual(removal.command, 'cmd.exe');
  assert.deepStrictEqual(removal.args, ['/d', '/s', '/c', 'npm uninstall -g print-at-soc']);
});

test('Offline recovery runs directly through the shared transaction service', () => {
  const { bridge, calls } = bridgeWith((command, args) => ({ status: args.includes('-c') && args[args.length - 1].includes('recover()') ? 1 : 0 }));
  assert.strictEqual(bridge.recover(), 1);
  assert.strictEqual(calls.length, 2);
  assert(calls[1].args[calls[1].args.length - 1].includes('UpdateService().recover()'));
  assert(!calls[1].args.some(value => value.includes('latest')));
  assert.strictEqual(calls[1].options.stdio, 'inherit');
});

test('Unavailable optional runtime does not prevent launch recovery probe', () => {
  const { bridge } = bridgeWith(() => ({ status: 1 }));
  assert.strictEqual(bridge.recover(), 0);
});

function loadCli(args, installed = true, recoveryStatus = 0) {
  const calls = [];
  const fakeProcess = { argv: ['node', 'cli.js', ...args], env: {}, on() {} };
  class Bridge {
    run(options) { calls.push(['maintenance', options]); return 130; }
    recover() { calls.push(['recover']); return recoveryStatus; }
    maybeAutoUpdate() { calls.push(['auto']); }
  }
  const fakeSpawn = () => ({ on(event, fn) { if (event === 'exit') fn(0); } });
  const module = { exports: {} };
  const fakeRequire = name => {
    if (name === 'child_process') return { spawn: fakeSpawn };
    if (name === './maintenance') return { MaintenanceBridge: Bridge };
    if (name === './downloader') return {
      isInstalled: () => installed, getBinaryPath: () => '/safe/Print_at_SoC',
      checkAndInstall: async () => { calls.push(['install']); },
    };
    if (name === './config') return { VERSION: 'test' };
    if (name === './mcp-client') return {};
    if (name === 'os') return { platform: () => 'darwin' };
    return require(name);
  };
  fakeRequire.main = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../lib/cli.js'), 'utf8'), {
    require: fakeRequire, module, process: fakeProcess, console: { log() {}, error() {} },
    Set, Promise,
  });
  return { main: module.exports.main, calls };
}

(async () => {
  for (const args of [['self', 'update', '--check'], ['self', 'uninstall', '--dry-run'], ['--install', '--yes']]) {
    const { main, calls } = loadCli(args);
    assert.strictEqual(await main(), 130);
    assert.strictEqual(calls[0][0], 'maintenance');
    assert(!calls.some(call => call[0] === 'auto'));
  }
  passed += 1;
  console.log('✓ Explicit maintenance routes preserve status and skip automatic checks');
  const mcp = loadCli(['mcp']);
  await mcp.main();
  assert(!mcp.calls.some(call => ['auto', 'install', 'recover'].includes(call[0])));
  passed += 1;
  console.log('✓ MCP mode never calls maintenance');
  const doctor = loadCli(['--doctor'], false);
  await doctor.main();
  assert.deepStrictEqual(doctor.calls, []);
  passed += 1;
  console.log('✓ Diagnostics do not install or update');
  const launch = loadCli([]);
  await launch.main();
  assert.deepStrictEqual(launch.calls.map(call => call[0]), ['recover', 'install', 'auto']);
  passed += 1;
  console.log('✓ Ordinary desktop launch invokes automatic maintenance policy');
  const broken = loadCli([], false, 1);
  assert.strictEqual(await broken.main(), 1);
  assert.deepStrictEqual(broken.calls, [['recover']]);
  passed += 1;
  console.log('✓ Recovery failure blocks installation and launch');
  console.log(`${passed} maintenance tests passed`);
})().catch(error => { console.error(error); process.exitCode = 1; });
