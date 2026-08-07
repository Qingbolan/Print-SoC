/**
 * Simple test for Print@SoC package
 */

const { getPlatformKey, isInstalled } = require('../lib/downloader');
const { VERSION } = require('../lib/config');
const packageJson = require('../package.json');
const { spawnSync } = require('child_process');

console.log('Running Print@SoC tests...\n');

// Test 1: Check version
console.log('[Test 1] Version check');
console.log(`Version: ${VERSION}`);
console.assert(VERSION, 'Version should be defined');
console.log('✓ Passed\n');

// Test 2: Platform detection
console.log('[Test 2] Platform detection');
try {
  const platform = getPlatformKey();
  console.log(`Detected platform: ${platform}`);
  console.assert(platform, 'Platform should be detected');
  console.log('✓ Passed\n');
} catch (error) {
  console.error('✗ Failed:', error.message);
  process.exit(1);
}

// Test 3: Installation check
console.log('[Test 3] Installation check');
const installed = isInstalled();
console.log(`Binary installed: ${installed}`);
console.log('✓ Passed\n');

// Test 4: CLI aliases
console.log('[Test 4] CLI aliases');
for (const name of ['print-at-soc', 'print_at_soc', 'print-soc', 'psoc']) {
  console.assert(packageJson.bin[name] === 'lib/cli.js', `${name} should point to lib/cli.js`);
}
console.log('✓ Passed\n');

// Test 5: CLI help includes structured commands
console.log('[Test 5] CLI help surface');
const help = spawnSync(process.execPath, ['lib/cli.js', '--help'], {
  cwd: require('path').resolve(__dirname, '..'),
  encoding: 'utf8'
});
console.assert(help.status === 0, 'help command should exit 0');
console.assert(help.stdout.includes('printer list'), 'help should include printer list');
console.assert(help.stdout.includes('quota show'), 'help should include quota show');
console.assert(help.stdout.includes('job list'), 'help should include job list');
console.log('✓ Passed\n');

console.log('All tests passed! ✓');
