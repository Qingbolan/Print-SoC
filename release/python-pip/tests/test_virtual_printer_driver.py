import copy
import subprocess
from unittest.mock import Mock

import pytest

from print_at_soc import virtual_printer as vp


@pytest.mark.parametrize('system', ['Darwin', 'Linux'])
def test_install_registers_packaged_pdf_driver(monkeypatch, tmp_path, system):
    monkeypatch.setattr(vp.platform, 'system', lambda: system)
    monkeypatch.setattr(vp.shutil, 'which', lambda name: '/usr/sbin/' + name)
    monkeypatch.setattr(vp, 'find_cups_backend_dir', lambda: tmp_path)
    monkeypatch.setattr(vp, '_sudo_prefix', lambda: [])
    monkeypatch.setattr(vp, '_install_file', Mock())
    commands = []
    def execute(command, **kwargs):
        commands.append(command)
        return subprocess.CompletedProcess(command, 0, '', '')
    monkeypatch.setattr(vp, '_run_command', execute)
    assert vp.install_virtual_printer([]) == 0
    command = next(c for c in commands if c[0].endswith('/lpadmin'))
    assert command[command.index('-P') + 1] == str(vp.PDF_DRIVER_PATH)
    assert '-m' not in command
    assert 'raw' not in command
    assert vp.PDF_DRIVER_PATH.is_file()


def test_missing_driver_fails_before_installing_backend(monkeypatch, tmp_path):
    monkeypatch.setattr(vp.platform, 'system', lambda: 'Darwin')
    monkeypatch.setattr(vp.shutil, 'which', lambda name: '/usr/sbin/' + name)
    monkeypatch.setattr(vp, 'PDF_DRIVER_PATH', tmp_path / 'missing.ppd')
    install = Mock()
    monkeypatch.setattr(vp, '_install_file', install)
    with pytest.raises(RuntimeError, match='PDF driver is missing'):
        vp.install_virtual_printer([])
    install.assert_not_called()


def test_ppd_options_reach_remote_submission(monkeypatch, tmp_path):
    document = tmp_path / 'assignment.pdf'
    document.write_bytes(b'%PDF-1.4')
    config = copy.deepcopy(vp.DEFAULT_CONFIG)
    config['ssh']['username'] = 'student'
    monkeypatch.setattr(vp, '_system_upload', Mock())
    execute = Mock(return_value='submitted')
    monkeypatch.setattr(vp, '_system_exec', execute)
    vp.submit_file_print_job(str(document), config=config, cups_options='PageSize=A3 Duplex=None')
    commands = [c.args[1] for c in execute.call_args_list]
    assert '-dDEVICEWIDTHPOINTS=842' in commands[0]
    assert '-dDEVICEHEIGHTPOINTS=1191' in commands[0]
    assert 'lpr -P psts-sx ' in commands[1]


def test_ppd_duplex_values_are_normalized():
    assert vp._normalize_duplex('DuplexNoTumble') == 'duplex-long-edge'
    assert vp._normalize_duplex('DuplexTumble') == 'duplex-short-edge'
    assert vp._normalize_duplex('None') == 'simplex'
