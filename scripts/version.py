#!/usr/bin/env python3
"""Resolve Tide once and project its coordinate into each distribution format."""
from __future__ import annotations

import argparse
from dataclasses import dataclass
import json
import os
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]


@dataclass(frozen=True)
class BuildVersion:
    version: str
    commit: str

    def __post_init__(self):
        if not re.fullmatch(r"(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)", self.version):
            raise ValueError(f"Invalid Tide release coordinate: {self.version!r}")
        if not re.fullmatch(r"[0-9a-f]{40}", self.commit):
            raise ValueError("A full Git commit SHA is required")

    @property
    def msi_version(self) -> str:
        epoch, days, index = map(int, self.version.split('.'))
        if epoch > 255 or days > 65535 or index > 255:
            raise ValueError("Tide coordinate exceeds MSI encoding (epoch<=255, days<=65535, index<=255)")
        return f"{epoch}.{days // 256}.{(days % 256) * 256 + index}"

    def write(self, path: Path):
        path.write_text(json.dumps(self.__dict__, indent=2) + '\n', encoding='utf-8')


class VersionManager:
    def __init__(self, root: Path):
        self.root = root

    def _command(self, *args: str) -> str:
        return subprocess.check_output(args, cwd=self.root, text=True).strip()

    def resolve(self, receipt: Path | None = None) -> BuildVersion:
        commit = self._command('git', 'rev-parse', 'HEAD')
        if receipt is not None:
            result = BuildVersion(**json.loads(receipt.read_text(encoding='utf-8')))
            if result.commit != commit:
                raise ValueError("Version receipt belongs to a different source commit")
            return result
        if self._command('git', 'rev-parse', '--is-shallow-repository') != 'false':
            raise ValueError("Tide needs complete Git history; fetch with --unshallow first")
        return BuildVersion(self._command('tide', 'mark', '--local-only'), commit)

    def rendered_files(self, build: BuildVersion) -> dict[Path, str]:
        result = {}
        for relative in ('app/package.json', 'app/package-lock.json', 'release/node.js-npm/package.json'):
            path = self.root / relative
            data = json.loads(path.read_text(encoding='utf-8'))
            data['version'] = build.version
            if 'packages' in data:
                data['packages']['']['version'] = build.version
            result[path] = json.dumps(data, indent=2, ensure_ascii=False) + '\n'
        path = self.root / 'app/src-tauri/tauri.conf.json'
        data = json.loads(path.read_text(encoding='utf-8'))
        data['version'] = build.version
        data['bundle']['windows']['wix']['version'] = build.msi_version
        result[path] = json.dumps(data, indent=2, ensure_ascii=False) + '\n'
        for relative, pattern, replacement in (
            ('app/src-tauri/Cargo.toml', r'(?m)^(version\s*=\s*)"[^"]+"', rf'\g<1>"{build.version}"'),
            ('app/src-tauri/Cargo.lock', r'(name = "print_at_soc"\nversion = )"[^"]+"', rf'\g<1>"{build.version}"'),
            ('release/python-pip/print_at_soc/__init__.py', r'(?m)^__version__ = "[^"]+"', f'__version__ = "{build.version}"'),
        ):
            path = self.root / relative
            content, count = re.subn(pattern, replacement, path.read_text(encoding='utf-8'), count=1)
            if count != 1:
                raise ValueError(f"Missing version field: {relative}")
            result[path] = content
        return result

    def sync(self, build: BuildVersion, check: bool = False):
        # Validate and render every target before writing any file.
        rendered = self.rendered_files(build)
        changed = [p for p, content in rendered.items() if p.read_text(encoding='utf-8') != content]
        if check and changed:
            raise ValueError('Stale version metadata: ' + ', '.join(str(p.relative_to(self.root)) for p in changed))
        for path in changed:
            path.write_text(rendered[path], encoding='utf-8')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['sync', 'check', 'show'])
    parser.add_argument('--receipt', help='Use the Tide result resolved by this CI run')
    parser.add_argument('--write-receipt', help='Save version and source SHA for downstream jobs')
    args = parser.parse_args()
    receipt = args.receipt or os.environ.get('TIDE_VERSION_RECEIPT')
    manager = VersionManager(ROOT)
    build = manager.resolve(ROOT / receipt if receipt else None)
    if args.command != 'show':
        manager.sync(build, check=args.command == 'check')
    if args.write_receipt:
        build.write(ROOT / args.write_receipt)
    print(build.version)


if __name__ == '__main__':
    main()
