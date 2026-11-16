#!/usr/bin/env python3
"""Verify published desktop upgrade/rollback using a retained, isolated install.

The production updater verifies real GitHub downloads. Only its process guard is
scoped to this script's temporary directory, so an unrelated installed desktop
can remain open. HOME is never replaced. macOS MCP initialization runs with
filesystem writes confined to the temporary directory; no print/login tools run.
Windows installers are skipped unless --disposable-ci explicitly permits native
system changes on a GitHub-hosted Actions runner. That flag also enables Linux
AppImage MCP execution after extraction, without requiring FUSE.
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


def require_disposable_ci():
    require(os.environ.get('GITHUB_ACTIONS') == 'true'
            and os.environ.get('RUNNER_ENVIRONMENT') == 'github-hosted',
            '--disposable-ci is restricted to disposable GitHub-hosted Actions runners')


def select_release(tag, platform_key, config, release_type, asset_name=None):
    repository = config.GITHUB_REPO
    metadata = json.loads(fetch_bytes(
        f'https://api.github.com/repos/{repository}/releases/tags/{quote(tag, safe="")}', api=True))
    require(metadata.get('tag_name') == tag, 'GitHub returned a different release tag')
    require(not metadata.get('draft'), 'Release is still a draft')
    assets = {asset['name']: asset for asset in metadata.get('assets', [])}
    platform = config.PLATFORM_BINARIES[platform_key]
    candidates = (asset_name,) if asset_name else (platform['asset_name'], platform.get('asset_name_fallback'))
    name = next((name for name in candidates
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


def isolated_service(service_type, temporary_root, platform_key, downloads, disposable_ci=False):
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
            if self.platform_key.startswith('windows'):
                require(disposable_ci, 'Native Windows operations need --disposable-ci')
                require_disposable_ci()
                return super()._ensure_stopped()
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

        def _run_windows_installer(self, path):
            require(disposable_ci and sys.platform == 'win32', 'Silent native installers are CI-only')
            require_disposable_ci()
            require(path.resolve().is_relative_to(base), 'Installer is outside the verification root')
            if path.suffix.lower() == '.msi':
                log = base / f'msi-{len(list(base.glob("msi-*.log")))}.log'
                command = ['msiexec', '/i', str(path), '/qn', '/norestart', '/L*V', str(log)]
                allowed = (0, 1641, 3010)
            else:
                require(path.suffix.lower() == '.exe', 'Unknown Windows installer format')
                command, allowed = [str(path), '/S'], (0,)
            result = subprocess.run(command, capture_output=True, text=True, timeout=300)
            require(result.returncode in allowed,
                    f'Silent {path.suffix} installer failed with code {result.returncode}; inspect retained CI installer logs')

    return IsolatedUpdateService()


def verify_install(service, release, config, sentinels):
    require(service.installed_version() == release.version, 'Installed version receipt is incorrect')
    require(json.loads(service.receipt_file.read_text()) == asdict(release), 'Installed asset receipt is incorrect')
    if service.platform_key.startswith('windows'):
        from print_at_soc.downloader import _find_windows_installed_exe
        executable = _find_windows_installed_exe()
        service._verify_file(service.binary / release.name, release)
    else:
        executable = service.binary / config.PLATFORM_BINARIES[service.platform_key]['executable_path']
    require(executable is not None and executable.is_file(), 'Installed desktop executable is missing')
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
    details['preserved_sentinels'] = {str(path.relative_to(service.root) if path.is_relative_to(service.root) else path): digest_file(path)
                                     for path in sentinels}
    require(not service.journal.exists() and not service.backup.exists()
            and not list(service.root.glob('.update-stage-*')), 'Update left an incomplete transaction')
    return details


def mcp_initialize(executable, version, temporary_root, disposable_ci=False):
    if sys.platform != 'darwin' and not disposable_ci:
        return {'status': 'skipped', 'reason': 'Native MCP runtime smoke is scoped to macOS; Linux AppImage host requirements are not evaluated'}
    if sys.platform == 'darwin':
        sandbox = Path('/usr/bin/sandbox-exec')
        require(sandbox.is_file(), 'macOS sandbox-exec is required to confine MCP filesystem writes')
        profile = ('(version 1)(allow default)(deny file-write*)'
                   f'(allow file-write* (subpath {json.dumps(str(temporary_root.resolve()))}))')
        command = [str(sandbox), '-p', profile, str(executable), 'mcp']
        confinement = 'sandbox-exec denies writes outside verification root; HOME unchanged'
    else:
        require_disposable_ci()
        confinement = 'Explicit disposable GitHub-hosted runner; HOME unchanged'
        if sys.platform.startswith('linux'):
            extraction = Path(tempfile.mkdtemp(prefix='mcp-appimage-', dir=temporary_root))
            result = subprocess.run([str(executable), '--appimage-extract'], cwd=extraction,
                                    capture_output=True, text=True, timeout=90)
            require(result.returncode == 0, f'AppImage extraction failed: {result.stderr[-4000:]}')
            app_run = extraction / 'squashfs-root' / 'AppRun'
            require(app_run.is_file(), 'Extracted AppImage is missing AppRun')
            command = [str(app_run), 'mcp']
        else:
            require(sys.platform == 'win32', 'Unsupported native MCP verification platform')
            command = [str(executable), 'mcp']
    request = {'jsonrpc': '2.0', 'id': 1, 'method': 'initialize', 'params': {
        'protocolVersion': '2025-06-18', 'capabilities': {},
        'clientInfo': {'name': 'print-soc-release-verification', 'version': version},
    }}
    result = subprocess.run(command,
                            input=json.dumps(request) + '\n', capture_output=True, text=True,
                            timeout=20, cwd=temporary_root)
    diagnostic = result.stderr[-6000:] if disposable_ci else 'stderr is not recorded to avoid exposing user data'
    require(result.returncode == 0, f'MCP initialize exited with code {result.returncode}; {diagnostic}')
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
            'confinement': confinement}


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
        if args.disposable_ci:
            require_disposable_ci()
            report['disposable_ci'] = True
        if platform_key.startswith('windows') and not args.disposable_ci:
            report.update(status='skipped', reason='Windows MSI/NSIS installers change native host state and cannot be exercised inside a temporary directory; use a disposable Windows VM')
            return 0
        if platform_key.startswith('windows'):
            from print_at_soc.downloader import _find_windows_installed_exe
            require(_find_windows_installed_exe() is None,
                    'Windows CI must start without an existing Print@SoC native installation')
            report['process_guard'] = 'Production Windows process guard; native installer system changes explicitly permitted only on a disposable GitHub-hosted runner'
        require(tuple(map(int, args.new_tag[1:].split('.'))) > tuple(map(int, args.old_tag[1:].split('.'))),
                '--new-tag must be newer than --old-tag')
        old, report['old_release'] = select_release(args.old_tag, platform_key, config, update_service.Release, args.asset_name)
        new, report['new_release'] = select_release(args.new_tag, platform_key, config, update_service.Release, args.asset_name)
        service = isolated_service(update_service.UpdateService, temporary_root, platform_key, report['downloads'], args.disposable_ci)
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

        def record_mcp(name, details, release):
            report['steps'].append({'name': name, **mcp_initialize(
                Path(details['executable']), release.version, temporary_root, args.disposable_ci)})

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
        if platform_key.startswith('windows'):
            # Exercise native installer data retention in addition to the managed
            # updater directory; this only runs on the explicitly disposable VM.
            path = Path(os.environ['APPDATA']) / 'tech.silan.PrintAtSoC' / 'release-verification.json'
            require(not path.exists(), 'Windows CI data sentinel unexpectedly exists')
            path.parent.mkdir(parents=True, exist_ok=True)
            sentinels[path] = b'{"verification":"preserve native application data"}\n'
            path.write_bytes(sentinels[path])
        baseline = record_step('install_old_release_and_create_sentinels', old)
        old_metadata = {path.name: path.read_bytes() for path in (service.version_file, service.receipt_file)}
        record_mcp('old_desktop_mcp_initialize', baseline, old)

        print(f'Upgrading to published {args.new_tag}', flush=True)
        service.update(new, progress)
        upgraded = record_step('upgrade_to_new_release', new)
        record_mcp('new_desktop_mcp_initialize', upgraded, new)

        print('Rolling back to the published baseline', flush=True)
        service.rollback(progress)
        restored = record_step('rollback_to_old_release', old)
        require(restored['executable_sha256'] == baseline['executable_sha256'], 'Rollback executable differs from baseline')
        require(all((service.root / name).read_bytes() == content for name, content in old_metadata.items()),
                'Rollback did not restore exact original metadata bytes')
        report['steps'][-1]['exact_metadata_restored'] = True
        record_mcp('rolled_back_desktop_mcp_initialize', restored, old)

        print(f'Reapplying published {args.new_tag}', flush=True)
        service.update(new, progress)
        reapplied = record_step('reupgrade_to_new_release', new)
        require(reapplied['executable_sha256'] == upgraded['executable_sha256'], 'Reupgrade executable differs from verified new binary')
        record_mcp('reupgraded_desktop_mcp_initialize', reapplied, new)
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
    parser.add_argument('--asset-name', help='Exact release asset name (for each Ubuntu image or Windows installer format)')
    parser.add_argument('--disposable-ci', action='store_true', help='Permit native Windows installation and Linux MCP execution only on disposable GitHub-hosted runners')
    args = parser.parse_args()
    if args.python:
        command = [args.python, str(Path(__file__).resolve()), '--old-tag', args.old_tag, '--new-tag', args.new_tag]
        if args.report:
            command.extend(['--report', str(args.report)])
        if args.asset_name:
            command.extend(['--asset-name', args.asset_name])
        if args.disposable_ci:
            command.append('--disposable-ci')
        return subprocess.call(command)
    return run(args)


if __name__ == '__main__':
    raise SystemExit(main())
