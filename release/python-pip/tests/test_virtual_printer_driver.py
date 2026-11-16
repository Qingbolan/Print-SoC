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
    monkeypatch.setattr(vp, '_install_runtime', lambda **kw: '#!/bin/sh')
    monkeypatch.setattr(vp, '_write_backend_config', Mock())
    monkeypatch.setattr(vp, '_write_config', Mock())
    monkeypatch.setattr(vp, '_cups_devices', lambda: {vp.PRINTER_NAME: vp.BACKEND_URI})
    commands = []
    def execute(command, **kwargs):
        commands.append(command)
        return subprocess.CompletedProcess(command, 0, '', '')
    monkeypatch.setattr(vp, '_run_command', execute)
    assert vp.install_virtual_printer(['--username', 'student', '--password', 'test-password']) == 0
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
    assert vp.install_virtual_printer(['--non-interactive']) == 1
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


def test_explicit_config_installs_forwarding_settings(monkeypatch, tmp_path):
    import json
    config = copy.deepcopy(vp.DEFAULT_CONFIG)
    config['ssh'].update(username='student', password='secret')
    monkeypatch.setattr(vp, 'find_cups_backend_dir', lambda: tmp_path / 'backend')
    path = tmp_path / 'settings.json'
    path.write_text(json.dumps(config))
    monkeypatch.setattr(vp, 'SYSTEM_CONFIG_PATH', tmp_path / 'system.json')
    monkeypatch.setattr(vp, 'user_config_path', lambda: tmp_path / 'user.json')
    monkeypatch.setattr(vp, '_cups_devices', lambda: {vp.PRINTER_NAME: vp.BACKEND_URI})
    monkeypatch.setattr(vp, '_authorize_system_changes', Mock())
    monkeypatch.setattr(vp, '_install_runtime', lambda **kw: '#!/bin/sh')
    monkeypatch.setattr(vp, '_install_file', Mock())
    monkeypatch.setattr(vp, '_write_config', Mock())
    write = Mock()
    monkeypatch.setattr(vp, '_write_backend_config', write)
    monkeypatch.setattr(vp.shutil, 'which', lambda name: '/usr/sbin/' + name)
    monkeypatch.setattr(vp, '_run_command', lambda *a, **kw: subprocess.CompletedProcess(a, 0, '', ''))
    assert vp.install_virtual_printer(['--config', str(path)]) == 0
    assert write.call_args.args[0]['ssh']['username'] == 'student'


def test_invalid_config_cannot_mutate_system(monkeypatch, tmp_path):
    monkeypatch.setattr(vp.shutil, 'which', lambda name: '/usr/sbin/' + name)
    monkeypatch.setattr(vp, '_cups_devices', lambda: {vp.PRINTER_NAME: vp.BACKEND_URI})
    monkeypatch.setattr(vp, 'load_config', lambda **kw: copy.deepcopy(vp.DEFAULT_CONFIG))
    authorize = Mock()
    monkeypatch.setattr(vp, '_authorize_system_changes', authorize)
    assert vp.install_virtual_printer(['--non-interactive']) == 1
    authorize.assert_not_called()


def test_backend_uses_system_config_not_login_home(monkeypatch, tmp_path):
    import json
    path = tmp_path / 'system.json'
    config = copy.deepcopy(vp.DEFAULT_CONFIG)
    config['ssh']['username'] = 'service-user'
    path.write_text(json.dumps(config))
    monkeypatch.setattr(vp, 'SYSTEM_CONFIG_PATH', path)
    monkeypatch.setattr(vp, 'load_config', Mock(side_effect=AssertionError('must not load user home')))
    submit = Mock(return_value='submitted')
    monkeypatch.setattr(vp, 'submit_file_print_job', submit)
    assert vp.backend_main(['1', 'local-user', 'title', '2', 'PageSize=A3', '/spool/file']) == 0
    assert submit.call_args.kwargs['config']['ssh']['username'] == 'service-user'
    assert submit.call_args.kwargs['copies'] == 2


def test_uninstall_preserves_other_queues(monkeypatch):
    monkeypatch.setattr(vp, '_cups_devices', lambda: {'PrintAtSoC': vp.BACKEND_URI, 'OtherSoC': vp.BACKEND_URI})
    monkeypatch.setattr(vp, '_authorize_system_changes', Mock())
    monkeypatch.setattr(vp, '_sudo_prefix', lambda: [])
    monkeypatch.setattr(vp.shutil, 'which', lambda name: name)
    execute = Mock()
    monkeypatch.setattr(vp, '_run_command', execute)
    assert vp.uninstall_virtual_printer([]) == 0
    assert execute.call_args_list == [((['lpadmin', '-x', 'PrintAtSoC'],), {'dry_run': False})]


def test_uninstall_refuses_foreign_queue(monkeypatch):
    monkeypatch.setattr(vp, '_cups_devices', lambda: {'PrintAtSoC': 'ipp://other/printer'})
    with pytest.raises(RuntimeError, match='not a Print@SoC'):
        vp.uninstall_virtual_printer([])


def test_runtime_imports_without_user_site(tmp_path):
    import os
    from print_at_soc.cups_runtime import CupsRuntime
    runtime = CupsRuntime()
    runtime.stage(tmp_path)
    environment = dict(os.environ, PYTHONPATH=str(tmp_path), PYTHONNOUSERSITE='1')
    result = subprocess.run([str(runtime.python), '-S', '-c',
                            'import paramiko; import print_at_soc.virtual_printer'],
                            env=environment, cwd='/', capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    assert str(tmp_path) in runtime.wrapper(tmp_path)
    assert '${PYTHONPATH' not in runtime.wrapper(tmp_path)
    wrapper = tmp_path / 'backend'
    wrapper.write_text(runtime.wrapper(tmp_path))
    result = subprocess.run(['/bin/sh', str(wrapper)], env=environment,
                            cwd='/', capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    assert 'printatsoc://default' in result.stdout


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


def test_administrator_denial_is_reported(monkeypatch):
    monkeypatch.setattr(vp, '_sudo_prefix', lambda: ['sudo', '-n'])
    execute = Mock(return_value=subprocess.CompletedProcess(['sudo', '-v'], 1))
    monkeypatch.setattr(vp.subprocess, 'run', execute)
    with pytest.raises(RuntimeError, match='Administrator authentication failed'):
        vp._authorize_system_changes()
    execute.assert_called_once_with(['sudo', '-v'], check=False)


def test_dry_run_does_not_request_administrator_credentials(monkeypatch):
    execute = Mock()
    monkeypatch.setattr(vp.subprocess, 'run', execute)
    vp._authorize_system_changes(dry_run=True)
    execute.assert_not_called()


def test_key_configuration_is_copied_for_cups(monkeypatch, tmp_path):
    key = tmp_path / 'private-key'
    key.write_text('test key material')
    config = copy.deepcopy(vp.DEFAULT_CONFIG)
    config['ssh'].update(username='student', key_path=str(key))
    monkeypatch.setattr(vp, 'SYSTEM_CONFIG_DIR', tmp_path / 'system')
    monkeypatch.setattr(vp, '_run_command', Mock())
    install = Mock()
    write = Mock()
    monkeypatch.setattr(vp, '_install_file', install)
    monkeypatch.setattr(vp, '_write_config', write)
    vp._write_backend_config(config)
    assert config['ssh']['key_path'] == str(key)
    assert write.call_args.args[0]['ssh']['key_path'] == str(tmp_path / 'system' / 'ssh_key')
    assert install.call_args_list[0].kwargs['mode'] == '0600'


def test_user_config_is_private_and_atomic(monkeypatch, tmp_path):
    path = tmp_path / 'config.json'
    path.write_text('{}')
    path.chmod(0o644)
    monkeypatch.setattr(vp, 'user_config_path', lambda: path)
    vp._write_config({'ssh': {'password': 'secret'}})
    assert path.stat().st_mode & 0o777 == 0o600
    assert len(list(tmp_path.iterdir())) == 1


def test_cups_requires_credentials_independent_of_login_session():
    config = copy.deepcopy(vp.DEFAULT_CONFIG)
    config['ssh']['username'] = 'student'
    with pytest.raises(RuntimeError, match='login SSH agent'):
        vp._validate_backend_config(config)
