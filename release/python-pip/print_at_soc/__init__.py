"""Print@SoC Python Wrapper

A Python wrapper for Print@SoC desktop application.
Smart Printing for NUS SoC
"""

__version__ = "0.1.1"
__author__ = "Silan Hu"
__email__ = "silan.hu@u.nus.edu"

def main():
    from .cli import main as cli_main

    return cli_main()

__all__ = ["main", "__version__"]
