"""Shared terminal rendering and input; no lifecycle or account ownership."""
from __future__ import annotations

import getpass
import os
import platform
import shlex
import time
from contextlib import contextmanager
from typing import Any, Callable, List, Optional, Tuple

import questionary
from rich import box
from rich.console import Console
from rich.panel import Panel
from rich.table import Table
from rich.text import Text


class TerminalUI:
    """Accessible terminal controls shared by installation and maintenance."""

    def __init__(self, *, interactive: bool, plain: bool = False, console=None):
        self.interactive = interactive
        self.console = console or Console(highlight=False, markup=False)
        self.plain = bool(
            plain or not interactive or not self.console.is_terminal
            or os.environ.get('TERM') == 'dumb' or 'NO_COLOR' in os.environ
        )
        # Also applies when a caller supplies a forced-terminal console.
        if self.plain:
            self.console.no_color = True
        self.prompt_style = questionary.Style([
            ('qmark', 'fg:#22d3ee bold'),
            ('question', 'bold'),
            ('answer', 'fg:#22d3ee'),
            ('pointer', 'fg:#22d3ee bold'),
            ('highlighted', 'fg:#22d3ee bold'),
            ('selected', 'fg:#22d3ee'),
            ('instruction', 'fg:#888888'),
            ('text', ''),
        ])

    def _line(self, value: str, style: str = '') -> None:
        self.console.print(Text(str(value), style=style if not self.plain else ''))

    def _panel(self, title: str, body: str, style: str = 'cyan') -> None:
        if self.plain:
            self._line(title)
            self._line(body)
        else:
            self.console.print(Panel(
                Text(body), title=Text(title, style='bold'), title_align='left',
                border_style=style, box=box.ROUNDED, padding=(1, 2),
            ))

    def note(self, text: str) -> None:
        self._line(text, 'dim')

    def _require_input(self) -> None:
        if not self.interactive:
            raise RuntimeError('Interactive input is disabled. Supply the required command options.')

    def _ask(self, prompt) -> Any:
        try:
            answer = prompt.unsafe_ask()
        except EOFError as exc:
            raise KeyboardInterrupt from exc
        if answer is None:
            raise KeyboardInterrupt
        return answer

    def _read(self, label: str, *, secret: bool = False) -> str:
        try:
            return getpass.getpass(label) if secret else input(label)
        except EOFError as exc:
            raise KeyboardInterrupt from exc

    def ask_text(
        self, label: str, default: str = '', secret: bool = False,
        validate: Optional[Callable[[str], Any]] = None,
    ) -> str:
        self._require_input()
        while True:
            if self.plain:
                suffix = f' [{default}]' if default and not secret else ''
                answer = self._read(f'{label}{suffix}: ', secret=secret)
            else:
                factory = questionary.password if secret else questionary.text
                kwargs = {'style': self.prompt_style}
                if not secret:
                    kwargs['default'] = default
                answer = self._ask(factory(label, **kwargs))
            answer = answer or default
            valid = validate(answer) if validate else True
            if valid is True:
                return answer
            self._line(str(valid) if isinstance(valid, str) else 'Please enter a valid value.', 'yellow')

    def choose(self, label: str, choices: List[Tuple[str, Any]], default=None) -> Any:
        self._require_input()
        if not choices:
            raise ValueError('A selection requires at least one choice')
        default_index = next((i for i, (_, value) in enumerate(choices) if value == default), 0)
        if not self.plain:
            return self._ask(questionary.select(
                label, choices=[questionary.Choice(title, value=value) for title, value in choices],
                default=choices[default_index][1], style=self.prompt_style,
                instruction='(↑/↓ to move, Enter to select)',
            ))
        self._line(label)
        for index, (title, _) in enumerate(choices, 1):
            self._line(f'  {index}. {title}')
        while True:
            answer = self._read(f'Choose [1-{len(choices)}] ({default_index + 1}): ').strip()
            if not answer:
                return choices[default_index][1]
            if answer.isdigit() and 1 <= int(answer) <= len(choices):
                return choices[int(answer) - 1][1]
            self._line(f'Enter a number from 1 to {len(choices)}.', 'yellow')

    def confirm(self, label: str, default: bool = False) -> bool:
        self._require_input()
        if not self.plain:
            return bool(self._ask(questionary.confirm(label, default=default, style=self.prompt_style)))
        while True:
            answer = self._read(f'{label} {"[Y/n]" if default else "[y/N]"}: ').strip().lower()
            if not answer:
                return default
            if answer in ('y', 'yes'):
                return True
            if answer in ('n', 'no'):
                return False
            self._line('Enter yes or no.', 'yellow')

    def summary(self, rows: List[Tuple[str, str]]) -> None:
        self.console.print()
        if self.plain:
            self._line('Review setup')
            for key, value in rows:
                self._line(f'  {key}: {value}')
        else:
            table = Table.grid(padding=(0, 2), expand=True)
            table.add_column(style='dim', ratio=1)
            table.add_column(ratio=2, overflow='fold')
            for key, value in rows:
                table.add_row(Text(str(key)), Text(str(value)))
            self.console.print(Panel(table, title=Text('Review setup', style='bold'),
                                     title_align='left', border_style='cyan', box=box.ROUNDED))
        self.console.print()

    @contextmanager
    def stage(self, label: str, index: int, total: int, animate: bool = True):
        text = f'{index}/{total}  {label}'
        started = time.monotonic()
        status = None
        if not self.plain and animate:
            status = self.console.status(Text(text), spinner='dots', spinner_style='cyan',
                                         refresh_per_second=10)
            status.start()
        else:
            self._line(f'[{index}/{total}] {label} …')
        try:
            yield
        except BaseException:
            if status:
                status.stop()
            self._line(f'{"!" if self.plain else "✕"} {text}', 'red')
            raise
        else:
            if status:
                status.stop()
            elapsed = time.monotonic() - started
            self._line(f'{"OK" if self.plain else "✓"} {text}  ({elapsed:.1f}s)', 'green')
