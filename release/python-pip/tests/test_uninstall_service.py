"""Clean-uninstall ownership and refusal tests; all files live under tmp_path."""
from contextlib import contextmanager
from pathlib import Path
import subprocess
import sys
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from print_at_soc import uninstall_service as us
from print_at_soc import virtual_printer as vp


@pytest.fixture
def service(monkeypatch, tmp_path):
    root = tmp_path / 'install'
    root.mkdir()
    engine = us.UninstallService(root)
    engine.home = tmp_path / 'home'
    engine.home.mkdir()
    engine.system = 'Darwin'
    monkeypatch.setattr(engine, '_cups_inventory', lambda purge: [])
    monkeypatch.setattr(engine, '_assert_idle', Mock())
    monkeypatch.setattr(engine, '_clear_credentials', Mock())
    return engine


def create(path, content='test'):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content)
    return path


def test_preview_never_deletes_or_reads_credentials(service):
    binary = create(service.root / 'bin' / 'Print_at_SoC')
    config = create(service.root / 'virtual-printer.json', 'private')
    items = service.plan(purge=True)
    assert binary.exists() and config.exists()
    assert any(item.path == service.root / 'bin' for item in items)
    assert any(item.kind == 'credentials' for item in items)
    service._clear_credentials.assert_not_called()


def test_preserve_removes_runtime_but_keeps_data_and_unknown_files(service):
    binary = create(service.root / 'bin' / 'Print_at_SoC')
    config = create(service.root / 'virtual-printer.json')
    state = create(service.root / 'maintenance.json')
    unrelated = create(service.root / 'my-document.pdf')
    history = create(service._user_data_paths()[0] / 'history' / 'print_jobs.json')
    service.execute(purge=False)
    assert not binary.exists()
    assert all(path.exists() for path in (config, state, unrelated, history))
    service._clear_credentials.assert_not_called()


def test_purge_clears_only_owned_copies_and_scoped_credentials(service):
    create(service.root / 'bin' / 'Print_at_SoC')
    config = create(service.root / 'virtual-printer.json')
    state = create(service.root / 'maintenance.json')
    copy = create(service._user_data_paths()[0] / 'backups' / 'job' / 'original.pdf')
    original = create(service.home / 'Documents' / 'original.pdf')
    other_app = create(service.home / 'Library/Application Support/other.app/settings.json')
    service.execute(purge=True)
    assert all(not path.exists() for path in (config, state, copy))
    assert original.exists() and other_app.exists()
    service._clear_credentials.assert_called_once()


def test_final_symlink_is_unlinked_without_deleting_target(service):
    target = service.home / 'Documents'
    original = create(target / 'important.pdf')
    (service.root / 'bin').symlink_to(target, target_is_directory=True)
    service.execute(purge=False)
    assert original.exists()
    assert not (service.root / 'bin').is_symlink()


def test_ancestor_symlink_is_rejected_before_mutation(service):
    target = service.home / 'Unrelated'
    original = create(target / us.APP_ID / 'history.json')
    (service.home / 'Library').mkdir()
    (service.home / 'Library/Application Support').symlink_to(target, target_is_directory=True)
    with pytest.raises(RuntimeError, match='symlink'):
        service.plan(purge=True)
    assert original.exists()


def test_symlinked_installation_root_is_rejected(service, tmp_path):
    target = tmp_path / 'other'
    target.mkdir()
    service.root.rmdir()
    service.root.symlink_to(target, target_is_directory=True)
    with pytest.raises(RuntimeError, match='symlink'):
        service.plan(purge=False)


def test_locked_credential_store_reports_incomplete_and_keeps_local_config(service):
    config = create(service.root / 'virtual-printer.json')
    binary = create(service.root / 'bin' / 'Print_at_SoC')
    service._clear_credentials.side_effect = RuntimeError('Unlock the login keychain')
    with pytest.raises(RuntimeError, match='Unlock'):
        service.execute(purge=True)
    assert config.exists() and binary.exists()


def test_cleanup_failure_is_not_reported_as_success(service, monkeypatch):
    create(service.root / 'bin' / 'Print_at_SoC')
    monkeypatch.setattr(service, '_remove_path', Mock(side_effect=PermissionError('permission denied')))
    with pytest.raises(PermissionError):
        service.execute(purge=False)


def test_running_desktop_blocks_before_deletion(service, monkeypatch):
    binary = create(service.root / 'bin' / 'Print_at_SoC')
    monkeypatch.setattr(service, '_assert_idle', us.UninstallService._assert_idle.__get__(service))
    monkeypatch.setattr(us.subprocess, 'run', lambda *a, **kw: subprocess.CompletedProcess(a, 0, '/test/Print_at_SoC\n', ''))
    with pytest.raises(RuntimeError, match='running'):
        service.execute(purge=False)
    assert binary.exists()


def test_pending_cups_jobs_are_never_cancelled(service, monkeypatch):
    monkeypatch.setattr(service, '_assert_idle', us.UninstallService._assert_idle.__get__(service))
    monkeypatch.setattr(us.subprocess, 'run', lambda *a, **kw: subprocess.CompletedProcess(a, 0, '', ''))
    execute = Mock(return_value=subprocess.CompletedProcess([], 0, 'PrintAtSoC-1 user 123 bytes\n', ''))
    monkeypatch.setattr(vp, '_run_command', execute)
    with pytest.raises(RuntimeError, match='pending jobs'):
        service._assert_idle([us.RemovalItem('PrintAtSoC', None, 'cups-queue')])
    assert execute.call_args.args[0][1:] == ['-o', 'PrintAtSoC']


def test_noninteractive_administrator_denial_never_prompts(service, monkeypatch):
    monkeypatch.setattr(service, '_cups_inventory', lambda purge: [us.RemovalItem('PrintAtSoC', None, 'cups-queue')])
    monkeypatch.setattr(vp, '_sudo_prefix', lambda: ['sudo', '-n'])
    execute = Mock(return_value=subprocess.CompletedProcess([], 1, '', 'password required'))
    prompt = Mock()
    monkeypatch.setattr(vp, '_run_command', execute)
    monkeypatch.setattr(vp, '_authorize_system_changes', prompt)
    with pytest.raises(RuntimeError, match='Administrator access'):
        service.execute(purge=False, non_interactive=True)
    prompt.assert_not_called()
    assert execute.call_args.args[0] == ['sudo', '-n', '-v']


def test_macos_purge_deletes_exact_service_until_not_found(service, monkeypatch):
    monkeypatch.setattr(service, '_clear_credentials', us.UninstallService._clear_credentials.__get__(service))
    execute = Mock(side_effect=[subprocess.CompletedProcess([], 0), subprocess.CompletedProcess([], 44)])
    monkeypatch.setattr(us.subprocess, 'run', execute)
    service._clear_credentials()
    assert execute.call_count == 2
    assert execute.call_args.args[0] == ['security', 'delete-generic-password', '-s', us.CREDENTIAL_SERVICE]


def test_linux_purge_matches_service_and_never_reads_secrets(service, monkeypatch):
    service.system = 'Linux'
    monkeypatch.setattr(service, '_clear_credentials', us.UninstallService._clear_credentials.__get__(service))
    matched = Mock()
    matched.is_locked.return_value = False
    matched.get_attributes.return_value = {'service': us.CREDENTIAL_SERVICE}
    other = Mock()
    other.is_locked.return_value = False
    other.get_attributes.return_value = {'service': 'other.app'}
    connection = Mock()
    search = Mock(return_value=[matched, other])
    module = SimpleNamespace(dbus_init=lambda: connection, search_items=search)
    monkeypatch.setitem(sys.modules, 'secretstorage', module)
    service._clear_credentials()
    matched.delete.assert_called_once()
    matched.get_secret.assert_not_called()
    other.delete.assert_not_called()
    search.assert_called_once_with(connection, {'service': us.CREDENTIAL_SERVICE})
    connection.close.assert_called_once()


def test_plan_lists_all_owned_queues_without_other_printers(service, monkeypatch, tmp_path):
    monkeypatch.setattr(service, '_cups_inventory', us.UninstallService._cups_inventory.__get__(service))
    monkeypatch.setattr(vp, 'backend_path', lambda: tmp_path / 'system' / 'printatsoc')
    monkeypatch.setattr(vp, 'RUNTIME_DIR', tmp_path / 'system' / 'runtime')
    monkeypatch.setattr(us.shutil, 'which', lambda name: '/usr/bin/' + name)
    monkeypatch.setattr(vp, '_cups_devices', lambda: {'PrintAtSoC': vp.BACKEND_URI, 'Second': vp.BACKEND_URI, 'HP': 'ipp://printer'})
    items = service.plan(purge=False)
    assert [item.label for item in items if item.kind == 'cups-queue'] == ['PrintAtSoC', 'Second']


def test_rejects_home_or_filesystem_root():
    for path in (Path.home(), Path(Path.home().anchor)):
        with pytest.raises(RuntimeError, match='cannot be'):
            us.UninstallService(path)


def test_new_queue_retains_shared_backend_after_preview(service, monkeypatch, tmp_path):
    backend = create(tmp_path / 'system' / 'backend')
    monkeypatch.setattr(service, '_cups_inventory', lambda purge: [us.RemovalItem('backend', backend, 'system-path')])
    monkeypatch.setattr(vp, '_sudo_prefix', lambda: [])
    monkeypatch.setattr(vp, '_cups_devices', lambda: {'new_queue': vp.BACKEND_URI})
    execute = Mock()
    monkeypatch.setattr(vp, '_run_command', execute)
    with pytest.raises(RuntimeError, match='queue remains'):
        service.execute(purge=False)
    execute.assert_not_called()
    assert backend.exists()


def test_native_windows_uninstall_failure_preserves_files(service, monkeypatch):
    service.system = 'Windows'
    binary = create(service.root / 'bin' / 'Print_at_SoC.exe')
    monkeypatch.setattr(service, '_windows_uninstallers', lambda: [['uninstall.exe']])
    monkeypatch.setattr(us.subprocess, 'run', lambda *a, **kw: subprocess.CompletedProcess(a, 1603))
    with pytest.raises(RuntimeError, match='Windows uninstall failed'):
        service.execute(purge=True, non_interactive=True)
    assert binary.exists()
    service._clear_credentials.assert_not_called()


def test_linux_locked_service_does_not_delete_matched_credentials(service, monkeypatch):
    service.system = 'Linux'
    monkeypatch.setattr(service, '_clear_credentials', us.UninstallService._clear_credentials.__get__(service))
    item = Mock()
    item.is_locked.return_value = True
    connection = Mock()
    monkeypatch.setitem(sys.modules, 'secretstorage', SimpleNamespace(dbus_init=lambda: connection, search_items=lambda *a: [item]))
    with pytest.raises(RuntimeError, match='Unlock'):
        service._clear_credentials()
    item.delete.assert_not_called()
    item.get_secret.assert_not_called()
    connection.close.assert_called_once()


def test_failed_first_windows_install_can_be_removed_before_recovery(service, monkeypatch):
    import json
    from print_at_soc import downloader
    from print_at_soc.update_service import UpdateService
    service.system = 'Windows'
    native = SimpleNamespace(installed=True)
    exe = create(service.home / 'native' / 'Print_at_SoC.exe')
    create(service.root / 'bin' / 'partial-installer.exe')
    create(service.root / '.update-stage-test' / 'download.exe')
    (service.root / '.update-backup').mkdir()
    journal = create(service.root / '.update-transaction.json', json.dumps({
        'stage': '.update-stage-test', 'state': 'committing',
        'windows': True, 'had_old': False, 'had_native': False,
    }))
    monkeypatch.setattr(service, '_windows_uninstallers', lambda: [['uninstall.exe']] if native.installed else [])
    monkeypatch.setattr(downloader, '_find_windows_installed_exe', lambda: exe if native.installed else None)
    monkeypatch.setattr(UpdateService, '_ensure_stopped', lambda self: None)
    remove = Mock(side_effect=lambda non_interactive: setattr(native, 'installed', False))
    monkeypatch.setattr(service, '_uninstall_windows', remove)
    service.execute(purge=False, non_interactive=True)
    remove.assert_called_once_with(True)
    assert not journal.exists()
    assert not (service.root / '.update-backup').exists()
    assert not (service.root / 'bin').exists()


def test_existing_windows_install_recovers_before_native_removal(service, monkeypatch):
    import json
    from print_at_soc.update_service import UpdateService
    service.system = 'Windows'
    journal = create(service.root / '.update-transaction.json', json.dumps({
        'stage': '.update-stage-test', 'state': 'committing',
        'windows': True, 'had_old': True, 'had_native': True,
    }))
    events = []
    monkeypatch.setattr(service, '_windows_uninstallers', lambda: [['uninstall.exe']])
    def recover(self):
        events.append('recover')
        journal.unlink()
    monkeypatch.setattr(UpdateService, '_recover_locked', recover)
    monkeypatch.setattr(service, '_uninstall_windows', lambda non_interactive: events.append('uninstall'))
    service.execute(purge=False, non_interactive=True)
    assert events == ['recover', 'uninstall']


def test_native_first_install_removal_failure_preserves_transaction(service, monkeypatch):
    import json
    service.system = 'Windows'
    journal = create(service.root / '.update-transaction.json', json.dumps({
        'stage': '.update-stage-test', 'state': 'committing',
        'windows': True, 'had_old': False, 'had_native': False,
    }))
    artifact = create(service.root / '.update-stage-test' / 'download.exe')
    config = create(service.root / 'virtual-printer.json')
    monkeypatch.setattr(service, '_windows_uninstallers', lambda: [['uninstall.exe']])
    monkeypatch.setattr(service, '_uninstall_windows', Mock(side_effect=RuntimeError('native removal denied')))
    with pytest.raises(RuntimeError, match='denied'):
        service.execute(purge=True, non_interactive=True)
    assert journal.exists() and artifact.exists() and config.exists()
    service._clear_credentials.assert_not_called()


@pytest.mark.parametrize('purge', [False, True])
def test_windows_reinstall_registration_marker_is_runtime_state(service, monkeypatch, purge):
    service.system = 'Windows'
    marker = create(service.root / 'win_postinstall_done')
    monkeypatch.setattr(service, '_windows_uninstallers', lambda: [['uninstall.exe']])
    monkeypatch.setattr(service, '_uninstall_windows', Mock())
    assert marker in [item.path for item in service.plan(purge=purge)]
    service.execute(purge=purge, non_interactive=True)
    assert not marker.exists()


def test_shared_account_is_kept_or_purged_and_relay_is_always_stopped(service, monkeypatch):
    from print_at_soc import native_driver
    account = create(service.home / '.PrintAtSoC/account.json', '{}')
    agent = create(native_driver.service_path(service.home, service.system), 'test fixture')
    stop = Mock()
    monkeypatch.setattr(native_driver, 'stop_service', stop)
    retained = service.plan(purge=False)
    assert any(item.kind == 'relay' and item.path == agent for item in retained)
    assert account not in [item.path for item in retained]
    service.execute(purge=False)
    stop.assert_called_once_with(service.home, service.system)
    assert account.exists()
    assert account in [item.path for item in service.plan(purge=True)]
    service.execute(purge=True)
    assert not account.exists()
