"""Interactive maintenance commands and bounded, opt-in automatic updates."""
from __future__ import annotations

import argparse
from contextlib import contextmanager
import json
import os
import platform
from pathlib import Path
import shlex
import subprocess
import sys
import tempfile
import time

from packaging.version import Version
from rich.progress import Progress, SpinnerColumn, TextColumn, BarColumn, DownloadColumn, TransferSpeedColumn
from rich.text import Text

from .config import INSTALL_DIR, VERSION
from .terminal_ui import TerminalUI


class MaintenanceUI(TerminalUI):
    def heading(self, action, description):
        self.console.print()
        self._panel(f"Print@SoC  /  {action}", description)

    def done(self, title, description):
        self._panel(title, description, 'green')

    def stopped(self, error, commands):
        self._panel('Maintenance stopped', str(error), 'red')
        self.note('Review the error before retrying. Unfinished cleanup is not reported as complete.')
        for command in commands:
            self._line('  ' + command)

    @contextmanager
    def transfer(self):
        """One live area: byte progress while downloading, named stages otherwise."""
        if self.plain:
            previous = [None]
            def report(stage, completed=0, total=0):
                if previous[0] != stage:
                    self.note(stage.capitalize())
                    previous[0] = stage
            yield report
            return
        with Progress(SpinnerColumn(), TextColumn('{task.description}'), BarColumn(),
                      DownloadColumn(), TransferSpeedColumn(), console=self.console,
                      transient=True) as progress:
            task = progress.add_task('Preparing', total=None)
            def report(stage, completed=0, total=0):
                progress.update(task, description=Text(stage.capitalize()), total=total or None,
                                completed=completed)
            yield report


def _settings_path(root):
    return Path(root) / 'maintenance.json'


def read_settings(root=INSTALL_DIR):
    defaults = {'mode': 'notify', 'last_checked': 0}
    path = _settings_path(root)
    if path.is_symlink():
        raise RuntimeError('Maintenance settings must not be a symbolic link')
    if path.exists():
        value = json.loads(path.read_text())
        if not isinstance(value, dict) or value.get('mode', 'notify') not in ('notify', 'apply', 'off'):
            raise RuntimeError('Invalid maintenance settings. Run print-soc self update --auto notify to reset.')
        defaults.update(value)
    return defaults


def write_settings(value, root=INSTALL_DIR):
    from .update_service import MaintenanceLock
    root = Path(root)
    with MaintenanceLock(root):
        path = _settings_path(root)
        if path.is_symlink():
            raise RuntimeError('Maintenance settings must not be a symbolic link')
        with tempfile.NamedTemporaryFile('w', dir=root, prefix='.maintenance-', delete=False) as handle:
            temporary = Path(handle.name)
            try:
                json.dump(value, handle)
                handle.flush()
                os.fsync(handle.fileno())
                temporary.replace(path)
            finally:
                temporary.unlink(missing_ok=True)


def maybe_auto_update():
    """Called only before a normal desktop launch, never from printing or MCP."""
    from .update_service import UpdateService
    try:
        settings = read_settings()
        if settings['mode'] == 'off' or os.environ.get('PRINT_AT_SOC_NO_UPDATES') == '1':
            return
        now = time.time()
        if now - float(settings.get('last_checked', 0)) < 24 * 60 * 60:
            return
        # Persist the attempt too: offline launches must not retry on every invocation.
        settings['last_checked'] = now
        write_settings(settings)
        service = UpdateService()
        current = service.installed_version()
        if not current:
            return
        release = service.latest(timeout=3)
        if Version(release.version) <= Version(current):
            return
        if settings['mode'] == 'apply' and platform.system() != 'Windows':
            print(f'Print@SoC: updating {current} → {release.version} before launch...', file=sys.stderr)
            if sys.stderr.isatty() and sys.stdin.isatty():
                from rich.console import Console
                view = MaintenanceUI(interactive=True, console=Console(stderr=True, markup=False))
                with view.transfer() as report:
                    service.update(release, progress=report)
            else:
                service.update(release)
            print('Print@SoC: desktop updated. The previous version is available with self update --rollback.', file=sys.stderr)
        else:
            print(f'Print@SoC {release.version} is available (installed: {current}). Run print-soc self update.', file=sys.stderr)
    except KeyboardInterrupt:
        print('Print@SoC: automatic update cancelled. Desktop launch cancelled; rerun print-soc to recover any interrupted transaction.', file=sys.stderr)
        return 130
    except Exception as error:
        # Update failure never prevents launching an existing working desktop.
        print(f'Print@SoC update check deferred: {error}', file=sys.stderr)


def _confirm(ui, args, message):
    if args.yes:
        return True
    if not ui.interactive:
        raise RuntimeError('Non-interactive changes require --yes. Use --check or --dry-run to preview first.')
    return ui.confirm(message, default=False)


def _update(args, ui):
    from .update_service import UpdateService
    ui.heading('Updates', 'Download and verify before replacing the desktop. Keep the previous version for rollback.\nCLI packages remain managed by pip/npm; the printer service has its own installed snapshot.')
    if args.auto:
        if args.auto == 'apply' and platform.system() == 'Windows':
            raise RuntimeError('Windows updates use the native installer. Select --auto notify and run self update interactively to handle its system prompts.')
        try:
            settings = read_settings()
        except (RuntimeError, ValueError):
            settings = {'last_checked': 0}
        settings['mode'] = args.auto
        settings['last_checked'] = 0
        write_settings(settings)
        messages = {'notify': 'Check at normal desktop launch, at most once per day; notify without installing.',
                    'apply': 'Check at normal desktop launch, at most once per day; apply verified desktop updates before launching.',
                    'off': 'Automatic update checks are disabled.'}
        ui.done('Update preference saved', messages[args.auto] + '\nMCP and print commands never trigger updates.')
        return 0
    service = UpdateService()
    if args.rollback:
        ui.note('Restore the retained previous desktop and its version receipt. Close the desktop app first.')
        if not _confirm(ui, args, 'Restore the previous desktop version?'):
            ui.note('Cancelled. No update was applied.')
            return 0
        if platform.system() == 'Windows' and not ui.interactive:
            raise RuntimeError('Windows rollback needs an interactive native installer. Rerun this command in a terminal.')
        settings = read_settings()
        settings['mode'] = 'off'
        write_settings(settings)
        with ui.stage('Restore previous version', 1, 1):
            service.rollback()
        ui.done('Previous version restored', 'Run print-soc to launch. Automatic updates are now disabled so this rollback is not immediately replaced.')
        return 0
    with ui.stage('Check latest release', 1, 3):
        release = service.latest()
        current = service.installed_version()
    ui.summary([('Desktop installed', current or 'Not installed'), ('Desktop available', release.version),
                ('CLI package', VERSION), ('Release asset', release.name)])
    available = not current or Version(release.version) > Version(current)
    if args.check:
        ui.done('Update available' if available else 'Desktop is current',
                'Run print-soc self update to install.' if available else 'No newer desktop release was found.')
        return 0
    if not available and not args.force:
        ui.done('Desktop is current', 'No changes were made. Use --force only if you need to repair this installation.')
        return 0
    if current and Version(release.version) < Version(current):
        raise RuntimeError('Refusing a downgrade through update. Use --rollback to restore a retained version.')
    if not _confirm(ui, args, 'Install this desktop release?'):
        ui.note('Cancelled. Your existing installation is unchanged.')
        return 0
    if platform.system() == 'Windows' and not ui.interactive:
        raise RuntimeError('Windows updates need an interactive native installer. Rerun self update in a terminal.')
    ui.note('Close the desktop app before continuing. Existing user data and printer configuration are retained.')
    with ui.transfer() as report:
        service.update(release, progress=report)
    ui.done('Desktop update complete', 'The verified desktop is installed. Run print-soc to launch.\nRestore the previous version with: print-soc self update --rollback')
    ui.note('CLI package upgrades use your package manager. After upgrading the CLI, rerun virtual-printer install to refresh its service snapshot.')
    return 0


def _completion_receipt(purge=False):
    """The npm bridge consumes a success receipt; cancel/dry-run never produce it."""
    destination = os.environ.get('PSOC_MAINTENANCE_RESULT')
    if destination:
        descriptor = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, 'w') as handle:
            json.dump({'status': 'uninstalled', 'purge': purge}, handle)


def _uninstall(args, ui):
    from .uninstall_service import UninstallService
    from . import virtual_printer as vp
    ui.heading('Uninstall', 'Review exactly what will be removed. Keep your data for a future reinstall, or purge this application’s data and saved credentials.')
    if args.purge:
        purge = True
    elif args.keep_data or not ui.interactive:
        purge = False
    else:
        purge = ui.choose('What should happen to your data?', [('Keep settings, history and credentials', False),
                                                               ('Purge app data and saved credentials', True)], default=False)
    npm = os.environ.get('PSOC_PACKAGE_MANAGER') == 'npm'
    remove_cli = args.remove_cli or os.environ.get('PSOC_REMOVE_CLI') == '1'
    if ui.interactive and not remove_cli and not npm and not args.dry_run:
        remove_cli = ui.confirm('Also uninstall the Python CLI package after cleanup?', default=False)
    service = UninstallService()
    with ui.stage('Inspect owned components', 1, 3):
        plan = service.plan(purge=purge)
    rows = [('Data policy', 'Purge application data and credentials' if purge else 'Keep application data and credentials')]
    rows.extend((item.label, str(item.path) if item.path else item.kind) for item in plan)
    owned_runtime = os.environ.get('PSOC_OWNED_RUNTIME_ROOT') if npm else None
    if owned_runtime:
        rows.append(('npm-owned Python runtime (' + ('remove' if purge or remove_cli else 'retain') + ')', owned_runtime))
    rows.append(('CLI package', ('Remove npm package' if npm else 'Remove Python package') if remove_cli else 'Retain for future use'))
    ui.summary(rows)
    ui.note('Original source documents and other applications are not cleanup targets. Close Print@SoC and finish or cancel its queued jobs before uninstalling.')
    if args.dry_run:
        ui.done('Removal preview complete', 'No files, queues, credentials or packages were changed.')
        return 0
    if not _confirm(ui, args, 'Permanently remove the listed components?' if purge else 'Remove the listed components and keep your data?'):
        ui.note('Cancelled. Nothing was removed.')
        return 0
    if any(item.kind in ('cups-queue', 'system-path') for item in plan):
        with ui.stage('Authorize system printer removal', 2, 3, animate=False):
            if ui.interactive:
                ui.note('sudo requests your computer administrator password, not your SoC password.')
                vp._authorize_system_changes()
            elif vp._sudo_prefix():
                vp._run_command(['sudo', '-n', '-v'])
    # Keychain unlock dialogs may appear; avoid terminal animation over authentication.
    with ui.stage('Remove owned components', 3, 3, animate=not purge):
        service.execute(purge=purge, non_interactive=True)
    if remove_cli and not npm:
        ui.note('Removing the Python package from this interpreter; dependency packages are retained because other apps may use them.')
        result = subprocess.run([sys.executable, '-m', 'pip', 'uninstall', '-y', 'print-at-soc'], check=False)
        if result.returncode:
            raise RuntimeError('Application cleanup completed, but pip could not remove the CLI. Retry: ' + shlex.join([sys.executable, '-m', 'pip', 'uninstall', 'print-at-soc']))
    _completion_receipt(purge=purge)
    ui.done('Application cleanup complete', 'Application data and saved credentials were purged.' if purge else 'Your settings, printing history and credentials were retained for a future reinstall.')
    if not remove_cli:
        ui.note('The CLI package remains installed. Remove it with your package manager when no longer needed.')
    ui.note('A non-secret maintenance lock and its containing directory remain to keep concurrent operations safe.')
    return 0


def maintenance_cli(argv):
    parser = argparse.ArgumentParser(prog='print-soc self', description='Update or uninstall with a reviewable maintenance workflow.')
    commands = parser.add_subparsers(dest='command', required=True)
    update = commands.add_parser('update', help='Check, apply or roll back desktop updates')
    action = update.add_mutually_exclusive_group()
    action.add_argument('--check', action='store_true', help='Check availability without changing the installation')
    action.add_argument('--rollback', action='store_true', help='Restore the previous desktop version')
    action.add_argument('--auto', choices=('notify', 'apply', 'off'), help='Configure automatic checks at desktop launch (daily)')
    update.add_argument('--force', action='store_true', help='Reinstall the same desktop version for repair')
    uninstall = commands.add_parser('uninstall', help='Remove installed components with optional data purge')
    mode = uninstall.add_mutually_exclusive_group()
    mode.add_argument('--purge', action='store_true', help='Also remove application data and saved credentials')
    mode.add_argument('--keep-data', action='store_true', help='Retain settings, history and credentials')
    uninstall.add_argument('--dry-run', action='store_true', help='Preview removal without changing anything')
    uninstall.add_argument('--remove-cli', action='store_true', help='Also remove this CLI package with its package manager after cleanup')
    for sub in (update, uninstall):
        sub.add_argument('--yes', action='store_true', help='Accept the displayed operation without confirmation')
        sub.add_argument('--non-interactive', action='store_true', help='Never ask terminal questions; mutations require --yes')
        sub.add_argument('--plain', action='store_true', help='Disable color, animation and arrow-key menus')
    args = parser.parse_args(argv)
    ui = MaintenanceUI(interactive=bool(sys.stdin.isatty() and sys.stdout.isatty() and not args.non_interactive), plain=args.plain)
    try:
        return _update(args, ui) if args.command == 'update' else _uninstall(args, ui)
    except (KeyboardInterrupt, EOFError):
        ui.note('Maintenance interrupted. A file replacement in progress is recovered on the next update; uninstall may have completed some steps. Review before retrying.')
        return 130
    except Exception as error:
        commands = ['print-soc self update --check', 'print-soc self update --rollback'] if args.command == 'update' else ['print-soc self uninstall --dry-run', 'sudo -v']
        ui.stopped(error, commands)
        return 1
