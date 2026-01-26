"""Print@SoC Python Wrapper

A Python wrapper for Print@SoC desktop application.
Smart Printing for NUS SoC
"""

__version__ = "0.1.0"
__author__ = "Silan Hu"
__email__ = "silan.hu@u.nus.edu"

from .cli import main

__all__ = ["main", "__version__"]
