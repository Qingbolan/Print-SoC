"""Build a self-contained, system-readable CUPS backend from installed packages."""
from importlib import metadata
from pathlib import Path
import shutil
import sys

from packaging.requirements import Requirement


class CupsRuntime:
    """Snapshot dependencies so CUPS never imports code from a user's home."""

    def __init__(self):
        self.python = Path(getattr(sys, '_base_executable', sys.executable)).resolve()
        if str(self.python).startswith('/Users/') or str(self.python).startswith('/home/'):
            raise RuntimeError(
                'CUPS requires a system Python outside the home directory. '
                'Install print-at-soc with a Homebrew or system Python and retry.'
            )

    def stage(self, destination: Path) -> None:
        pending = [('paramiko', '')]
        visited = set()
        while pending:
            name, extra = pending.pop()
            key = (name.lower().replace('_', '-'), extra)
            if key in visited:
                continue
            visited.add(key)
            distribution = metadata.distribution(name)
            for item in distribution.files or []:
                # Wheel console scripts live outside site-packages; the backend
                # needs importable modules and package data only.
                if item.is_absolute() or '..' in item.parts or '__pycache__' in item.parts:
                    continue
                source = Path(distribution.locate_file(item))
                if source.is_file():
                    target = destination / item
                    target.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(source, target)
            for entry in distribution.requires or []:
                requirement = Requirement(entry)
                if requirement.marker is None or requirement.marker.evaluate({'extra': extra}):
                    pending.append((requirement.name, ''))
                    pending.extend((requirement.name, value) for value in requirement.extras)
        shutil.copytree(Path(__file__).parent, destination / 'print_at_soc',
                        ignore=shutil.ignore_patterns('__pycache__', '*.pyc'))

    def wrapper(self, destination: Path) -> str:
        import shlex
        return (
            '#!/bin/sh\n'
            '# Print@SoC CUPS backend; only system-owned code is loaded.\n'
            'unset PYTHONHOME\n'
            f'export PYTHONPATH={shlex.quote(str(destination))}\n'
            f'exec {shlex.quote(str(self.python))} -S -m print_at_soc.virtual_printer backend "$@"\n'
        )
