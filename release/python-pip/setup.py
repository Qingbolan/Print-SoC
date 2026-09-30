"""Stamp source builds from Tide; source distributions already contain the stamp."""
from pathlib import Path
import subprocess
import sys
from setuptools import setup

root = Path(__file__).resolve().parents[2]
version_script = root / "scripts" / "version.py"
if (root / "release/python-pip") == Path(__file__).resolve().parent and version_script.is_file() and (root / ".git").exists():
    subprocess.run([sys.executable, str(version_script), "sync"], check=True)

if __name__ == "__main__":
    setup()
