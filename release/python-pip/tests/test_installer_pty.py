"""Exercise the real terminal keyboard/rendering path without installing anything."""
import os
from pathlib import Path
import select
import shutil
import subprocess
import sys
import time

import pytest

pytestmark = pytest.mark.skipif(os.name != 'posix', reason='PTY integration requires POSIX')


class TerminalSession:
    def __init__(self, source, width=50):
        import fcntl
        import pty
        import struct
        import termios
        self.master, slave = pty.openpty()
        fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 32, width, 0, 0))
        environment = dict(os.environ, TERM='xterm-256color', PROMPT_TOOLKIT_NO_CPR='1',
                           PYTHONPATH=str(Path(__file__).resolve().parents[1]))
        environment.pop('NO_COLOR', None)
        self.process = subprocess.Popen([sys.executable, '-u', '-c', source], stdin=slave,
                                        stdout=slave, stderr=slave, env=environment)
        os.close(slave)
        self.output = bytearray()
        self.offset = 0

    def read_until(self, expected, timeout=8):
        deadline = time.monotonic() + timeout
        while expected not in self.output[self.offset:]:
            if time.monotonic() > deadline:
                pytest.fail(f'Terminal did not show {expected!r}: {bytes(self.output)!r}')
            if select.select([self.master], [], [], .05)[0]:
                try:
                    chunk = os.read(self.master, 65536)
                except OSError:
                    chunk = b''
                if not chunk:
                    pytest.fail(f'Terminal ended before {expected!r}: {bytes(self.output)!r}')
                self.output.extend(chunk)
        self.offset = self.output.index(expected, self.offset) + len(expected)

    def send(self, value):
        os.write(self.master, value)

    def close(self):
        if self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait(timeout=2)
        os.close(self.master)


WIZARD = '''
import copy
from print_at_soc import virtual_printer as vp
vp.load_config = lambda **kwargs: copy.deepcopy(vp.DEFAULT_CONFIG)
raise SystemExit(vp.install_virtual_printer(['--dry-run']))
'''


def require_cups():
    if not all(shutil.which(tool) for tool in ('lpadmin', 'lpstat', 'cupsaccept', 'cupsenable')):
        pytest.skip('Local CUPS tools are required for the native dry-run smoke test')
    result = subprocess.run(['lpstat', '-r'], capture_output=True, text=True)
    if result.returncode:
        pytest.skip('Local CUPS scheduler is not running')


def test_real_wizard_arrow_keys_validation_and_preview():
    require_cups()
    session = TerminalSession(WIZARD)
    try:
        session.read_until(b'SoC username')
        session.send(b'\r')
        session.read_until(b'Enter a value without spaces')
        session.send(b'pty-student\r')
        session.read_until(b'SoC server')
        session.send(b'\x1b[B\r')  # Student -> Staff.
        session.read_until(b'SSH port')
        session.send(b'\r')
        session.read_until(b'Remote printer queue')
        session.send(b'\r')
        session.read_until(b'Paper size')
        session.send(b'\x1b[B\r')  # A4 -> A3.
        session.read_until(b'Print sides')
        session.send(b'\r')
        session.read_until(b'Preview these steps?')
        session.send(b'\r')
        session.read_until(b'Preview complete')
        session.process.wait(timeout=5)
        assert session.process.returncode == 0
        assert b'\x1b[' in session.output
        assert b'stf.comp.nus.edu.sg' in session.output
        assert b'Would verify' in session.output
        assert b'Administrator authentication failed' not in session.output
        assert b'System printer added' not in session.output
    finally:
        session.close()


def test_real_wizard_cancellation_before_any_changes():
    require_cups()
    session = TerminalSession(WIZARD)
    try:
        session.read_until(b'SoC username')
        session.send(b'\x03')
        session.read_until(b'Setup cancelled.')
        session.read_until(b'No system printer changes were made.')
        session.process.wait(timeout=5)
        assert session.process.returncode == 130
        assert b'No system printer changes were made.' in session.output
        assert b'Traceback' not in session.output
    finally:
        session.close()


def test_real_password_prompt_hides_input_and_spinner_animates():
    source = '''
import time
from print_at_soc.installer_ui import InstallerUI
ui = InstallerUI(interactive=True)
password = ui.ask_text('Test secret', secret=True)
with ui.stage('Checking test input', 1, 1):
    time.sleep(.25)
print('SECRET_MATCH=' + str(password == 'pty-only-secret-783'))
'''
    session = TerminalSession(source)
    try:
        session.read_until(b'Test secret')
        session.send(b'pty-only-secret-783\r')
        session.read_until(b'SECRET_MATCH=True')
        session.process.wait(timeout=5)
        assert session.process.returncode == 0
        assert b'pty-only-secret-783' not in session.output
        assert b'\x1b[?25l' in session.output  # Live status hides the cursor while running.
        assert b'\x1b[?25h' in session.output  # Cursor restored at completion.
    finally:
        session.close()


def test_maintenance_uninstall_preview_is_interactive_without_deletion():
    source = '''
from pathlib import Path
from print_at_soc import maintenance, uninstall_service
from print_at_soc.uninstall_service import RemovalItem
class PreviewService:
    def plan(self, purge):
        return [RemovalItem('Purge data' if purge else 'Desktop binary', Path('/example/PrintAtSoC'), 'path')]
    def execute(self, *args, **kwargs):
        raise AssertionError('Preview must never delete')
uninstall_service.UninstallService = PreviewService
raise SystemExit(maintenance.maintenance_cli(['uninstall', '--dry-run']))
'''
    session = TerminalSession(source)
    try:
        session.read_until(b'What should happen to your data?')
        session.send(b'\x1b[B\r')
        session.read_until(b'Removal preview complete')
        session.process.wait(timeout=5)
        assert session.process.returncode == 0
        assert b'Purge data' in session.output
        assert b'Application cleanup complete' not in session.output
    finally:
        session.close()
