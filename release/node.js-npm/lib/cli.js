#!/usr/bin/env node

/**
 * Command-line interface for Print@SoC
 */

const { spawn } = require('child_process');
const os = require('os');
const fs = require('fs');
const path = require('path');

const {
  checkAndInstall,
  getBinaryPath,
  isInstalled,
  downloadAndInstall
} = require('./downloader');

const { VERSION } = require('./config');
const { callConnectedTool } = require('./mcp-client');

const MCP_ARGS = new Set(['mcp', 'mcp-server', '--mcp', '--mcp-server']);
const WRAPPER_FLAGS = new Set([
  '--no-check',
  '--doctor',
  '--install',
  '--path',
  '--help',
  '-h',
  '--version',
  '-v'
]);

/**
 * Print usage information
 */
function printUsage() {
  console.log(`
Print@SoC v${VERSION}
Smart Printing for NUS SoC

Usage:
  print-soc                         Launch the desktop application
  print-soc <command> [options]

Printing:
  print-soc print FILE              Submit a PDF through the MCP print path

Inspection:
  print-soc printer list            List SoC printer queues from /etc/printcap
  print-soc job list --printer psts-dx    List queued jobs with rank/owner/job_id/file/size
  print-soc quota show              Show print quota/balance from pusage
  print-soc config show             Show effective CLI/MCP config with secrets redacted

Runtime:
  print-soc mcp                     Start the MCP stdio server
  print-soc mcp start               Start the MCP stdio server
  print-soc app launch              Launch the desktop application

Maintenance:
  print-soc self install            Force reinstall the desktop binary
  print-soc self path               Show binary installation path
  print-soc self doctor             Linux runtime dependency check
  print-soc --help                  Show this help message
  print-soc --version               Show version information

Examples:
  print-soc
  psoc mcp
  print-soc printer list --username your-soc-id --password-stdin
  print-soc job list --printer psts-dx --json
  print-soc quota show --json
  `);
}

function isMcpMode(args) {
  return args.some(arg => MCP_ARGS.has(arg));
}

function getMacAppBundle(binaryPath) {
  return binaryPath.includes('.app/') ? binaryPath.split('.app/')[0] + '.app' : binaryPath;
}

function clearMacQuarantine(binaryPath) {
  if (os.platform() !== 'darwin') return;
  const appBundle = getMacAppBundle(binaryPath);

  try {
    const { execSync } = require('child_process');
    execSync(`xattr -cr "${appBundle}"`, { stdio: 'ignore' });
    execSync(`xattr -dr com.apple.quarantine "${appBundle}"`, { stdio: 'ignore' });
  } catch (error) {}
}

function isTopLevelHelp(args) {
  return args.length === 1 && (args[0] === '--help' || args[0] === '-h' || args[0] === 'help');
}

function rewriteLayeredShortcuts(args) {
  if (!args.length) return args;
  if (args[0] === 'mcp' && args[1] === 'start') {
    return ['mcp', ...args.slice(2)];
  }
  if (args[0] === 'app') {
    if (args.length === 1 || args[1] === 'launch') return args.slice(2);
    if (args[1] === 'help' || args[1] === '--help' || args[1] === '-h') return ['--help'];
  }
  if (args[0] === 'self') {
    const mapping = {
      install: '--install',
      path: '--path',
      doctor: '--doctor',
      version: '--version'
    };
    const sub = args[1] || 'path';
    if (mapping[sub]) return [mapping[sub], ...args.slice(2)];
  }
  return args;
}

function normalizeOptionName(flag) {
  return flag
    .replace(/^--/, '')
    .replace(/-([a-z])/g, (_, char) => char.toUpperCase());
}

function parseOptions(argv) {
  const options = {};
  const positionals = [];
  const booleanOptions = new Set([
    'json',
    'raw',
    'yes',
    'confirm',
    'booklet',
    'passwordStdin',
    'noScale',
    'showSecrets',
    'help'
  ]);

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') {
      positionals.push(...argv.slice(index + 1));
      break;
    }
    if (arg === '-h') {
      options.help = true;
      continue;
    }
    if (arg === '-y') {
      options.yes = true;
      continue;
    }
    if (!arg.startsWith('--')) {
      positionals.push(arg);
      continue;
    }
    const equals = arg.indexOf('=');
    const key = normalizeOptionName(equals === -1 ? arg : arg.slice(0, equals));
    if (equals !== -1) {
      options[key] = arg.slice(equals + 1);
      continue;
    }
    if (booleanOptions.has(key)) {
      options[key] = true;
      continue;
    }
    const next = argv[index + 1];
    if (next === undefined || next.startsWith('-')) {
      options[key] = true;
      continue;
    }
    options[key] = next;
    index += 1;
  }

  return { options, positionals };
}

function buildConnectArgs(options) {
  if (options.passwordStdin && !options.password) {
    options.password = fs.readFileSync(0, 'utf8').split(/\r?\n/)[0];
  }

  const connect = {};
  const mapping = {
    server: 'server',
    host: 'host',
    port: 'port',
    username: 'username',
    password: 'password',
    keyPath: 'key_path',
    keyPassphrase: 'passphrase',
    authType: 'auth_type'
  };
  for (const [source, target] of Object.entries(mapping)) {
    if (options[source] !== undefined && options[source] !== '') {
      connect[target] = source === 'port' ? Number(options[source]) : String(options[source]);
    }
  }
  return connect;
}

function printJson(data) {
  console.log(JSON.stringify(data, null, 2));
}

function printTable(headers, rows) {
  const widths = headers.map(header => header.length);
  const renderedRows = rows.map(row => row.map(value => value === undefined || value === null || value === '' ? '-' : String(value)));
  for (const row of renderedRows) {
    row.forEach((cell, index) => {
      widths[index] = Math.max(widths[index], cell.length);
    });
  }
  console.log(headers.map((header, index) => header.toUpperCase().padEnd(widths[index])).join('  '));
  console.log(widths.map(width => '-'.repeat(width)).join('  '));
  for (const row of renderedRows) {
    console.log(row.map((cell, index) => cell.padEnd(widths[index])).join('  '));
  }
}

function printKv(rows) {
  const width = rows.reduce((max, [key]) => Math.max(max, key.length), 0);
  for (const [key, value] of rows) {
    const rendered = value === undefined || value === null || value === '' ? '-' : String(value);
    console.log(`${key.padEnd(width)}: ${rendered}`);
  }
}

function ensureInstalledForMcpCli() {
  if (!isInstalled()) {
    throw new Error('Print@SoC binary is not installed. Run "print-soc --install" before using CLI print/inspection commands.');
  }
  const binaryPath = getBinaryPath();
  clearMacQuarantine(binaryPath);
  return binaryPath;
}

async function callMcpCliTool(toolName, toolArgs, options) {
  const binaryPath = ensureInstalledForMcpCli();
  return callConnectedTool(binaryPath, buildConnectArgs(options), toolName, toolArgs);
}

function defaultPrinter(options) {
  return options.printer || process.env.PSOC_PRINTER || process.env.PSOC_DEFAULT_PRINTER || 'psts-dx';
}

function normalizeMcpDuplex(value) {
  if (!value) return undefined;
  const normalized = String(value).toLowerCase().replace(/-/g, '_');
  if (normalized === 'duplex' || normalized === 'duplex_long_edge' || normalized === 'long' || normalized === 'long_edge') {
    return 'duplex_long_edge';
  }
  if (normalized === 'duplex_short_edge' || normalized === 'short' || normalized === 'short_edge') {
    return 'duplex_short_edge';
  }
  if (normalized === 'simplex' || normalized === 'one_sided') return 'simplex';
  return value;
}

function printSubcommandHelp(command) {
  const help = {
    printer: 'Usage:\n  print-soc printer list [--json] [SSH options]',
    job: 'Usage:\n  print-soc job list --printer psts-dx [--json] [SSH options]',
    quota: 'Usage:\n  print-soc quota show [--json|--raw] [SSH options]',
    config: 'Usage:\n  print-soc config show [--json] [--show-secrets]',
    print: 'Usage:\n  print-soc print FILE --printer psts-dx [--copies N] [SSH options]'
  };
  console.log(help[command] || 'Run print-soc --help for usage.');
}

async function runPrinterCommand(argv) {
  const sub = argv[0] && !argv[0].startsWith('-') ? argv[0] : 'list';
  const rest = sub === 'list' ? argv.slice(argv[0] === 'list' ? 1 : 0) : argv.slice(1);
  const { options } = parseOptions(rest);
  if (options.help || sub !== 'list') {
    printSubcommandHelp('printer');
    return sub === 'list' ? 0 : 2;
  }
  const data = await callMcpCliTool('list_print_queues', {}, options);
  const queues = data.queues || [];
  if (options.json) {
    printJson({ queues });
  } else if (queues.length) {
    printTable(['queue'], queues.map(queue => [queue]));
  } else {
    console.log('No print queues found.');
  }
  return 0;
}

async function runJobCommand(argv, flat = false) {
  const sub = flat ? 'list' : (argv[0] && !argv[0].startsWith('-') ? argv[0] : 'list');
  const rest = flat ? argv : argv.slice(sub === 'list' ? 1 : 0);
  const { options } = parseOptions(rest);
  if (options.help || sub !== 'list') {
    printSubcommandHelp('job');
    return sub === 'list' ? 0 : 2;
  }
  const printer = defaultPrinter(options);
  const data = await callMcpCliTool('check_printer_queue', { printer }, options);
  const jobs = data.jobs || [];
  if (options.json) {
    printJson({ printer, jobs });
  } else if (jobs.length) {
    printTable(
      ['rank', 'owner', 'job_id', 'file', 'size'],
      jobs.map(job => [job.rank, job.owner, job.job_id, job.file, job.total_size])
    );
  } else {
    console.log(`No jobs in queue ${printer}.`);
  }
  return 0;
}

async function runQuotaCommand(argv) {
  const sub = argv[0] && !argv[0].startsWith('-') ? argv[0] : 'show';
  const rest = sub === 'show' || sub === 'list' ? argv.slice(argv[0] === sub ? 1 : 0) : argv.slice(1);
  const { options } = parseOptions(rest);
  if (options.help || (sub !== 'show' && sub !== 'list')) {
    printSubcommandHelp('quota');
    return sub === 'show' || sub === 'list' ? 0 : 2;
  }
  const quota = await callMcpCliTool('check_print_quota', {}, options);
  if (options.json) {
    printJson(quota.quota || quota);
  } else if (options.raw) {
    console.log((quota.quota || quota).raw_output || '');
  } else {
    const data = quota.quota || quota;
    printKv([
      ['summary', data.summary],
      ['balance', data.balance],
      ['used', data.used],
      ['limit', data.limit]
    ]);
  }
  return 0;
}

function runConfigCommand(argv) {
  const sub = argv[0] && !argv[0].startsWith('-') ? argv[0] : 'show';
  const rest = sub === 'show' ? argv.slice(argv[0] === 'show' ? 1 : 0) : argv.slice(1);
  const { options } = parseOptions(rest);
  if (options.help || sub !== 'show') {
    printSubcommandHelp('config');
    return sub === 'show' ? 0 : 2;
  }
  const redact = value => value && !options.showSecrets ? '<redacted>' : (value || '');
  const data = {
    ssh: {
      server: process.env.PSOC_SSH_SERVER || '',
      host: process.env.PSOC_SSH_HOST || '',
      port: process.env.PSOC_SSH_PORT || '',
      username: process.env.PSOC_SSH_USERNAME || '',
      password: redact(process.env.PSOC_SSH_PASSWORD),
      key_path: process.env.PSOC_SSH_KEY_PATH || '',
      key_passphrase: redact(process.env.PSOC_SSH_KEY_PASSPHRASE)
    },
    print: {
      printer: process.env.PSOC_PRINTER || process.env.PSOC_DEFAULT_PRINTER || '',
      duplex: process.env.PSOC_DUPLEX || '',
      paper_size: process.env.PSOC_PAPER_SIZE || ''
    },
    binary: {
      installed: isInstalled(),
      path: getBinaryPath()
    }
  };
  if (options.json) {
    printJson(data);
  } else {
    console.log('SSH:');
    printKv(Object.entries(data.ssh));
    console.log('\nPrint:');
    printKv(Object.entries(data.print));
    console.log('\nBinary:');
    printKv(Object.entries(data.binary));
  }
  return 0;
}

async function runPrintCommand(argv) {
  const { options, positionals } = parseOptions(argv);
  if (options.help) {
    printSubcommandHelp('print');
    return 0;
  }
  const filePath = options.file || positionals[0];
  if (!filePath) {
    throw new Error('A PDF file path is required.');
  }
  const toolArgs = {
    file_path: path.resolve(filePath),
    printer: defaultPrinter(options),
    confirm: true
  };
  if (options.copies !== undefined) toolArgs.copies = Number(options.copies);
  if (options.duplex !== undefined) toolArgs.duplex = normalizeMcpDuplex(options.duplex);
  if (options.orientation !== undefined) toolArgs.orientation = String(options.orientation);
  if (options.pagesPerSheet !== undefined) toolArgs.pages_per_sheet = Number(options.pagesPerSheet);
  if (options.booklet !== undefined) toolArgs.booklet = Boolean(options.booklet);
  if (options.paperSize !== undefined) toolArgs.paper_size = String(options.paperSize).toUpperCase();

  const data = await callMcpCliTool('submit_pdf_print_job', toolArgs, options);
  if (options.json) {
    printJson(data);
  } else {
    console.log(data.message || 'Print job submitted.');
    if (data.job?.id) console.log(`Job: ${data.job.id}`);
    if (data.job?.lpq_job_id) console.log(`Queue job: ${data.job.lpq_job_id}`);
  }
  return 0;
}

async function routeStructuredCommand(args) {
  if (!args.length) return null;
  const command = args[0];
  try {
    if (command === 'printer' || command === 'printers') return await runPrinterCommand(args.slice(1));
    if (command === 'list' || command === 'queues') return await runPrinterCommand(['list', ...args.slice(1)]);
    if (command === 'job') return await runJobCommand(args.slice(1));
    if (command === 'jobs') return await runJobCommand(args.slice(1), true);
    if (command === 'quota') return await runQuotaCommand(args.slice(1));
    if (command === 'config') return runConfigCommand(args.slice(1));
    if (command === 'print') return await runPrintCommand(args.slice(1));
  } catch (error) {
    console.error(`${command} command failed: ${error.message}`);
    return 1;
  }
  return null;
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
  const args = rewriteLayeredShortcuts(process.argv.slice(2));
  const mcpMode = isMcpMode(args);

  if (isTopLevelHelp(args)) {
    printUsage();
    return 0;
  }

  if (args.includes('--version') || args.includes('-v')) {
    console.log(`Print@SoC v${VERSION}`);
    return 0;
  }

  const structuredResult = await routeStructuredCommand(args);
  if (structuredResult !== null) {
    return structuredResult;
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
      console.log('Binary not installed yet. Run "print-soc --install" to install.');
    }
    return 0;
  }

  if (mcpMode) {
    if (!isInstalled()) {
      console.error('Print@SoC binary is not installed. Run "print-soc --install" before starting the MCP server.');
      return 1;
    }
  } else {
    try {
      await checkAndInstall();
    } catch (error) {
      console.error(`Error during installation check: ${error.message}`);
      return 1;
    }
  }

  const binaryPath = getBinaryPath();

  if (!isInstalled()) {
    console.error(`Error: Binary not found at ${binaryPath}`);
    console.error('Try running "print-soc --install" to reinstall');
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

  if (!mcpMode) {
    console.log('Launching Print@SoC...');
  }

  return new Promise((resolve) => {
    let command = binaryPath;
    let commandArgs = args;

    if (os.platform() === 'darwin' && binaryPath.includes('.app/')) {
      clearMacQuarantine(binaryPath);

      if (!mcpMode) {
        command = 'open';
        commandArgs = [getMacAppBundle(binaryPath), '--args', ...args];
      }
    }

    const filteredArgs = commandArgs.filter(a => !WRAPPER_FLAGS.has(a));

    const child = spawn(command, filteredArgs, {
      stdio: 'inherit',
      detached: false,
      env: { ...process.env, ...extraEnv }
    });

    child.on('error', (error) => {
      console.error(`Failed to launch application: ${error.message}`);
      if (os.platform() === 'darwin') {
        console.error('\nIf macOS blocks the app, try one of these solutions:');
        console.error('  1. Open System Preferences > Security & Privacy > General');
        console.error('     Click "Open Anyway" for Print_at_SoC');
        console.error('  2. Or run in terminal:');
        const appBundle = getMacAppBundle(binaryPath);
        console.error(`     xattr -cr "${appBundle}"`);
        console.error(`     open "${appBundle}"`);
      }
      resolve(1);
    });

    child.on('exit', (code) => {
      if (code !== 0 && os.platform() === 'darwin') {
        console.error('\nIf macOS blocks the app, try one of these solutions:');
        console.error('  1. Open System Preferences > Security & Privacy > General');
        console.error('     Click "Open Anyway" for Print_at_SoC');
        console.error('  2. Or run in terminal:');
        const appBundle = getMacAppBundle(binaryPath);
        console.error(`     xattr -cr "${appBundle}"`);
        console.error(`     open "${appBundle}"`);
      }
      resolve(code || 0);
    });

    process.on('SIGINT', () => {
      child.kill('SIGINT');
      const log = mcpMode ? console.error : console.log;
      log('\nApplication closed by user');
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
