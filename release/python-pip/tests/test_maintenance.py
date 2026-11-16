"""Maintenance command policy and presentation without network/system mutation."""
import io
import json
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from print_at_soc import maintenance as m
from print_at_soc import update_service as updates
from print_at_soc import uninstall_service as uninstall


@pytest.fixture
def services(monkeypatch, tmp_path):
    update = Mock()
    update.installed_version.return_value = '0.300.0'
    update.latest.return_value = updates.Release('0.301.0', 'https://github.com/test', 'test.AppImage', 20, 'sha256:' + 'a' * 64)
    remove = Mock()
    remove.plan.return_value = [uninstall.RemovalItem('Desktop', tmp_path / 'bin', 'path')]
    monkeypatch.setattr(updates, 'UpdateService', lambda *a, **k: update)
    monkeypatch.setattr(uninstall, 'UninstallService', lambda *a, **k: remove)
    monkeypatch.setattr(m.platform, 'system', lambda: 'Linux')
    monkeypatch.setattr(m.sys, 'stdin', io.StringIO(''))
    monkeypatch.delenv('PSOC_PACKAGE_MANAGER', raising=False)
    monkeypatch.delenv('PSOC_REMOVE_CLI', raising=False)
    monkeypatch.delenv('PSOC_MAINTENANCE_RESULT', raising=False)
    settings = {'mode': 'notify', 'last_checked': 0}
    monkeypatch.setattr(m, 'read_settings', lambda *a: settings.copy())
    write = Mock(side_effect=lambda value, *a: settings.update(value))
    monkeypatch.setattr(m, 'write_settings', write)
    return SimpleNamespace(update=update, remove=remove, settings=settings, write=write)


def test_check_is_read_only(services):
    assert m.maintenance_cli(['update', '--check', '--plain']) == 0
    services.update.update.assert_not_called()
    services.write.assert_not_called()


def test_noninteractive_update_requires_explicit_acceptance(services):
    assert m.maintenance_cli(['update', '--non-interactive']) == 1
    services.update.update.assert_not_called()
    assert m.maintenance_cli(['update', '--non-interactive', '--yes']) == 0
    services.update.update.assert_called_once()


def test_current_version_does_not_reinstall_without_force(services):
    services.update.installed_version.return_value = '0.301.0'
    assert m.maintenance_cli(['update', '--yes']) == 0
    services.update.update.assert_not_called()
    assert m.maintenance_cli(['update', '--force', '--yes']) == 0
    services.update.update.assert_called_once()


def test_downgrade_refused_even_with_force(services):
    services.update.installed_version.return_value = '0.400.0'
    assert m.maintenance_cli(['update', '--force', '--yes']) == 1
    services.update.update.assert_not_called()


def test_rollback_disables_automatic_reapply_before_restoring(services):
    services.update.rollback.side_effect = lambda: services.settings['mode'] == 'off' or pytest.fail('auto must be off')
    assert m.maintenance_cli(['update', '--rollback', '--yes']) == 0
    services.update.rollback.assert_called_once()


def test_uninstall_preview_never_removes_anything_or_writes_receipt(services, monkeypatch, tmp_path):
    result = tmp_path / 'result.json'
    monkeypatch.setenv('PSOC_MAINTENANCE_RESULT', str(result))
    pip = Mock()
    monkeypatch.setattr(m.subprocess, 'run', pip)
    assert m.maintenance_cli(['uninstall', '--purge', '--remove-cli', '--dry-run']) == 0
    services.remove.execute.assert_not_called()
    pip.assert_not_called()
    assert not result.exists()


def test_uninstall_script_requires_yes(services):
    assert m.maintenance_cli(['uninstall', '--purge', '--non-interactive']) == 1
    services.remove.execute.assert_not_called()


def test_uninstall_modes_and_success_receipt(services, monkeypatch, tmp_path):
    result = tmp_path / 'result.json'
    monkeypatch.setenv('PSOC_MAINTENANCE_RESULT', str(result))
    assert m.maintenance_cli(['uninstall', '--keep-data', '--yes']) == 0
    services.remove.execute.assert_called_once_with(purge=False, non_interactive=True)
    assert json.loads(result.read_text()) == {'status': 'uninstalled', 'purge': False}


def test_failed_cleanup_cannot_remove_cli_or_signal_success(services, monkeypatch, tmp_path):
    result = tmp_path / 'result.json'
    monkeypatch.setenv('PSOC_MAINTENANCE_RESULT', str(result))
    services.remove.execute.side_effect = RuntimeError('keychain locked')
    execute = Mock()
    monkeypatch.setattr(m.subprocess, 'run', execute)
    assert m.maintenance_cli(['uninstall', '--purge', '--remove-cli', '--yes']) == 1
    execute.assert_not_called()
    assert not result.exists()


def test_remove_python_cli_uses_current_interpreter_after_cleanup(services, monkeypatch):
    def execute(command, **kwargs):
        services.remove.execute.assert_called_once()
        assert command == [sys.executable, '-m', 'pip', 'uninstall', '-y', 'print-at-soc']
        return SimpleNamespace(returncode=0)
    monkeypatch.setattr(m.subprocess, 'run', execute)
    assert m.maintenance_cli(['uninstall', '--purge', '--remove-cli', '--yes']) == 0


def test_npm_bridge_never_removes_python_cli(services, monkeypatch):
    monkeypatch.setenv('PSOC_PACKAGE_MANAGER', 'npm')
    monkeypatch.setenv('PSOC_REMOVE_CLI', '1')
    pip = Mock()
    monkeypatch.setattr(m.subprocess, 'run', pip)
    assert m.maintenance_cli(['uninstall', '--purge', '--yes']) == 0
    pip.assert_not_called()


def test_notify_mode_checks_without_installing_and_throttles(services, capsys):
    m.maybe_auto_update()
    services.update.latest.assert_called_once_with(timeout=3)
    services.update.update.assert_not_called()
    assert 'available' in capsys.readouterr().err
    m.maybe_auto_update()
    assert services.update.latest.call_count == 1


def test_apply_mode_failure_never_blocks_launch(services, capsys):
    services.settings['mode'] = 'apply'
    services.update.update.side_effect = RuntimeError('hash mismatch')
    m.maybe_auto_update()
    assert 'deferred' in capsys.readouterr().err


def test_disabled_mode_does_not_touch_network(services):
    services.settings['mode'] = 'off'
    m.maybe_auto_update()
    services.update.latest.assert_not_called()


def test_windows_automatic_apply_not_silently_interactive(services, monkeypatch):
    monkeypatch.setattr(m.platform, 'system', lambda: 'Windows')
    assert m.maintenance_cli(['update', '--auto', 'apply']) == 1
    services.settings['mode'] = 'apply'
    m.maybe_auto_update()
    services.update.update.assert_not_called()


def test_cancellation_has_130_and_no_success(services):
    services.update.latest.side_effect = KeyboardInterrupt()
    assert m.maintenance_cli(['update', '--check']) == 130
    services.update.update.assert_not_called()


@pytest.mark.parametrize('prefix', [['self', 'update'], ['self', 'install'], ['--install']])
def test_update_aliases_preserve_automation_flags(services, monkeypatch, prefix):
    from print_at_soc import cli
    monkeypatch.setattr(cli.sys, 'argv', ['print-soc'] + prefix + ['--yes', '--non-interactive', '--plain'])
    assert cli.main() == 0
    services.update.update.assert_called_once()


def test_settings_are_private_atomic_and_symlinks_rejected(tmp_path):
    m.write_settings({'mode': 'off', 'last_checked': 1}, tmp_path)
    path = tmp_path / 'maintenance.json'
    assert path.stat().st_mode & 0o777 == 0o600
    assert m.read_settings(tmp_path)['mode'] == 'off'
    other = tmp_path / 'unrelated.json'
    other.write_text('keep me')
    path.unlink()
    path.symlink_to(other)
    with pytest.raises(RuntimeError, match='symbolic link'):
        m.write_settings({'mode': 'apply'}, tmp_path)
    assert other.read_text() == 'keep me'


def test_automatic_update_interrupt_stops_launch_without_traceback(services, capsys):
    services.settings['mode'] = 'apply'
    services.update.update.side_effect = KeyboardInterrupt()
    assert m.maybe_auto_update() == 130
    assert 'launch cancelled' in capsys.readouterr().err
