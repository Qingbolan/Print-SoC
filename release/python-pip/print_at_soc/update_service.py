"""Verified release downloads and recoverable desktop installation transactions."""
from __future__ import annotations

from contextlib import AbstractContextManager
from dataclasses import asdict, dataclass
import csv
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import subprocess
import tarfile
import tempfile
from typing import Optional
from urllib.parse import urlparse
import urllib.request
import zipfile

from packaging.version import Version

from .config import GITHUB_API_URL, GITHUB_REPO, INSTALL_DIR, PLATFORM_BINARIES


@dataclass(frozen=True)
class Release:
    version: str
    url: str
    name: str
    size: int
    digest: str


class MaintenanceLock(AbstractContextManager):
    """OS-owned lock releases on process death, unlike a stale PID file."""
    def __init__(self, root: Path):
        self.root = Path(root)
        self.file = None

    def __enter__(self):
        if self.root.is_symlink():
            raise RuntimeError('Installation directory must not be a symbolic link')
        self.root.mkdir(parents=True, exist_ok=True)
        path = self.root / '.maintenance.lock'
        if path.is_symlink():
            raise RuntimeError('Maintenance lock must not be a symbolic link')
        self.file = path.open('a+b')
        try:
            if os.name == 'nt':
                import msvcrt
                self.file.seek(0)
                self.file.write(b'0')
                self.file.flush()
                self.file.seek(0)
                msvcrt.locking(self.file.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(self.file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except (OSError, BlockingIOError) as error:
            self.file.close()
            self.file = None
            raise RuntimeError('Another Print@SoC maintenance operation is running. Retry when it finishes.') from error
        return self

    def __exit__(self, *_):
        if self.file:
            if os.name == 'nt':
                import msvcrt
                self.file.seek(0)
                msvcrt.locking(self.file.fileno(), msvcrt.LK_UNLCK, 1)
            self.file.close()
            self.file = None


def _atomic_write(path: Path, data: str):
    descriptor, name = tempfile.mkstemp(prefix='.' + path.name, dir=path.parent)
    try:
        with os.fdopen(descriptor, 'w', encoding='utf-8') as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def _json_write(path, value):
    _atomic_write(path, json.dumps(value, indent=2) + '\n')


def _remove(path):
    if path.is_symlink() or path.is_file():
        path.unlink()
    elif path.exists():
        shutil.rmtree(path)


def _https(url):
    parsed = urlparse(url)
    if parsed.scheme != 'https' or parsed.username or parsed.password or not parsed.hostname:
        raise RuntimeError('Release downloads require HTTPS URLs without embedded credentials')


class UpdateService:
    MAX_EXTRACTED_BYTES = 2 * 1024 ** 3

    def __init__(self, root: Path = INSTALL_DIR, *, platform_key=None):
        from .downloader import get_platform_key
        self.root = Path(root)
        self.platform_key = platform_key or get_platform_key()
        self.binary = self.root / 'bin'
        self.version_file = self.root / 'version.txt'
        self.receipt_file = self.root / 'receipt.json'
        self.previous = self.root / '.previous'
        self.backup = self.root / '.update-backup'
        self.journal = self.root / '.update-transaction.json'

    def _validate_managed_paths(self):
        for path in (self.root, self.binary, self.version_file, self.receipt_file, self.previous,
                     self.previous / 'bin', self.previous / 'receipt.json', self.previous / 'version.txt',
                     self.backup, self.backup / 'bin', self.backup / 'receipt.json', self.backup / 'version.txt',
                     self.journal):
            if path.is_symlink():
                raise RuntimeError(f'Managed installation path must not be a symbolic link: {path}')

    def installed_version(self) -> Optional[str]:
        self._validate_managed_paths()
        return self.version_file.read_text().strip() if self.version_file.is_file() else None

    def latest(self, timeout=10) -> Release:
        request = urllib.request.Request(GITHUB_API_URL, headers={
            'Accept': 'application/vnd.github+json', 'User-Agent': 'PrintAtSoC-Updater',
        })
        with urllib.request.urlopen(request, timeout=timeout) as response:
            _https(response.geturl())
            data = json.load(response)
        version = str(data.get('tag_name', '')).lstrip('v')
        if not re.fullmatch(r'\d+\.\d+\.\d+', version):
            raise RuntimeError('Latest release has no valid Tide coordinate')
        Version(version)
        config = PLATFORM_BINARIES[self.platform_key]
        for name in (config['asset_name'], config.get('asset_name_fallback')):
            if not name:
                continue
            for asset in data.get('assets', []):
                if asset.get('name') == name:
                    url = str(asset.get('browser_download_url', ''))
                    _https(url)
                    parsed = urlparse(url)
                    expected = '/' + GITHUB_REPO + '/releases/download/'
                    if parsed.hostname != 'github.com' or not parsed.path.startswith(expected):
                        raise RuntimeError('Release asset does not belong to the configured GitHub repository')
                    return Release(version, url, name, int(asset.get('size', 0)), str(asset.get('digest') or ''))
        raise RuntimeError('Latest release has no desktop asset for ' + self.platform_key)

    def _emit(self, progress, stage, completed=0, total=0):
        if progress:
            progress(stage, completed, total)

    def _download(self, release: Release, destination: Path, progress=None):
        _https(release.url)
        if not re.fullmatch(r'sha256:[0-9a-fA-F]{64}', release.digest):
            raise RuntimeError('This release has no SHA-256 asset digest. Ask the release publisher to re-upload the asset with GitHub digest metadata; the current installation is unchanged.')
        if release.size <= 0:
            raise RuntimeError('Release metadata has no valid asset size')
        digest, received = hashlib.sha256(), 0
        request = urllib.request.Request(release.url, headers={'User-Agent': 'PrintAtSoC-Updater'})
        with urllib.request.urlopen(request, timeout=30) as response, destination.open('wb') as stream:
            _https(response.geturl())
            while True:
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                received += len(chunk)
                if received > release.size:
                    raise RuntimeError('Downloaded asset exceeds its published size')
                stream.write(chunk)
                digest.update(chunk)
                self._emit(progress, 'downloading', received, release.size)
            stream.flush()
            os.fsync(stream.fileno())
        if received != release.size:
            raise RuntimeError('Download is incomplete: size does not match release metadata')
        if digest.hexdigest() != release.digest.split(':', 1)[1].lower():
            raise RuntimeError('SHA-256 verification failed; the current installation is unchanged')

    @staticmethod
    def _member_path(name):
        path = PurePosixPath(name)
        if path.is_absolute() or '..' in path.parts or '\\' in name or ':' in name:
            raise RuntimeError('Unsafe path in release archive: ' + name)
        return path

    def _extract(self, artifact: Path, payload: Path):
        payload.mkdir()
        if artifact.name.endswith('.tar.gz'):
            with tarfile.open(artifact, 'r:gz') as archive:
                members = archive.getmembers()
                if sum(item.size for item in members) > self.MAX_EXTRACTED_BYTES:
                    raise RuntimeError('Release archive exceeds the extraction size limit')
                names, links = set(), set()
                for item in members:
                    relative = self._member_path(item.name)
                    if str(relative) in names:
                        raise RuntimeError('Duplicate path in release archive')
                    names.add(str(relative))
                    if item.issym() or item.islnk():
                        # Bundles may contain internal framework links. Do not
                        # permit writes through them or links outside the bundle.
                        target = relative.parent / item.linkname if item.issym() else PurePosixPath(item.linkname)
                        if os.path.commonpath([str((payload / str(target)).resolve()), str(payload.resolve())]) != str(payload.resolve()):
                            raise RuntimeError('Release archive link escapes its payload')
                        links.add(relative)
                    elif not (item.isfile() or item.isdir()):
                        raise RuntimeError('Release archive contains a special device')
                for item in members:
                    relative = self._member_path(item.name)
                    if any(parent in links for parent in relative.parents):
                        raise RuntimeError('Release archive writes through a symbolic link')
                    target = payload / str(relative)
                    if item.isdir():
                        target.mkdir(parents=True, exist_ok=True)
                    elif item.isfile():
                        target.parent.mkdir(parents=True, exist_ok=True)
                        source = archive.extractfile(item)
                        if source is None:
                            raise RuntimeError('Release archive file cannot be read')
                        with source, target.open('wb') as output:
                            shutil.copyfileobj(source, output)
                        target.chmod(item.mode & 0o777)
                for item in members:
                    target = payload / str(self._member_path(item.name))
                    if item.issym():
                        target.parent.mkdir(parents=True, exist_ok=True)
                        target.symlink_to(item.linkname)
                    elif item.islnk():
                        source = payload / str(self._member_path(item.linkname))
                        target.parent.mkdir(parents=True, exist_ok=True)
                        os.link(source, target)
                for relative in links:
                    resolved = (payload / str(relative)).resolve()
                    if os.path.commonpath([str(resolved), str(payload.resolve())]) != str(payload.resolve()):
                        raise RuntimeError('Release archive link escapes its payload')
        elif artifact.suffix == '.zip':
            with zipfile.ZipFile(artifact) as archive:
                entries = archive.infolist()
                if sum(entry.file_size for entry in entries) > self.MAX_EXTRACTED_BYTES:
                    raise RuntimeError('Release archive exceeds the extraction size limit')
                names = set()
                for entry in entries:
                    relative = self._member_path(entry.filename)
                    if str(relative) in names or stat.S_ISLNK(entry.external_attr >> 16):
                        raise RuntimeError('Release ZIP contains duplicate paths or symbolic links')
                    names.add(str(relative))
                    target = payload / str(relative)
                    if entry.is_dir():
                        target.mkdir(parents=True, exist_ok=True)
                    else:
                        target.parent.mkdir(parents=True, exist_ok=True)
                        with archive.open(entry) as source, target.open('wb') as output:
                            shutil.copyfileobj(source, output)
        elif artifact.suffix == '.AppImage':
            shutil.copy2(artifact, payload / PLATFORM_BINARIES[self.platform_key]['executable_path'])
        else:
            raise RuntimeError('Unsupported desktop archive format: ' + artifact.name)

    def _validate_payload(self, payload: Path):
        executable = payload / PLATFORM_BINARIES[self.platform_key]['executable_path']
        if any((payload / Path(*executable.relative_to(payload).parts[:index])).is_symlink() for index in range(1, len(executable.relative_to(payload).parts) + 1)) or not executable.is_file() or executable.stat().st_size < 4:
            raise RuntimeError('Release does not contain the expected usable desktop executable')
        with executable.open('rb') as stream:
            magic = stream.read(4)
        allowed = {b'\x7fELF'} if self.platform_key.startswith('linux') else {b'\xcf\xfa\xed\xfe', b'\xce\xfa\xed\xfe', b'\xfe\xed\xfa\xcf', b'\xca\xfe\xba\xbe', b'\xca\xfe\xba\xbf'}
        if magic not in allowed:
            raise RuntimeError('Desktop executable has an invalid platform header')
        executable.chmod(executable.stat().st_mode | 0o111)

    def _ensure_stopped(self):
        if self.platform_key.startswith('windows'):
            output = subprocess.run(['tasklist', '/FO', 'CSV', '/NH', '/FI', 'IMAGENAME eq Print_at_SoC.exe'], capture_output=True, text=True, check=False)
            if output.returncode:
                raise RuntimeError('Cannot inspect running applications; close Print@SoC before retrying')
            running = any(row and row[0].lower() == 'print_at_soc.exe' for row in csv.reader(io.StringIO(output.stdout)))
        else:
            output = subprocess.run(['ps', '-axo', 'comm='], capture_output=True, text=True, check=False)
            if output.returncode:
                raise RuntimeError('Cannot inspect running applications; close Print@SoC before retrying')
            root = str(self.binary.resolve()) + os.sep
            expected_name = Path(PLATFORM_BINARIES[self.platform_key]['executable_path']).name
            # Linux comm is usually only the executable name; macOS exposes the
            # full executable path. Treat an ambiguous name conservatively.
            running = any(line.strip().startswith(root) or Path(line.strip()).name == expected_name
                          for line in output.stdout.splitlines())
        if running:
            raise RuntimeError('Print@SoC is running. Close the desktop app and any MCP clients before updating or rolling back.')

    def recover(self):
        with MaintenanceLock(self.root):
            self._recover_locked()

    def _read_journal(self):
        data = json.loads(self.journal.read_text())
        stage = data.get('stage', '')
        if data.get('state') not in ('prepared', 'committing', 'committed') or not isinstance(data.get('had_old'), bool) or not re.fullmatch(r'\.update-stage-[A-Za-z0-9_-]+', stage):
            raise RuntimeError('Invalid update journal; keep the backup and inspect the installation directory')
        return data

    def _restore_metadata(self):
        for name in ('version.txt', 'receipt.json'):
            source = self.backup / name
            target = self.root / name
            if source.exists():
                _atomic_write(target, source.read_text())
            elif target.exists():
                target.unlink()

    def _recover_locked(self):
        self._validate_managed_paths()
        if not self.journal.exists():
            if self.backup.exists():
                if (self.backup / 'bin').exists():
                    raise RuntimeError('An update backup exists without a journal; preserve it and inspect the installation before continuing')
                if any(path.name not in ('version.txt', 'receipt.json') for path in self.backup.iterdir()):
                    raise RuntimeError('Unrecognized files in the update backup; refusing to remove them')
                _remove(self.backup)  # Crash before the first journal write.
            for stale in self.root.glob('.update-stage-*'):
                if re.fullmatch(r'\.update-stage-[A-Za-z0-9_-]+', stale.name):
                    if stale.is_symlink():
                        raise RuntimeError('Update staging directory must not be a symbolic link')
                    _remove(stale)  # Interrupted download, before any activation.
            return
        self._ensure_stopped()
        data = self._read_journal()
        if (self.root / data['stage']).is_symlink():
            raise RuntimeError('Update staging directory must not be a symbolic link')
        if data.get('windows') and data['state'] != 'committed':
            self._restore_windows(data)
        if data['state'] == 'committed':
            self._finalize(data)
            return
        if (self.backup / 'bin').exists():
            _remove(self.binary)
            (self.backup / 'bin').rename(self.binary)
        elif not data['had_old'] and data['state'] != 'prepared':
            _remove(self.binary)
        self._restore_metadata()
        # Recovery is complete once both active files and metadata are restored.
        # Remove its intent before deleting the only metadata snapshot: if cleanup
        # is interrupted, the no-journal path safely discards remaining artifacts.
        # Keeping the journal after deleting backup would make the next recovery
        # interpret absent snapshot metadata as an instruction to delete it.
        self.journal.unlink()
        _remove(self.backup)
        _remove(self.root / data['stage'])

    def _finalize(self, data):
        if self.backup.exists():
            _remove(self.previous)
            if data['had_old']:
                self.backup.rename(self.previous)
            else:
                _remove(self.backup)
        _remove(self.root / data['stage'])
        self.journal.unlink(missing_ok=True)

    def _commit(self, stage, release, progress=None, windows=False, target_metadata=None):
        if self.backup.exists():
            raise RuntimeError('An unclaimed update backup exists; inspect it before replacing this installation')
        self.backup.mkdir()
        try:
            for name in ('version.txt', 'receipt.json'):
                source = self.root / name
                if source.exists():
                    shutil.copy2(source, self.backup / name)
            data = {'state': 'prepared', 'stage': stage.name, 'had_old': self.binary.exists(), 'windows': windows}
            if windows:
                from .downloader import _find_windows_installed_exe
                data['had_native'] = bool(_find_windows_installed_exe())
            _json_write(self.journal, data)
        except BaseException:
            _remove(self.backup)
            raise
        try:
            data['state'] = 'committing'
            _json_write(self.journal, data)
            self._emit(progress, 'swapping')
            if self.binary.exists():
                self.binary.rename(self.backup / 'bin')
            if windows:
                self._run_windows_installer(stage / 'bin' / release.name)
                self._validate_windows_install()
            (stage / 'bin').rename(self.binary)
            if not windows:
                self._validate_payload(self.binary)
            if target_metadata is None:
                _atomic_write(self.version_file, release.version + '\n')
                _json_write(self.receipt_file, asdict(release))
            else:
                for name, content in target_metadata.items():
                    if content is None:
                        (self.root / name).unlink(missing_ok=True)
                    else:
                        _atomic_write(self.root / name, content)
            data['state'] = 'committed'
            _json_write(self.journal, data)
        except BaseException as error:
            self._emit(progress, 'rollback')
            self._recover_locked()
            if windows and not data.get('had_native'):
                raise RuntimeError(f'Windows native installation failed: {error}. Local transaction files were recovered, but a first installation has no prior native installer to restore. Inspect Windows Installed Apps for partial system changes.') from error
            raise
        self._finalize(data)
        self._emit(progress, 'complete')

    def _validate_windows_install(self):
        from .downloader import _find_windows_installed_exe
        path = _find_windows_installed_exe()
        if not path or not path.is_file() or path.stat().st_size < 2:
            raise RuntimeError('Windows installer did not produce a usable desktop executable')

    def _run_windows_installer(self, path):
        from .downloader import _run_nsis_installer, _install_msi
        (_install_msi if path.suffix.lower() == '.msi' else _run_nsis_installer)(path)

    def _restore_windows(self, data):
        if data['state'] == 'prepared':
            return
        receipt = self.backup / 'receipt.json'
        if not data.get('had_native', data['had_old']):
            from .downloader import _find_windows_installed_exe
            if _find_windows_installed_exe() is None:
                # No managed native executable remains: recover local files only.
                # Registry cleanup, if any, still belongs to the native installer.
                return
            raise RuntimeError('Windows installation failed. The native installer may have made system changes; repair or uninstall Print@SoC in Windows Installed Apps before retrying. The transaction journal was preserved.')
        if not receipt.is_file():
            raise RuntimeError('Cannot restore the prior Windows installation: verified installer receipt is missing')
        release = Release(**json.loads(receipt.read_text()))
        installer = self.backup / 'bin' / release.name
        self._verify_file(installer, release)
        self._run_windows_installer(installer)
        self._validate_windows_install()

    @staticmethod
    def _verify_file(path, release):
        if not path.is_file() or path.stat().st_size != release.size:
            raise RuntimeError('Cached installer is missing or has an unexpected size')
        digest = hashlib.sha256()
        with path.open('rb') as stream:
            for block in iter(lambda: stream.read(1024 * 1024), b''):
                digest.update(block)
        if 'sha256:' + digest.hexdigest() != release.digest.lower():
            raise RuntimeError('Cached installer failed SHA-256 verification')

    def update(self, release: Release, progress=None):
        Version(release.version.lstrip('v'))
        if Path(release.name).name != release.name or release.name in ('', '.', '..'):
            raise RuntimeError('Unsafe release asset filename')
        with MaintenanceLock(self.root):
            self._recover_locked()
            if self.binary.is_symlink():
                raise RuntimeError('The managed desktop directory must not be a symbolic link')
            self._ensure_stopped()
            windows = self.platform_key.startswith('windows')
            if windows:
                from .downloader import _find_windows_installed_exe
                existing = _find_windows_installed_exe()
                if existing:
                    if not self.receipt_file.is_file():
                        raise RuntimeError('This Windows installation predates verified installer caching. Update it through the native installer; automatic update is unavailable until a verified installer is cached.')
                    prior = Release(**json.loads(self.receipt_file.read_text()))
                    self._verify_file(self.binary / prior.name, prior)
            stage = Path(tempfile.mkdtemp(prefix='.update-stage-', dir=self.root))
            try:
                artifact = stage / release.name
                self._download(release, artifact, progress)
                self._emit(progress, 'validating')
                if windows:
                    (stage / 'bin').mkdir()
                    shutil.move(str(artifact), stage / 'bin' / release.name)
                else:
                    self._extract(artifact, stage / 'bin')
                    self._validate_payload(stage / 'bin')
                self._ensure_stopped()
                self._commit(stage, release, progress, windows=windows)
            finally:
                if not self.journal.exists():
                    _remove(stage)

    def rollback(self, progress=None):
        with MaintenanceLock(self.root):
            self._recover_locked()
            if self.binary.is_symlink():
                raise RuntimeError('The managed desktop directory must not be a symbolic link')
            self._ensure_stopped()
            receipt = self.previous / 'receipt.json'
            if not (self.previous / 'bin').is_dir():
                raise RuntimeError('No previous version is available for rollback')
            release = Release(**json.loads(receipt.read_text())) if receipt.is_file() else None
            target_metadata = {name: (self.previous / name).read_text() if (self.previous / name).is_file() else None
                               for name in ('version.txt', 'receipt.json')}
            stage = Path(tempfile.mkdtemp(prefix='.update-stage-', dir=self.root))
            try:
                shutil.copytree(self.previous / 'bin', stage / 'bin', symlinks=True)
                windows = self.platform_key.startswith('windows')
                if windows:
                    if release is None:
                        raise RuntimeError('No verified prior Windows installer is available')
                    self._verify_file(stage / 'bin' / release.name, release)
                else:
                    self._validate_payload(stage / 'bin')
                self._commit(stage, release, progress, windows=windows, target_metadata=target_metadata)
            finally:
                if not self.journal.exists():
                    _remove(stage)
