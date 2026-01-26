"""Windows post-install hook invoked via .pth on next Python start.

This sets up user-level PATH and App Paths registration so that
`EasyPaper` can be launched directly from terminals without
manually editing PATH. It is safe and idempotent.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path


def _run_once_guard() -> bool:
    """Return True if we've already run, else create guard and return False."""
    try:
        home = Path.home()
        flag_dir = home / ".EasyPaper"
        flag_dir.mkdir(parents=True, exist_ok=True)
        flag = flag_dir / "win_postinstall_done"
        if flag.exists():
            return True
        flag.write_text("1")
        return False
    except Exception:
        # If guard fails, still attempt once
        return False


def run_post_install():  # pragma: no cover - side-effect hook
    try:
        if os.name != "nt":
            return
        # Allow users/CI to disable via env
        if os.environ.get("easy_paper_NO_POSTINSTALL"):
            return
        # During build/installer contexts, skip
        if any(m in sys.modules for m in ("pip", "build", "setuptools")):
            # Still ok to continue, but keep minimal
            pass

        # Avoid running multiple times
        if _run_once_guard():
            return

        # Defer import to avoid overhead when not on Windows
        from .cli import _windows_setup_shortcuts  # type: ignore

        # Best-effort setup: add Scripts to PATH + register App Paths
        _windows_setup_shortcuts(register_app=True, fix_path=True)
    except Exception:
        # Never fail interpreter startup due to post-install
        return


# If imported via .pth, execute immediately
if __name__ == "__main__":
    run_post_install()

