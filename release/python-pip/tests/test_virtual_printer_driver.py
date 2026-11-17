import copy
from unittest.mock import Mock
import pytest
from print_at_soc import virtual_printer as vp

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


def test_scaling_failure_does_not_submit_original(monkeypatch, tmp_path):
    document = tmp_path / 'job.pdf'
    document.write_bytes(b'%PDF-1.4')
    config = copy.deepcopy(vp.DEFAULT_CONFIG)
    config['ssh']['username'] = 'student'
    monkeypatch.setattr(vp, '_system_upload', Mock())
    commands = []
    def execute(config, command):
        commands.append(command)
        if command.startswith('gs '):
            assert '|| cp' not in command
            raise RuntimeError('conversion failed')
    monkeypatch.setattr(vp, '_system_exec', execute)
    with pytest.raises(RuntimeError, match='conversion failed'):
        vp.submit_file_print_job(str(document), config=config)
    assert not any(command.startswith('lpr ') for command in commands)
    assert commands[-1].startswith('rm -f ')


def test_user_config_is_private_and_atomic(monkeypatch, tmp_path):
    path = tmp_path / 'config.json'
    path.write_text('{}')
    path.chmod(0o644)
    monkeypatch.setattr(vp, 'user_config_path', lambda: path)
    vp._write_config({'ssh': {'password': 'secret'}})
    assert path.stat().st_mode & 0o777 == 0o600
    assert len(list(tmp_path.iterdir())) == 1
