"""Real filesystem update transactions with deterministic, offline release bytes."""
from dataclasses import asdict, replace
import hashlib
import io
import json
from pathlib import Path
import tarfile
from unittest.mock import Mock

import pytest

from print_at_soc import update_service as updater
from print_at_soc.update_service import MaintenanceLock, Release, UpdateService

OLD = b'\x7fELFprevious-desktop'
NEW = b'\x7fELFupdated-desktop'


class Response(io.BytesIO):
    def geturl(self):
        return 'https://release-assets.githubusercontent.com/release-file'


def release(data=NEW, version='0.328.9', name='Print_at_SoC_linux_x86_64.AppImage'):
    return Release(version, 'https://github.com/Qingbolan/Print-SoC/releases/download/v' + version + '/' + name,
                   name, len(data), 'sha256:' + hashlib.sha256(data).hexdigest())


@pytest.fixture
def service(tmp_path, monkeypatch):
    instance = UpdateService(tmp_path / 'install', platform_key='linux_x86_64')
    instance.binary.mkdir(parents=True)
    (instance.binary / 'Print_at_SoC').write_bytes(OLD)
    instance.version_file.write_text('0.328.8\n')
    instance.receipt_file.write_text(json.dumps(asdict(release(OLD, '0.328.8'))))
    monkeypatch.setattr(instance, '_ensure_stopped', Mock())
    monkeypatch.setattr(updater.urllib.request, 'urlopen', lambda *a, **kw: Response(NEW))
    return instance


def assert_old(service):
    assert (service.binary / 'Print_at_SoC').read_bytes() == OLD
    assert service.installed_version() == '0.328.8'
    assert json.loads(service.receipt_file.read_text())['version'] == '0.328.8'


def test_update_preserves_snapshot_and_explicit_rollback(service):
    stages = []
    service.update(release(), progress=lambda stage, *a: stages.append(stage))
    assert (service.binary / 'Print_at_SoC').read_bytes() == NEW
    assert service.installed_version() == '0.328.9'
    assert (service.previous / 'bin/Print_at_SoC').read_bytes() == OLD
    assert not service.journal.exists()
    assert stages == ['downloading', 'validating', 'swapping', 'complete']
    service.rollback()
    assert_old(service)
    assert (service.previous / 'bin/Print_at_SoC').read_bytes() == NEW


@pytest.mark.parametrize('problem', ['digest', 'size', 'missing_digest', 'network'])
def test_download_failure_never_removes_working_install(service, monkeypatch, problem):
    asset = release()
    if problem == 'digest':
        asset = replace(asset, digest='sha256:' + '0' * 64)
    elif problem == 'size':
        asset = replace(asset, size=asset.size + 2)
    elif problem == 'missing_digest':
        asset = replace(asset, digest='')
    else:
        monkeypatch.setattr(updater.urllib.request, 'urlopen', Mock(side_effect=TimeoutError('offline')))
    with pytest.raises(Exception):
        service.update(asset)
    assert_old(service)
    assert not list(service.root.glob('.update-stage-*'))
    assert not service.journal.exists()


def test_swap_failure_restores_executable_and_receipt(service, monkeypatch):
    original = Path.rename
    def fail_activation(path, destination):
        if path.name == 'bin' and path.parent.name.startswith('.update-stage-'):
            raise OSError('disk full during swap')
        return original(path, destination)
    monkeypatch.setattr(Path, 'rename', fail_activation)
    with pytest.raises(OSError, match='disk full'):
        service.update(release())
    assert_old(service)
    assert not service.backup.exists()
    assert not service.journal.exists()


def test_receipt_failure_rolls_back_both_metadata_and_binary(service, monkeypatch):
    write = updater._json_write
    def fail_receipt(path, value):
        if path == service.receipt_file and value['version'] == '0.328.9':
            raise OSError('receipt write failed')
        return write(path, value)
    monkeypatch.setattr(updater, '_json_write', fail_receipt)
    with pytest.raises(OSError, match='receipt write'):
        service.update(release())
    assert_old(service)


def test_rollback_supports_existing_install_without_new_receipt(service):
    service.receipt_file.unlink()
    service.update(release())
    service.rollback()
    assert service.installed_version() == '0.328.8'
    assert not service.receipt_file.exists()
    assert (service.binary / 'Print_at_SoC').read_bytes() == OLD


def test_process_death_recovery_is_offline_and_restores_snapshot(service, monkeypatch):
    service.backup.mkdir()
    service.binary.rename(service.backup / 'bin')
    for path in (service.version_file, service.receipt_file):
        (service.backup / path.name).write_text(path.read_text())
    service.binary.mkdir()
    (service.binary / 'Print_at_SoC').write_bytes(NEW)
    service.version_file.write_text('0.328.9\n')
    stage = service.root / '.update-stage-interrupted'
    stage.mkdir()
    service.journal.write_text(json.dumps({'state': 'committing', 'stage': stage.name, 'had_old': True, 'windows': False}))
    monkeypatch.setattr(updater.urllib.request, 'urlopen', Mock(side_effect=AssertionError('recovery must be offline')))
    service.recover()
    assert_old(service)
    assert not stage.exists()
    assert not service.journal.exists()


def test_committed_recovery_finishes_cleanup_without_rolling_back(service):
    service.backup.mkdir()
    service.binary.rename(service.backup / 'bin')
    for path in (service.version_file, service.receipt_file):
        (service.backup / path.name).write_text(path.read_text())
    service.binary.mkdir()
    (service.binary / 'Print_at_SoC').write_bytes(NEW)
    service.version_file.write_text('0.328.9\n')
    service.receipt_file.write_text(json.dumps(asdict(release())))
    stage = service.root / '.update-stage-interrupted'
    stage.mkdir()
    service.journal.write_text(json.dumps({'state': 'committed', 'stage': stage.name, 'had_old': True, 'windows': False}))
    service.recover()
    assert service.installed_version() == '0.328.9'
    assert (service.binary / 'Print_at_SoC').read_bytes() == NEW
    assert (service.previous / 'bin/Print_at_SoC').read_bytes() == OLD


def test_concurrent_maintenance_is_rejected_and_released(service):
    with MaintenanceLock(service.root):
        with pytest.raises(RuntimeError, match='Another Print@SoC'):
            service.update(release())
    service.update(release())


def archive_bytes(name, kind='file', target=''):
    stream = io.BytesIO()
    with tarfile.open(fileobj=stream, mode='w:gz') as archive:
        member = tarfile.TarInfo(name)
        member.size = 4 if kind == 'file' else 0
        if kind == 'symlink':
            member.type = tarfile.SYMTYPE
            member.linkname = target
        elif kind == 'device':
            member.type = tarfile.CHRTYPE
        archive.addfile(member, io.BytesIO(b'data') if kind == 'file' else None)
    return stream.getvalue()


@pytest.mark.parametrize('name,kind,target', [('../escaped', 'file', ''), ('/absolute', 'file', ''),
    ('link', 'symlink', '../../outside'), ('device', 'device', '')])
def test_archive_attack_is_rejected_before_swap(service, monkeypatch, name, kind, target):
    data = archive_bytes(name, kind, target)
    monkeypatch.setattr(updater.urllib.request, 'urlopen', lambda *a, **kw: Response(data))
    with pytest.raises(RuntimeError):
        service.update(release(data, name='desktop.tar.gz'))
    assert_old(service)
    assert not (service.root.parent / 'escaped').exists()


def test_invalid_executable_is_rejected(service, monkeypatch):
    data = b'not a real desktop executable'
    monkeypatch.setattr(updater.urllib.request, 'urlopen', lambda *a, **kw: Response(data))
    with pytest.raises(RuntimeError, match='invalid platform header'):
        service.update(release(data))
    assert_old(service)


def test_latest_uses_published_version_size_and_digest(service, monkeypatch):
    asset = release()
    body = {'tag_name': 'v' + asset.version, 'assets': [{
        'name': asset.name, 'browser_download_url': asset.url, 'size': asset.size, 'digest': asset.digest,
    }]}
    monkeypatch.setattr(updater.urllib.request, 'urlopen', lambda *a, **kw: Response(json.dumps(body).encode()))
    assert service.latest(timeout=3) == asset


def test_running_app_blocks_update_before_download(service, monkeypatch):
    monkeypatch.setattr(service, '_ensure_stopped', Mock(side_effect=RuntimeError('Print@SoC is running')))
    download = Mock(side_effect=AssertionError('must not download'))
    monkeypatch.setattr(service, '_download', download)
    with pytest.raises(RuntimeError, match='running'):
        service.update(release())
    download.assert_not_called()
    assert_old(service)


@pytest.mark.parametrize('suffix', ['.exe', '.msi'])
def test_windows_installer_is_verified_before_native_install(tmp_path, monkeypatch, suffix):
    from print_at_soc import downloader
    service = UpdateService(tmp_path / 'windows', platform_key='windows_x86_64')
    monkeypatch.setattr(service, '_ensure_stopped', Mock())
    actual = tmp_path / 'Print_at_SoC.exe'
    payload = b'MZverified-native-installer'
    asset = release(payload, name='setup' + suffix)
    monkeypatch.setattr(updater.urllib.request, 'urlopen', lambda *a, **kw: Response(payload))
    monkeypatch.setattr(downloader, '_find_windows_installed_exe', lambda: actual if actual.exists() else None)
    invoked = []
    def install(path):
        invoked.append(path)
        assert path.read_bytes() == payload
        actual.write_bytes(b'MZinstalled-app')
    monkeypatch.setattr(service, '_run_windows_installer', install)
    service.update(asset)
    assert len(invoked) == 1
    assert service.installed_version() == asset.version
    assert (service.binary / asset.name).read_bytes() == payload


def test_windows_failed_upgrade_reinstalls_prior_verified_installer(tmp_path, monkeypatch):
    from print_at_soc import downloader
    service = UpdateService(tmp_path / 'windows', platform_key='windows_x86_64')
    monkeypatch.setattr(service, '_ensure_stopped', Mock())
    actual = tmp_path / 'Print_at_SoC.exe'
    actual.write_bytes(b'MZprevious')
    service.binary.mkdir(parents=True)
    prior = release(b'MZold-installer', '0.328.8', 'old.exe')
    (service.binary / prior.name).write_bytes(b'MZold-installer')
    service.version_file.write_text(prior.version)
    service.receipt_file.write_text(json.dumps(asdict(prior)))
    fresh = release(b'MZnew-installer', name='new.exe')
    monkeypatch.setattr(updater.urllib.request, 'urlopen', lambda *a, **kw: Response(b'MZnew-installer'))
    monkeypatch.setattr(downloader, '_find_windows_installed_exe', lambda: actual)
    invoked = []
    def install(path):
        invoked.append(path.name)
        if path.name == 'new.exe':
            raise RuntimeError('native installer failed')
        actual.write_bytes(b'MZrestored')
    monkeypatch.setattr(service, '_run_windows_installer', install)
    with pytest.raises(RuntimeError, match='native installer failed'):
        service.update(fresh)
    assert invoked == ['new.exe', 'old.exe']
    assert service.installed_version() == prior.version
    assert actual.read_bytes() == b'MZrestored'
    assert (service.binary / prior.name).exists()


@pytest.mark.parametrize('relative', ['', 'bin', 'version.txt', '.previous', '.update-backup', '.update-transaction.json'])
def test_managed_symlinks_are_rejected_without_following(tmp_path, monkeypatch, relative):
    root = tmp_path / 'root'
    outside = tmp_path / 'outside'
    outside.mkdir()
    (outside / 'keep').write_text('untouched')
    if relative:
        root.mkdir()
        (root / relative).symlink_to(outside, target_is_directory=True)
    else:
        root.symlink_to(outside, target_is_directory=True)
    service = UpdateService(root, platform_key='linux_x86_64')
    monkeypatch.setattr(service, '_ensure_stopped', Mock())
    with pytest.raises(RuntimeError, match='symbolic link'):
        service.recover()
    assert (outside / 'keep').read_text() == 'untouched'


def test_recovery_refuses_to_replace_running_desktop(service, monkeypatch):
    stage = service.root / '.update-stage-interrupted'
    stage.mkdir()
    service.journal.write_text(json.dumps({'state': 'committing', 'stage': stage.name, 'had_old': True}))
    monkeypatch.setattr(service, '_ensure_stopped', Mock(side_effect=RuntimeError('close running app')))
    with pytest.raises(RuntimeError, match='running app'):
        service.recover()
    assert service.journal.exists()
    assert_old(service)


def test_linux_appimage_mount_process_blocks_update(service, monkeypatch):
    monkeypatch.setattr(service, '_ensure_stopped', UpdateService._ensure_stopped.__get__(service))
    monkeypatch.setattr(updater.subprocess, 'run', Mock(return_value=type('Result', (), {
        'returncode': 0, 'stdout': '/tmp/.mount_PrintXXXX/usr/bin/Print_at_SoC\n',
    })()))
    with pytest.raises(RuntimeError, match='running'):
        service._ensure_stopped()


def test_first_windows_install_failure_can_recover_after_native_uninstall(tmp_path, monkeypatch):
    from print_at_soc import downloader
    service = UpdateService(tmp_path / 'windows', platform_key='windows_x86_64')
    monkeypatch.setattr(service, '_ensure_stopped', Mock())
    actual = tmp_path / 'native-app.exe'
    monkeypatch.setattr(downloader, '_find_windows_installed_exe', lambda: actual if actual.exists() else None)
    payload = b'MZnative-installer'
    monkeypatch.setattr(updater.urllib.request, 'urlopen', lambda *a, **kw: Response(payload))
    def partial_install(path):
        actual.write_bytes(b'MZpartial-app')
        raise RuntimeError('native failure')
    monkeypatch.setattr(service, '_run_windows_installer', partial_install)
    with pytest.raises(RuntimeError, match='may have made system changes'):
        service.update(release(payload, name='setup.exe'))
    assert not service.version_file.exists()
    assert service.journal.exists()
    actual.unlink()  # User/native uninstaller removes the partial installation.
    service.recover()
    assert not service.journal.exists()
    assert not service.binary.exists()


def test_first_windows_failure_without_native_executable_cleans_local_transaction(tmp_path, monkeypatch):
    from print_at_soc import downloader
    service = UpdateService(tmp_path / 'windows', platform_key='windows_x86_64')
    monkeypatch.setattr(service, '_ensure_stopped', Mock())
    monkeypatch.setattr(downloader, '_find_windows_installed_exe', lambda: None)
    payload = b'MZnative-installer'
    monkeypatch.setattr(updater.urllib.request, 'urlopen', lambda *a, **kw: Response(payload))
    monkeypatch.setattr(service, '_run_windows_installer', Mock(side_effect=RuntimeError('native failure')))
    with pytest.raises(RuntimeError, match='no prior native installer'):
        service.update(release(payload, name='setup.exe'))
    assert not service.journal.exists()
    assert not service.version_file.exists()


def test_committed_cleanup_error_preserves_new_app_and_recoverable_previous(service, monkeypatch):
    original = service._finalize
    monkeypatch.setattr(service, '_finalize', Mock(side_effect=OSError('cleanup denied')))
    with pytest.raises(OSError, match='cleanup denied'):
        service.update(release())
    assert service.installed_version() == '0.328.9'
    assert (service.backup / 'bin/Print_at_SoC').read_bytes() == OLD
    monkeypatch.setattr(service, '_finalize', original)
    service.recover()
    assert service.installed_version() == '0.328.9'
    assert (service.previous / 'bin/Print_at_SoC').read_bytes() == OLD


def test_journal_write_failure_before_swap_leaves_no_orphan_backup(service, monkeypatch):
    monkeypatch.setattr(updater, '_json_write', Mock(side_effect=OSError('journal write failed')))
    with pytest.raises(OSError, match='journal write'):
        service.update(release())
    assert_old(service)
    assert not service.backup.exists()
    assert not service.journal.exists()


def test_recovery_cleans_interrupted_download_and_uncommitted_metadata(service):
    service.backup.mkdir()
    (service.backup / 'version.txt').write_text('0.328.8')
    stage = service.root / '.update-stage-interrupted'
    stage.mkdir()
    (stage / 'partial-download').write_bytes(b'partial')
    service.recover()
    assert_old(service)
    assert not service.backup.exists()
    assert not stage.exists()


def test_interrupted_recovery_cleanup_keeps_restored_receipt(service, monkeypatch):
    service.backup.mkdir()
    service.binary.rename(service.backup / 'bin')
    for path in (service.version_file, service.receipt_file):
        (service.backup / path.name).write_text(path.read_text())
    service.binary.mkdir()
    (service.binary / 'Print_at_SoC').write_bytes(NEW)
    service.version_file.write_text('0.328.9\n')
    stage = service.root / '.update-stage-recovery-cleanup'
    stage.mkdir()
    service.journal.write_text(json.dumps({'state': 'committing', 'stage': stage.name,
                                           'had_old': True, 'windows': False}))
    remove = updater._remove
    def interrupted_remove(path):
        remove(path)
        if path == service.backup:
            raise OSError('process stopped after recovery backup cleanup')
    monkeypatch.setattr(updater, '_remove', interrupted_remove)
    with pytest.raises(OSError, match='process stopped'):
        service.recover()
    assert_old(service)
    monkeypatch.setattr(updater, '_remove', remove)
    service.recover()
    assert_old(service)
    assert not stage.exists()
