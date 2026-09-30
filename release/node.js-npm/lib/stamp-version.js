/** Coordinate source packaging before npm caches the package manifest. */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const packageRoot = path.resolve(__dirname, '..');
const repositoryRoot = path.resolve(packageRoot, '../..');
const isSource = packageRoot === path.join(repositoryRoot, 'release', 'node.js-npm') &&
  fs.existsSync(path.join(repositoryRoot, '.git'));

function run(executable, args) {
  const result = spawnSync(executable, args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status === null ? 1 : result.status);
}

const command = process.argv[2];
if (!['check', 'pack'].includes(command)) throw new Error('Expected check or pack');
if (isSource) {
  run('python3', [path.join(repositoryRoot, 'scripts', 'version.py'), command === 'pack' ? 'sync' : 'check']);
}
if (command === 'pack') {
  if (!process.env.npm_execpath) throw new Error('Run through npm run package');
  run(process.execPath, [process.env.npm_execpath, 'pack', ...process.argv.slice(3)]);
}
