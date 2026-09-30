/** Stamp a repository build; published packages already carry the Tide version. */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const packageRoot = path.resolve(__dirname, '..');
const repositoryRoot = path.resolve(packageRoot, '../..');
if (packageRoot === path.join(repositoryRoot, 'release', 'node.js-npm') &&
    fs.existsSync(path.join(repositoryRoot, '.git'))) {
  const result = spawnSync('python3', [path.join(repositoryRoot, 'scripts', 'version.py'), 'sync'], {
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  process.exitCode = result.status === null ? 1 : result.status;
}
