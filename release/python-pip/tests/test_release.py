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


@pytest.mark.parametrize('suffix', ['.exe', '.msi'])
def test_windows_selected_asset_is_installed(monkeypatch, tmp_path, suffix):
    monkeypatch.setattr(downloader, 'BINARY_DIR', tmp_path)
    monkeypatch.setattr(downloader, 'VERSION_FILE', tmp_path / 'version.txt')
    monkeypatch.setattr(downloader, 'ensure_dirs', lambda: None)
    monkeypatch.setattr(downloader, 'get_platform_key', lambda: 'windows_x86_64')
    monkeypatch.setattr(downloader.platform, 'system', lambda: 'Windows')
    installed = Mock(side_effect=[False, True])
    monkeypatch.setattr(downloader, 'is_installed', installed)
    asset = 'Print_at_SoC_windows_x86_64' + suffix
    monkeypatch.setattr(downloader, 'get_download_url', lambda: ('https://example.org/' + asset, 'v0.1.0'))
    monkeypatch.setattr(downloader, 'download_with_progress', lambda url, path: path.write_bytes(b'installer'))
    installer = Mock()
    monkeypatch.setattr(downloader, '_run_nsis_installer' if suffix == '.exe' else '_install_msi', installer)
    downloader.download_and_install()
    installer.assert_called_once_with(tmp_path / asset)
    assert (tmp_path / 'version.txt').read_text() == 'v0.1.0'


def test_failed_install_does_not_record_success(monkeypatch, tmp_path):
    monkeypatch.setattr(downloader, 'BINARY_DIR', tmp_path)
    monkeypatch.setattr(downloader, 'VERSION_FILE', tmp_path / 'version.txt')
    monkeypatch.setattr(downloader, 'ensure_dirs', lambda: None)
    monkeypatch.setattr(downloader, 'get_platform_key', lambda: 'windows_x86_64')
    monkeypatch.setattr(downloader.platform, 'system', lambda: 'Windows')
    monkeypatch.setattr(downloader, 'is_installed', lambda: False)
    monkeypatch.setattr(downloader, 'get_download_url', lambda: ('https://example.org/setup.exe', 'v0.1.0'))
    monkeypatch.setattr(downloader, 'download_with_progress', lambda url, path: path.write_bytes(b''))
    monkeypatch.setattr(downloader, '_run_nsis_installer', lambda path: None)
    with pytest.raises(RuntimeError, match='usable desktop executable'):
        downloader.download_and_install()
    assert not (tmp_path / 'version.txt').exists()


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
