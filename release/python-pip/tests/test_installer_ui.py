"""Presentation behavior: terminals are interactive, logs stay literal and quiet."""
import io

import pytest
from rich.console import Console

from print_at_soc.installer_ui import InstallerUI


def make_ui(*, interactive=False, plain=False, terminal=False, width=60):
    output = io.StringIO()
    return InstallerUI(interactive=interactive, plain=plain,
                       console=Console(file=output, force_terminal=terminal, width=width)), output


def test_redirected_output_has_no_animation_or_ansi():
    ui, output = make_ui()
    ui.intro()
    with ui.stage('Register queue', 3, 5):
        pass
    ui.finish('PrintAtSoC', 'Print@SoC Virtual Printer')
    value = output.getvalue()
    assert '\x1b' not in value
    assert '[3/5]' in value
    assert 'OK 3/5' in value
    assert 'Remote printing has not been verified' in ' '.join(value.split())
    assert 'virtual-printer status --name PrintAtSoC' in value


@pytest.mark.parametrize('environment', [{'NO_COLOR': ''}, {'TERM': 'dumb'}])
def test_accessible_terminal_mode_has_no_ansi(monkeypatch, environment):
    for key, value in environment.items():
        monkeypatch.setenv(key, value)
    ui, output = make_ui(interactive=True, terminal=True)
    ui.intro()
    with ui.stage('Check environment', 1, 5):
        pass
    assert ui.plain
    assert '\x1b' not in output.getvalue()


def test_plain_choice_reprompts_and_honors_default(monkeypatch):
    ui, output = make_ui(interactive=True, plain=True)
    answers = iter(['invalid', '9', ''])
    monkeypatch.setattr('builtins.input', lambda _: next(answers))
    assert ui.choose('Server', [('Student', 'stu'), ('Staff', 'stf')], default='stf') == 'stf'
    assert output.getvalue().count('Enter a number') == 2


def test_noninteractive_never_reads_stdin(monkeypatch):
    ui, _ = make_ui()
    monkeypatch.setattr('builtins.input', lambda _: pytest.fail('stdin must not be read'))
    for prompt in [lambda: ui.ask_text('Username'), lambda: ui.choose('Server', [('Student', 'stu')]),
                   lambda: ui.confirm('Install?')]:
        with pytest.raises(RuntimeError, match='Interactive input is disabled'):
            prompt()


def test_secret_input_is_not_echoed_or_shown_as_default(monkeypatch):
    ui, output = make_ui(interactive=True, plain=True)
    labels = []
    def password(label):
        labels.append(label)
        return 'new-secret'
    monkeypatch.setattr('print_at_soc.terminal_ui.getpass.getpass', password)
    assert ui.ask_text('SoC password', default='old-secret', secret=True) == 'new-secret'
    assert 'old-secret' not in ''.join(labels)
    assert 'new-secret' not in output.getvalue()


def test_plain_text_validation_and_eof_cancellation(monkeypatch):
    ui, output = make_ui(interactive=True, plain=True)
    answers = iter(['', 'student'])
    monkeypatch.setattr('builtins.input', lambda _: next(answers))
    assert ui.ask_text('Username', validate=lambda v: True if v else 'A username is required') == 'student'
    assert 'A username is required' in output.getvalue()
    def eof(_):
        raise EOFError
    monkeypatch.setattr('builtins.input', eof)
    with pytest.raises(KeyboardInterrupt):
        ui.ask_text('Username')


def test_failure_and_cancel_never_claim_rollback():
    ui, output = make_ui()
    ui.failure('Register', 'Permission denied [red]literal[/red]', ['print-soc virtual-printer status'], changed=True)
    ui.cancelled(changed=True)
    value = output.getvalue()
    assert '[red]literal[/red]' in value
    assert 'may have completed' in value
    assert 'No system printer changes' not in value


def test_failed_stage_propagates_and_records_failure():
    ui, output = make_ui()
    with pytest.raises(RuntimeError, match='failed'):
        with ui.stage('Register queue', 3, 5):
            raise RuntimeError('failed')
    assert '! 3/5' in output.getvalue()
    assert 'OK 3/5' not in output.getvalue()


def test_dry_run_has_no_installed_claim():
    ui, output = make_ui()
    ui.finish('TestPrinter', 'Test printer', dry_run=True)
    assert 'Preview complete' in output.getvalue()
    assert 'System printer added' not in output.getvalue()


def test_rich_dynamic_values_are_literal(monkeypatch):
    monkeypatch.delenv('NO_COLOR', raising=False)
    monkeypatch.setenv('TERM', 'xterm-256color')
    ui, output = make_ui(interactive=True, terminal=True, width=42)
    ui.summary([('Printer', '[red]literal[/red]')])
    assert '[red]literal[/red]' in output.getvalue()
