"""Printer setup presentation built on shared terminal controls."""
from typing import List
import platform
import shlex

from .terminal_ui import TerminalUI


class InstallerUI(TerminalUI):
    def intro(self) -> None:
        self.console.print()
        self._panel(
            'Print@SoC  /  System printer setup',
            'Print from your usual apps to a SoC printer.\n'
            'We will check this computer, set up forwarding, and add the system queue.\n\n'
            'Your SoC password signs in to the print server.\n'
            'Your computer administrator password authorizes installation.\n'
            'They are separate credentials; neither is displayed.\n'
            'Forwarding credentials are saved locally with restricted permissions.\n'
            'Setup does not send a print job.',
        )
        if self.interactive:
            self.note('Enter accepts the current value. Ctrl+C cancels setup.')
            if not self.plain:
                self.note('Use ↑ / ↓ to choose, then Enter to continue.')
        self.console.print()

    def finish(self, name: str, display_name: str, dry_run: bool = False) -> None:
        self.console.print()
        if dry_run:
            self._panel('Preview complete', 'No printer, credentials, or system files were changed.\n'
                        'Run the same command without --dry-run when you are ready.')
            return
        shortcut = 'Command+P' if platform.system() == 'Darwin' else 'Ctrl+P'
        self._panel(
            'System printer added',
            f'1. Open a document and press {shortcut}.\n'
            f'2. Choose {display_name} ({name}).\n'
            '3. Select paper size, copies, and two-sided printing, then print.\n\n'
            'Connect to the NUS network or VPN before printing.\n'
            'Local setup is complete. Remote printing has not been verified;\n'
            'no test job was submitted.',
            'green',
        )
        quoted_name = shlex.quote(name)
        self.note('Check the queue:')
        self._line(f'  print-soc virtual-printer status --name {quoted_name}')
        self.note('Remove this system printer:')
        self._line(f'  print-soc virtual-printer uninstall --name {quoted_name}')
        self.note('If you started from the desktop app, return to Settings → Advanced and refresh status.')

    def failure(self, stage: str, detail: str, commands: List[str], changed: bool = False) -> None:
        self.console.print()
        self._panel(f'Setup stopped · {stage}', detail, 'red')
        self.note('Some installation steps may have completed. Check status before retrying.' if changed
                  else 'No system printer changes were made.')
        if commands:
            self._line('Next steps', 'bold')
            for command in commands:
                self._line(f'  {command}')
        self.note('After resolving the issue, rerun setup. Completed installation steps can be repaired.')

    def cancelled(self, changed: bool = False) -> None:
        self.console.print()
        self._line('Setup cancelled.', 'yellow')
        self.note('Some steps may have completed. Run print-soc virtual-printer status before retrying.'
                  if changed else 'No system printer changes were made.')
