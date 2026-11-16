"""Installation lifecycle regressions; never alter the host CUPS service."""
from argparse import Namespace
from contextlib import contextmanager
import copy
import subprocess
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from print_at_soc import virtual_printer as vp
from print_at_soc.printer_installation import InstallationState, PrinterInstallation


class FakeUI:
    def __init__(self, *, interactive=False, confirm=True):
        self.interactive = interactive
        self.answer = confirm
        self.events = []
        self.failures = []
        self.completed = []
        self.cancelled_calls = []
        self.interrupt = None

    def intro(self):
        self.events.append(('intro',))

    def note(self, text):
        self.events.append(('note', text))

    def ask_text(self, label, default='', secret=False, validate=None):
        if self.interrupt:
            raise self.interrupt()
        assert self.interactive, 'headless install attempted an interactive question'
        return 'test-password' if secret else str(default or 'student')

    def choose(self, label, choices, default=None):
        assert self.interactive, 'headless install attempted a selection'
        values = [value for _label, value in choices]
        return default if default in values else values[0]

    def confirm(self, label, default=False):
        assert self.interactive, 'headless install attempted confirmation'
        return self.answer

    def summary(self, rows):
        self.events.append(('summary', rows))

    @contextmanager
    def stage(self, label, index, total, animate=True):
        self.events.append(('stage', label))
        yield

    def finish(self, name, display_name, dry_run=False):
        self.completed.append((name, display_name, dry_run))

    def failure(self, stage, detail, commands, changed=False):
        self.failures.append((str(stage), detail, commands, changed))

    def cancelled(self, changed=False):
        self.cancelled_calls.append(changed)


def arguments(**overrides):
    values = dict(
        config=None, server=None, host=None, port=None, username=None,
        password=None, ask_password=False, password_stdin=False,
        key_path=None, key_passphrase=None, printer=None, duplex=None,
        paper_size=None, no_scale=False, name=vp.PRINTER_NAME,
        display_name=vp.DISPLAY_NAME, location=vp.LOCATION,
        system_config=False, dry_run=False, non_interactive=True,
        yes=True, plain=True,
    )
    values.update(overrides)
    return Namespace(**values)


@pytest.fixture
def installation(monkeypatch, tmp_path):
    config = copy.deepcopy(vp.DEFAULT_CONFIG)
    config['ssh'].update(username='student', password='private-test-password')
    state = SimpleNamespace(config=config, calls=[], fault=None, build_config=vp._build_config_from_args)
    monkeypatch.setattr(vp.platform, 'system', lambda: 'Darwin')
    monkeypatch.setattr(vp.shutil, 'which', lambda name: '/usr/sbin/' + name)
    monkeypatch.setattr(vp, 'find_cups_backend_dir', lambda: tmp_path / 'backend')
    monkeypatch.setattr(vp, '_cups_devices', lambda: {vp.PRINTER_NAME: vp.BACKEND_URI})
    monkeypatch.setattr(vp, '_build_config_from_args', lambda args: copy.deepcopy(state.config))
    monkeypatch.setattr(vp, '_sudo_prefix', lambda: [])
    state.authorize = Mock()
    state.runtime = Mock(return_value='#!/bin/sh\n')
    state.backend_config = Mock()
    state.user_config = Mock()
    state.install_file = Mock()
    monkeypatch.setattr(vp, '_authorize_system_changes', state.authorize)
    monkeypatch.setattr(vp, '_install_runtime', state.runtime)
    monkeypatch.setattr(vp, '_write_backend_config', state.backend_config)
    monkeypatch.setattr(vp, '_write_config', state.user_config)
    monkeypatch.setattr(vp, '_install_file', state.install_file)

    def execute(command, *, dry_run=False, check=True):
        state.calls.append((command, dry_run))
        failed = state.fault is not None and state.fault(command)
        result = subprocess.CompletedProcess(command, 1 if failed else 0,
                                             '', 'injected command failure' if failed else '')
        if failed and check:
            raise RuntimeError(result.stderr)
        return result

    monkeypatch.setattr(vp, '_run_command', execute)
    return state


def assert_no_mutation(installation):
    installation.runtime.assert_not_called()
    installation.backend_config.assert_not_called()
    installation.user_config.assert_not_called()
    installation.install_file.assert_not_called()
    assert not any('lpadmin' in command[0] for command, _dry in installation.calls)


def test_complete_install_has_verified_terminal_state(installation):
    ui = FakeUI()
    wizard = PrinterInstallation(arguments(), ui)
    assert wizard.run() == 0
    assert wizard.state is InstallationState.COMPLETE
    assert len(ui.completed) == 1
    assert not ui.failures
    assert any('lpadmin' in command[0] for command, _dry in installation.calls)


def test_declining_review_leaves_system_untouched(installation):
    ui = FakeUI(interactive=True, confirm=False)
    wizard = PrinterInstallation(arguments(non_interactive=False, yes=False), ui)
    assert wizard.run() == 0
    assert wizard.state is InstallationState.CANCELLED
    assert_no_mutation(installation)
    installation.authorize.assert_not_called()
    assert not ui.completed


@pytest.mark.parametrize('exception', [KeyboardInterrupt, EOFError])
def test_interrupted_configuration_is_clean_cancellation(installation, exception):
    ui = FakeUI(interactive=True)
    ui.interrupt = exception
    wizard = PrinterInstallation(arguments(non_interactive=False, yes=False), ui)
    assert wizard.run() == 130
    assert wizard.state is InstallationState.CANCELLED
    assert_no_mutation(installation)
    assert not ui.failures


def test_missing_headless_credentials_report_failure_without_prompt(installation):
    installation.config['ssh'].update(username='', password='', key_path='')
    ui = FakeUI()
    wizard = PrinterInstallation(arguments(), ui)
    assert wizard.run() == 1
    assert wizard.state is InstallationState.FAILED
    assert_no_mutation(installation)
    installation.authorize.assert_not_called()
    assert ui.failures
    assert not ui.completed


def test_preflight_failure_has_recovery_without_mutation(installation, monkeypatch):
    monkeypatch.setattr(vp.shutil, 'which', lambda name: None)
    ui = FakeUI()
    wizard = PrinterInstallation(arguments(), ui)
    assert wizard.run() == 1
    assert_no_mutation(installation)
    assert ui.failures
    assert ui.failures[0][0] == InstallationState.PREFLIGHT.value
    assert ui.failures[0][2], 'preflight failure needs at least one repair command'


def test_noninteractive_sudo_failure_never_requests_a_password(installation, monkeypatch):
    monkeypatch.setattr(vp, '_sudo_prefix', lambda: ['sudo', '-n'])
    installation.fault = lambda command: command == ['sudo', '-n', '-v']
    ui = FakeUI()
    wizard = PrinterInstallation(arguments(), ui)
    assert wizard.run() == 1
    assert (['sudo', '-n', '-v'], False) in installation.calls
    installation.authorize.assert_not_called()
    assert_no_mutation(installation)
    assert ui.failures[0][0] == InstallationState.AUTHORIZE.value


@pytest.mark.parametrize('tool, expected_stage', [('lpadmin', InstallationState.REGISTER), ('cupsenable', InstallationState.ENABLE)])
def test_queue_mutation_failure_cannot_report_success(installation, tool, expected_stage):
    installation.fault = lambda command: any(part.endswith('/' + tool) for part in command)
    ui = FakeUI()
    wizard = PrinterInstallation(arguments(), ui)
    assert wizard.run() == 1
    assert wizard.state is InstallationState.FAILED
    assert not ui.completed
    assert ui.failures[0][0] == expected_stage.value
    assert ui.failures[0][3] is True
    assert ui.failures[0][2], 'partial install needs actionable recovery commands'


def test_registration_must_be_verified_after_mutation(installation, monkeypatch):
    monkeypatch.setattr(vp, '_cups_devices', lambda: {})
    ui = FakeUI()
    wizard = PrinterInstallation(arguments(), ui)
    assert wizard.run() == 1
    assert not ui.completed
    assert 'verif' in ui.failures[0][0].lower()


def test_failure_diagnostics_redact_password_and_passphrase(installation):
    password = installation.config['ssh']['password']
    passphrase = 'private-key-passphrase'
    installation.config['ssh']['key_passphrase'] = passphrase
    installation.runtime.side_effect = RuntimeError(f'failure containing {password} and {passphrase}')
    ui = FakeUI()
    wizard = PrinterInstallation(arguments(), ui)
    assert wizard.run() == 1
    displayed = repr(ui.failures) + repr(ui.events)
    assert password not in displayed
    assert passphrase not in displayed


def test_dry_run_never_authorizes_or_executes_mutating_commands(installation):
    ui = FakeUI()
    wizard = PrinterInstallation(arguments(dry_run=True), ui)
    assert wizard.run() == 0
    assert ui.completed[0][2] is True
    installation.authorize.assert_not_called()
    for call in installation.runtime.call_args_list:
        assert call.kwargs['dry_run'] is True
    for spy in (installation.backend_config, installation.user_config, installation.install_file):
        for call in spy.call_args_list:
            assert call.kwargs['dry_run'] is True
    assert all(dry_run for command, dry_run in installation.calls
               if command[0].endswith(('lpadmin', 'cupsaccept', 'cupsenable', 'mkdir')))


@pytest.mark.parametrize('prefix', [['virtual-printer', 'install'], ['--install-virtual-printer']])
def test_both_cli_spellings_forward_wizard_flags_and_exit_status(monkeypatch, prefix):
    from print_at_soc import cli
    options = ['--non-interactive', '--yes', '--plain', '--username', 'student']
    handler = Mock(return_value=130)
    monkeypatch.setattr(vp, 'install_virtual_printer', handler)
    monkeypatch.setattr(cli.sys, 'argv', ['print-soc'] + prefix + options)
    assert cli.main() == 130
    handler.assert_called_once_with(options)


@pytest.fixture
def cli_ui(monkeypatch):
    from print_at_soc import installer_ui
    created = []
    def create(*, interactive, plain):
        ui = FakeUI(interactive=interactive)
        created.append(ui)
        return ui
    monkeypatch.setattr(installer_ui, 'InstallerUI', create)
    return created


def test_password_stdin_is_read_once_without_prompt_or_echo(installation, cli_ui, monkeypatch):
    import io
    import sys
    stream = io.StringIO('stdin-secret\nnext-line\n')
    monkeypatch.setattr(sys, 'stdin', stream)
    monkeypatch.setattr(vp, '_build_config_from_args', installation.build_config)
    monkeypatch.setattr(vp, 'load_config', lambda **kw: copy.deepcopy(vp.DEFAULT_CONFIG))
    password_prompt = Mock(side_effect=AssertionError('stdin setup must never prompt'))
    monkeypatch.setattr(vp.getpass, 'getpass', password_prompt)
    assert vp.install_virtual_printer(['--username', 'student', '--password-stdin', '--plain']) == 0
    assert cli_ui[0].interactive is False
    assert installation.backend_config.call_args.args[0]['ssh']['password'] == 'stdin-secret'
    assert stream.read() == 'next-line\n'
    assert 'stdin-secret' not in repr(cli_ui[0].events)
    password_prompt.assert_not_called()


def test_non_tty_automatically_selects_noninteractive_mode(installation, cli_ui, monkeypatch):
    import io
    import sys
    monkeypatch.setattr(sys, 'stdin', io.StringIO(''))
    assert vp.install_virtual_printer([]) == 0
    assert cli_ui[0].interactive is False


def test_explicit_headless_ask_password_fails_before_reading_input(installation, cli_ui, monkeypatch):
    import io
    import sys
    stream = io.StringIO('do-not-consume\n')
    monkeypatch.setattr(sys, 'stdin', stream)
    assert vp.install_virtual_printer(['--non-interactive', '--ask-password']) == 1
    assert stream.read() == 'do-not-consume\n'
    assert_no_mutation(installation)
    assert '--password-stdin' in cli_ui[0].failures[0][1]


@pytest.mark.parametrize('prefix', [['virtual-printer', 'install'], ['--install-virtual-printer']])
def test_both_cli_spellings_handle_install_failure_without_traceback(installation, cli_ui, monkeypatch, prefix):
    from print_at_soc import cli
    installation.config['ssh']['username'] = ''
    monkeypatch.setattr(cli.sys, 'argv', ['print-soc'] + prefix + ['--non-interactive', '--plain'])
    assert cli.main() == 1
    assert_no_mutation(installation)
    assert cli_ui[0].failures


def test_interrupt_after_system_changes_reports_partial_install(installation):
    installation.runtime.side_effect = KeyboardInterrupt
    ui = FakeUI()
    wizard = PrinterInstallation(arguments(), ui)
    assert wizard.run() == 130
    assert wizard.state is InstallationState.CANCELLED
    assert ui.cancelled_calls == [True]
    assert not ui.completed
    installation.backend_config.assert_not_called()


def test_changing_credentials_redacts_both_old_and_new_secrets(installation):
    old_password = installation.config['ssh']['password']
    installation.runtime.side_effect = RuntimeError(old_password + ' test-password')
    ui = FakeUI(interactive=True)
    wizard = PrinterInstallation(arguments(non_interactive=False, ask_password=True), ui)
    assert wizard.run() == 1
    assert old_password not in repr(ui.failures)
    assert 'test-password' not in repr(ui.failures)


@pytest.mark.parametrize('paper,duplex,ppd_duplex', [
    ('A3', 'simplex', 'None'),
    ('A4', 'duplex-short-edge', 'DuplexTumble'),
    ('A4', 'duplex-long-edge', 'DuplexNoTumble'),
])
def test_selected_defaults_are_registered_with_cups(installation, paper, duplex, ppd_duplex):
    installation.config['print'].update(paper_size=paper, duplex=duplex)
    assert PrinterInstallation(arguments(), FakeUI()).run() == 0
    register = next(command for command, _dry in installation.calls
                    if command[0].endswith('/lpadmin'))
    options = [register[index + 1] for index, value in enumerate(register) if value == '-o']
    assert 'PageSize=' + paper in options
    assert 'PageRegion=' + paper in options
    assert 'Duplex=' + ppd_duplex in options


@pytest.mark.parametrize('secret_flag', ['--password-stdin', '--ask-password'])
def test_dry_run_never_reads_secret_input(installation, cli_ui, monkeypatch, secret_flag):
    import io
    import sys
    class UnreadableInput(io.StringIO):
        def readline(self, *args, **kwargs):
            raise AssertionError('dry-run attempted to consume a secret')
    stream = UnreadableInput('leave-secret-untouched\n')
    monkeypatch.setattr(sys, 'stdin', stream)
    monkeypatch.setattr(vp, '_build_config_from_args', installation.build_config)
    monkeypatch.setattr(vp, 'load_config', lambda **kw: copy.deepcopy(vp.DEFAULT_CONFIG))
    password_prompt = Mock(side_effect=AssertionError('dry-run requested a password'))
    monkeypatch.setattr(vp.getpass, 'getpass', password_prompt)
    assert vp.install_virtual_printer([
        '--non-interactive', '--dry-run', '--username', 'student', secret_flag,
    ]) == 0
    assert stream.tell() == 0
    assert cli_ui[0].completed[0][2] is True
    installation.backend_config.assert_not_called()
    installation.user_config.assert_not_called()
    installation.authorize.assert_not_called()
    password_prompt.assert_not_called()


@pytest.mark.parametrize('conflict', [
    ['--password-stdin', '--password', 'test-secret'],
    ['--ask-password', '--password-stdin'],
    ['--key-path', '/key', '--password', 'test-secret'],
    ['--ask-password', '--key-path', '/key'],
])
def test_conflicting_authentication_sources_fail_before_any_prompt(installation, cli_ui, monkeypatch, conflict):
    password_prompt = Mock(side_effect=AssertionError('invalid arguments prompted for a password'))
    monkeypatch.setattr(vp.getpass, 'getpass', password_prompt)
    with pytest.raises(SystemExit) as error:
        vp.install_virtual_printer(conflict)
    assert error.value.code == 2
    password_prompt.assert_not_called()
    assert cli_ui == []
    assert_no_mutation(installation)


def test_review_can_edit_settings_before_authorization_or_installation(installation):
    timeline = []

    class EditingUI(FakeUI):
        def __init__(self):
            super().__init__(interactive=True)
            self.username_count = 0
            self.confirm_count = 0

        def ask_text(self, label, default='', secret=False, validate=None):
            if label == 'SoC username':
                self.username_count += 1
                value = 'original-user' if self.username_count == 1 else 'edited-user'
                timeline.append(value)
                return value
            return super().ask_text(label, default, secret, validate)

        def confirm(self, label, default=False):
            self.confirm_count += 1
            assert_no_mutation(installation)
            installation.authorize.assert_not_called()
            accepted = self.confirm_count == 2
            timeline.append('accepted' if accepted else 'declined')
            return accepted

        def choose(self, label, choices, default=None):
            if label == 'Before continuing':
                timeline.append('edit')
                return 'edit'
            return super().choose(label, choices, default)

    installation.authorize.side_effect = lambda: timeline.append('authorize')
    ui = EditingUI()
    wizard = PrinterInstallation(arguments(non_interactive=False, yes=False), ui)
    assert wizard.run() == 0
    assert wizard.state is InstallationState.COMPLETE
    assert timeline == ['original-user', 'declined', 'edit', 'edited-user', 'accepted', 'authorize']
    assert installation.backend_config.call_count == 1
    assert installation.backend_config.call_args.args[0]['ssh']['username'] == 'edited-user'
    assert installation.user_config.call_args.args[0]['ssh']['username'] == 'edited-user'
    assert installation.runtime.call_count == 1
    assert ui.confirm_count == 2
    assert not ui.cancelled_calls
