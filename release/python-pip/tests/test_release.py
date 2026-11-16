"""Regression checks for installation and non-interactive CLI workflows."""
import copy
from pathlib import Path
from unittest.mock import Mock

import pytest

from print_at_soc import cli, downloader, virtual_printer as vp


@pytest.mark.parametrize('system', ['Darwin', 'Windows', 'Linux'])
def test_doctor_never_installs_or_launches(monkeypatch, system):
    monkeypatch.setattr(cli.sys, 'argv', ['print-soc', '--doctor'])
    monkeypatch.setattr(cli.platform, 'system', lambda: system)
    monkeypatch.setattr(cli, '_windows_setup_shortcuts', lambda **kw: None)
    monkeypatch.setattr(cli, '_linux_runtime_check', lambda: ([], False))
    install = Mock(side_effect=AssertionError('doctor must not install'))
    monkeypatch.setattr(cli, 'check_and_install', install)
    assert cli.main() == 0
    install.assert_not_called()


@pytest.mark.parametrize('code', [0, 1, 130])
def test_legacy_installer_uses_shared_maintenance_transaction(monkeypatch, code):
    from print_at_soc import maintenance
    install = Mock(return_value=code)
    monkeypatch.setattr(maintenance, 'maintenance_cli', install)
    if code:
        with pytest.raises(RuntimeError, match='did not complete'):
            downloader.download_and_install()
    else:
        downloader.download_and_install()
    install.assert_called_once_with(['update', '--force'])


def test_encrypted_key_uses_paramiko():
    assert vp._needs_paramiko({'key_path': '/key', 'key_passphrase': 'passphrase'})


def test_failed_print_cleans_remote_files(monkeypatch, tmp_path):
    document = tmp_path / 'assignment.pdf'
    document.write_bytes(b'%PDF-1.4')
    config = copy.deepcopy(vp.DEFAULT_CONFIG)
    config['ssh'].update(username='student', password='password')
    client = Mock()
    monkeypatch.setattr(vp, '_connect_paramiko', lambda cfg: client)
    commands = []
    def execute(client, command):
        commands.append(command)
        if command.startswith('lpr '):
            raise RuntimeError('queue unavailable')
        return ''
    monkeypatch.setattr(vp, '_paramiko_exec', execute)
    with pytest.raises(RuntimeError, match='queue unavailable'):
        vp.submit_file_print_job(str(document), config=config)
    assert commands[-1].startswith('rm -f ')
    client.close.assert_called_once()


def test_mcp_missing_binary_keeps_stdout_clean(monkeypatch, capsys):
    monkeypatch.setattr(cli.sys, 'argv', ['psoc', 'mcp'])
    monkeypatch.setattr(cli, 'is_installed', lambda: False)
    assert cli.main() == 1
    output = capsys.readouterr()
    assert output.out == ''
    assert 'not installed' in output.err
