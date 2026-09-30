import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location('version', Path(__file__).resolve().parents[1] / 'scripts/version.py')
version = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = version
SPEC.loader.exec_module(version)


class VersionTests(unittest.TestCase):
    def test_msi_encoding_is_ordered_across_day_boundary(self):
        coordinates = ['0.255.255', '0.256.0', '0.328.4', '1.0.0']
        encoded = [tuple(map(int, version.BuildVersion(v, 'a' * 40).msi_version.split('.'))) for v in coordinates]
        self.assertEqual(encoded, sorted(encoded))
        self.assertEqual(encoded[2], (0, 1, 18436))

    def test_msi_overflow_is_rejected(self):
        for coordinate in ['256.0.0', '0.65536.0', '0.0.256']:
            with self.assertRaises(ValueError):
                version.BuildVersion(coordinate, 'a' * 40).msi_version

    def test_receipt_cannot_stamp_another_commit(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            receipt = root / 'version.json'
            version.BuildVersion('0.328.4', 'a' * 40).write(receipt)
            manager = version.VersionManager(root)
            with patch.object(manager, '_command', return_value='b' * 40):
                with self.assertRaisesRegex(ValueError, 'different source commit'):
                    manager.resolve(receipt)

    def test_receipt_avoids_recomputing_tide_after_tag_creation(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            receipt = root / 'version.json'
            expected = version.BuildVersion('0.328.4', 'a' * 40)
            expected.write(receipt)
            manager = version.VersionManager(root)
            with patch.object(manager, '_command', return_value='a' * 40) as command:
                self.assertEqual(manager.resolve(receipt), expected)
                command.assert_called_once_with('git', 'rev-parse', 'HEAD')

    def test_sync_projects_all_formats_and_is_idempotent(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            files = {
                'app/package.json': '{"version":"0.1.0"}',
                'app/package-lock.json': '{"version":"0.1.0","packages":{"":{"version":"0.1.0"}}}',
                'release/node.js-npm/package.json': '{"version":"0.1.0"}',
                'app/src-tauri/tauri.conf.json': '{"version":"0.1.0","bundle":{"windows":{"wix":{}}}}',
                'app/src-tauri/Cargo.toml': '[package]\nversion = "0.1.0"\n',
                'app/src-tauri/Cargo.lock': 'name = "print_at_soc"\nversion = "0.1.0"\n',
                'release/python-pip/print_at_soc/__init__.py': '__version__ = "0.1.0"\n',
            }
            for name, content in files.items():
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(content)
            manager = version.VersionManager(root)
            build = version.BuildVersion('0.328.4', 'a' * 40)
            with self.assertRaisesRegex(ValueError, 'Stale'):
                manager.sync(build, check=True)
            manager.sync(build)
            manager.sync(build, check=True)
            for name in files:
                self.assertIn('0.328.4', (root / name).read_text())
            self.assertEqual(json.loads((root / 'app/src-tauri/tauri.conf.json').read_text())['bundle']['windows']['wix']['version'], '0.1.18436')


if __name__ == '__main__':
    unittest.main()
