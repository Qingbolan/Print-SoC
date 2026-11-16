#!/usr/bin/env python3
"""Verify published desktop upgrade/rollback using a retained, isolated install.

The production updater verifies real GitHub downloads. Only its process guard is
scoped to this script's temporary directory, so an unrelated installed desktop
can remain open. HOME is never replaced. macOS MCP initialization runs with
filesystem writes confined to the temporary directory; no print/login tools run.
Windows installers are deliberately skipped because they modify the host system.
"""
from __future__ import annotations

import argparse
from dataclasses import asdict
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import plistlib
import re
import subprocess
import sys
import tempfile
from urllib.parse import quote, urlparse
import urllib.request


ROOT = Path(__file__).resolve().parents[1]
TEMP_PREFIX = 'print-soc-release-upgrade-'


def digest_file(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return 'sha256:' + digest.hexdigest()


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def release_tag(value):
    if not re.fullmatch(r'v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)', value):
        raise argparse.ArgumentTypeError('Expected an exact published Tide tag: v<epoch>.<days>.<index>')
    return value


def fetch_bytes(url, *, api=False):
    parsed = urlparse(url)
    require(parsed.scheme == 'https' and not parsed.username and not parsed.password,
            'Release requests require HTTPS without embedded credentials')
    headers = {'User-Agent': 'PrintAtSoC-Release-Upgrade-Verification'}
    if api:
        headers['Accept'] = 'application/vnd.github+json'
        token = os.environ.get('GH_TOKEN') or os.environ.get('GITHUB_TOKEN')
        if token:
            headers['Authorization'] = 'Bearer ' + token
    with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=30) as response:
        require(urlparse(response.geturl()).scheme == 'https', 'Insecure release redirect')
        return response.read()


def select_release(tag, platform_key, config, release_type):
    repository = config.GITHUB_REPO
    metadata = json.loads(fetch_bytes(
        f'https://api.github.com/repos/{repository}/releases/tags/{quote(tag, safe="")}', api=True))
    require(metadata.get('tag_name') == tag, 'GitHub returned a different release tag')
    require(not metadata.get('draft'), 'Release is still a draft')
    assets = {asset['name']: asset for asset in metadata.get('assets', [])}
    platform = config.PLATFORM_BINARIES[platform_key]
    name = next((name for name in (platform['asset_name'], platform.get('asset_name_fallback'))
                 if name in assets), None)
    require(name is not None, f'{tag} has no asset for {platform_key}')

    def asset_url(asset):
        url = asset.get('browser_download_url', '')
        expected = f'https://github.com/{repository}/releases/download/{quote(tag)}/{quote(asset["name"])}'
        require(url == expected, 'Release asset URL does not match the exact repository, tag and name')
        return url

    asset = assets[name]
    release = release_type(tag[1:], asset_url(asset), name, int(asset.get('size', 0)),
                           str(asset.get('digest') or ''))
    require(re.fullmatch(r'sha256:[0-9a-fA-F]{64}', release.digest),
            f'{tag} desktop asset is missing its published SHA-256 digest')
    require(release.size > 0, f'{tag} desktop asset has no published size')
    receipt = None
    if 'release-version.json' in assets:
        receipt_asset = assets['release-version.json']
        raw = fetch_bytes(asset_url(receipt_asset))
        require(len(raw) == int(receipt_asset.get('size', 0)), 'Release receipt size mismatch')
        published_digest = receipt_asset.get('digest')
        actual_digest = 'sha256:' + hashlib.sha256(raw).hexdigest()
        if published_digest:
            require(actual_digest == published_digest.lower(), 'Release receipt digest mismatch')
        receipt = json.loads(raw)
        require(receipt.get('version') == release.version, 'Source receipt version differs from release tag')
        require(re.fullmatch(r'[0-9a-f]{40}', str(receipt.get('commit', ''))),
                'Source receipt does not contain a full source commit')
        receipt = {**receipt, 'sha256': actual_digest, 'digest_published': bool(published_digest)}
    return release, {
        'tag': tag, 'url': metadata.get('html_url'), 'asset': asdict(release),
        'source_receipt': receipt,
        'source_receipt_note': None if receipt else 'release-version.json was not published for this tag',
    }


def isolated_service(service_type, temporary_root, platform_key, downloads):
    """Retain all production transaction behavior; narrow only process ownership."""
    base = temporary_root.resolve(strict=True)
    require(base.parent == Path(tempfile.gettempdir()).resolve()
            and base.name.startswith(TEMP_PREFIX) and not temporary_root.is_symlink(),
            'Verification root must be a freshly created temporary directory')

    class IsolatedUpdateService(service_type):
        def __init__(self):
            super().__init__(base / 'install', platform_key=platform_key)

        def _ensure_stopped(self):
            require(self.root == base / 'install' and self.root.resolve() == base / 'install'
                    and self.binary == self.root / 'bin' and not self.binary.is_symlink(),
                    'Refusing a process-guard override outside the isolated installation')
            result = subprocess.run(['ps', '-ww', '-axo', 'pid=,comm='], capture_output=True,
                                    text=True, check=True, timeout=10)
            for line in result.stdout.splitlines():
                fields = line.strip().split(None, 1)
                if len(fields) != 2:
                    continue
                pid, executable = fields
                paths = [executable]
                if sys.platform.startswith('linux'):
                    try:
                        paths.append(os.readlink(f'/proc/{pid}/exe'))
                        paths.append(Path(f'/proc/{pid}/cmdline').read_bytes().split(b'\0')[0].decode())
                    except (OSError, UnicodeError):
                        pass  # Process may have exited or belong to another user.
                for path in paths:
                    if Path(path).is_absolute() and Path(path).resolve().is_relative_to(base):
                        raise RuntimeError(f'Isolated desktop process {pid} is still running')

        def _download(self, release, destination, progress=None):
            super()._download(release, destination, progress)
            downloads.append({'version': release.version, 'asset': release.name,
                              'bytes': destination.stat().st_size,
                              'verified_sha256': digest_file(destination)})

    return IsolatedUpdateService()


def verify_install(service, release, config, sentinels):
    require(service.installed_version() == release.version, 'Installed version receipt is incorrect')
    require(json.loads(service.receipt_file.read_text()) == asdict(release), 'Installed asset receipt is incorrect')
    executable = service.binary / config.PLATFORM_BINARIES[service.platform_key]['executable_path']
    require(executable.is_file(), 'Installed desktop executable is missing')
    details = {'version': release.version, 'executable': str(executable),
               'executable_sha256': digest_file(executable), 'asset_receipt': asdict(release)}
    if service.platform_key.startswith('darwin'):
        plist_path = executable.parent.parent / 'Info.plist'
        with plist_path.open('rb') as stream:
            plist = plistlib.load(stream)
        require(plist.get('CFBundleShortVersionString') == release.version,
                'macOS bundle version differs from the downloaded release')
        details['bundle_version'] = plist.get('CFBundleShortVersionString')
        details['bundle_build'] = plist.get('CFBundleVersion')
    for path, expected in sentinels.items():
        require(path.read_bytes() == expected, f'Update changed sentinel data: {path}')
    details['preserved_sentinels'] = {str(path.relative_to(service.root)): digest_file(path)
                                     for path in sentinels}
    require(not service.journal.exists() and not service.backup.exists()
            and not list(service.root.glob('.update-stage-*')), 'Update left an incomplete transaction')
    return details


def mcp_initialize(executable, version, temporary_root):
    if sys.platform != 'darwin':
        return {'status': 'skipped', 'reason': 'Native MCP runtime smoke is scoped to macOS; Linux AppImage host requirements are not evaluated'}
    sandbox = Path('/usr/bin/sandbox-exec')
    require(sandbox.is_file(), 'macOS sandbox-exec is required to confine MCP filesystem writes')
    profile = ('(version 1)(allow default)(deny file-write*)'
               f'(allow file-write* (subpath {json.dumps(str(temporary_root.resolve()))}))')
    request = {'jsonrpc': '2.0', 'id': 1, 'method': 'initialize', 'params': {
        'protocolVersion': '2025-06-18', 'capabilities': {},
        'clientInfo': {'name': 'print-soc-release-verification', 'version': version},
    }}
    result = subprocess.run([str(sandbox), '-p', profile, str(executable), 'mcp'],
                            input=json.dumps(request) + '\n', capture_output=True, text=True,
                            timeout=20, cwd=temporary_root)
    require(result.returncode == 0, f'MCP initialize exited with code {result.returncode}; stderr was captured but is not recorded to avoid exposing user data')
    responses = [json.loads(line) for line in result.stdout.splitlines() if line.strip()]
    response = next((item for item in responses if item.get('id') == 1), None)
    require(response is not None and response.get('jsonrpc') == '2.0'
            and 'error' not in response and isinstance(response.get('result'), dict),
            'Desktop did not return a successful JSON-RPC initialize response')
    initialized = response['result']
    require(initialized.get('protocolVersion'), 'MCP response has no protocol version')
    info = initialized.get('serverInfo', {})
    if 'version' in info:
        require(info['version'] == version, 'MCP server version differs from the release coordinate')
    return {'status': 'passed', 'protocol_version': initialized['protocolVersion'],
            'server_info': info, 'timeout_seconds': 20,
            'confinement': 'sandbox-exec denies writes outside verification root; HOME unchanged'}


def run(args):
    # Load the checkout's actual maintenance engine, never a reimplementation.
    sys.path.insert(0, str(ROOT / 'release/python-pip'))
    from print_at_soc import config, update_service
    from print_at_soc.downloader import get_platform_key

    temporary_root = Path(tempfile.mkdtemp(prefix=TEMP_PREFIX)).resolve()
    report_path = args.report.expanduser().resolve() if args.report else temporary_root / 'report.json'
    report = {'status': 'running', 'started_at': datetime.now(timezone.utc).isoformat(),
              'verification_root': str(temporary_root), 'report_path': str(report_path),
              'engine': str(Path(update_service.__file__).resolve()),
              'python': sys.executable, 'downloads': [], 'steps': [],
              'process_guard': 'Only processes with an executable path inside the retained temporary root block replacement; deployed installations are never replaced'}
    print(f'Isolated verification root: {temporary_root}', flush=True)
    try:
        platform_key = get_platform_key()
        report['platform'] = platform_key
        if platform_key.startswith('windows'):
            report.update(status='skipped', reason='Windows MSI/NSIS installers change native host state and cannot be exercised inside a temporary directory; use a disposable Windows VM')
            return 0
        require(tuple(map(int, args.new_tag[1:].split('.'))) > tuple(map(int, args.old_tag[1:].split('.'))),
                '--new-tag must be newer than --old-tag')
        old, report['old_release'] = select_release(args.old_tag, platform_key, config, update_service.Release)
        new, report['new_release'] = select_release(args.new_tag, platform_key, config, update_service.Release)
        service = isolated_service(update_service.UpdateService, temporary_root, platform_key, report['downloads'])
        report['install_root'] = str(service.root)
        sentinels = {}

        def progress(stage, completed=0, total=0):
            marker = (stage, min(100, completed * 100 // total) // 25 if total else 0)
            if marker != progress.last:
                print(f'  {stage}' + (f' {marker[1] * 25}%' if total else ''), flush=True)
                progress.last = marker
        progress.last = None

        def record_step(name, release):
            details = verify_install(service, release, config, sentinels)
            report['steps'].append({'name': name, 'status': 'passed', **details})
            return details

        print(f'Installing published baseline {args.old_tag}', flush=True)
        service.update(old, progress)
        for relative, content in {
            'config/virtual-printer.json': b'{"verification":"preserve configuration"}\n',
            'user-data/history.json': b'[{"verification":"preserve user data"}]\n',
        }.items():
            path = service.root / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(content)
            sentinels[path] = content
        baseline = record_step('install_old_release_and_create_sentinels', old)
        old_metadata = {path.name: path.read_bytes() for path in (service.version_file, service.receipt_file)}

        print(f'Upgrading to published {args.new_tag}', flush=True)
        service.update(new, progress)
        upgraded = record_step('upgrade_to_new_release', new)
        report['steps'].append({'name': 'new_desktop_mcp_initialize',
                                **mcp_initialize(Path(upgraded['executable']), new.version, temporary_root)})

        print('Rolling back to the published baseline', flush=True)
        service.rollback(progress)
        restored = record_step('rollback_to_old_release', old)
        require(restored['executable_sha256'] == baseline['executable_sha256'], 'Rollback executable differs from baseline')
        require(all((service.root / name).read_bytes() == content for name, content in old_metadata.items()),
                'Rollback did not restore exact original metadata bytes')
        report['steps'][-1]['exact_metadata_restored'] = True

        print(f'Reapplying published {args.new_tag}', flush=True)
        service.update(new, progress)
        reapplied = record_step('reupgrade_to_new_release', new)
        require(reapplied['executable_sha256'] == upgraded['executable_sha256'], 'Reupgrade executable differs from verified new binary')
        report['steps'].append({'name': 'reupgraded_desktop_mcp_initialize',
                                **mcp_initialize(Path(reapplied['executable']), new.version, temporary_root)})
        report['status'] = 'passed'
        return 0
    except Exception as error:
        report.update(status='failed', error=f'{type(error).__name__}: {error}')
        print(f'Verification failed: {report["error"]}', file=sys.stderr, flush=True)
        return 1
    finally:
        report['finished_at'] = datetime.now(timezone.utc).isoformat()
        report_path.parent.mkdir(parents=True, exist_ok=True)
        report_path.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
        print(f'{report["status"]}: {report_path}', flush=True)
        print(f'Retained installation and receipts: {temporary_root}', flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--old-tag', required=True, type=release_tag, help='Exact published baseline tag')
    parser.add_argument('--new-tag', required=True, type=release_tag, help='Exact published upgrade tag')
    parser.add_argument('--report', type=Path, help='JSON report destination (default: retained temporary root/report.json)')
    parser.add_argument('--python', help='Python interpreter to run the checkout maintenance engine (must have its dependencies installed)')
    args = parser.parse_args()
    if args.python:
        command = [args.python, str(Path(__file__).resolve()), '--old-tag', args.old_tag, '--new-tag', args.new_tag]
        if args.report:
            command.extend(['--report', str(args.report)])
        return subprocess.call(command)
    return run(args)


if __name__ == '__main__':
    raise SystemExit(main())
