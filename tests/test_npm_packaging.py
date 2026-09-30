"""Exercise npm's real lifecycle ordering with stale source metadata."""
import json
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile
import unittest


@unittest.skipUnless(shutil.which('npm'), 'npm is required for packaging integration')
class NpmPackagingTests(unittest.TestCase):
    def test_package_stamps_before_npm_reads_manifest(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / '.git').mkdir()
            (root / 'scripts').mkdir()
            package = root / 'release/node.js-npm'
            (package / 'lib').mkdir(parents=True)
            helper = Path(__file__).resolve().parents[1] / 'release/node.js-npm/lib/stamp-version.js'
            shutil.copyfile(helper, package / 'lib/stamp-version.js')
            (package / 'package.json').write_text(json.dumps({
                'name': 'print-soc-version-fixture', 'version': '0.0.0',
                'scripts': {'prepack': 'node lib/stamp-version.js check',
                            'package': 'node lib/stamp-version.js pack'},
            }))
            (root / 'scripts/version.py').write_text('''
import json, sys
from pathlib import Path
manifest = Path(__file__).resolve().parents[1] / 'release/node.js-npm/package.json'
data = json.loads(manifest.read_text())
if sys.argv[1] == 'sync':
    data['version'] = '0.328.7'
    manifest.write_text(json.dumps(data))
else:
    sys.exit(0 if data['version'] == '0.328.7' else 1)
''')
            stale = subprocess.run(['npm', 'pack', '--dry-run'], cwd=package, capture_output=True, text=True)
            self.assertNotEqual(stale.returncode, 0)
            built = subprocess.run(['npm', 'run', 'package', '--', '--pack-destination', str(root)], cwd=package, capture_output=True, text=True)
            self.assertEqual(built.returncode, 0, built.stderr)
            with tarfile.open(root / 'print-soc-version-fixture-0.328.7.tgz') as archive:
                manifest = json.load(archive.extractfile('package/package.json'))
                self.assertEqual(manifest['version'], '0.328.7')
