# Publishing Print@SoC to PyPI

The Python distribution and desktop binaries have separate versions. The Python
version is defined once in `print_at_soc/__init__.py`; setuptools and the CLI use
that value. Increase it before publishing: PyPI versions cannot be overwritten.
The wrapper downloads desktop assets from the latest GitHub release of
[Qingbolan/Print-SoC](https://github.com/Qingbolan/Print-SoC/releases).

From `release/python-pip`, using a fresh virtual environment:

```bash
python -m pip install build twine pytest
python -m pip install -e .
python -m pytest tests -q
python -m build
python -m twine check dist/*
```

Use a clean output directory so an upload includes only the intended version.
Install the wheel into a separate environment and check all console entry points,
`--help`, `--version`, `--doctor`, and `config show --json` before publishing.

Upload with Twine, supplying `__token__` as the username and a PyPI API token at
the password prompt (or through a secret-managed `TWINE_PASSWORD` environment
variable):

```bash
python -m twine upload --username __token__ dist/*
```

Never store tokens in source files or commit them. After uploading, install the
exact version from PyPI into a fresh environment and run the CLI smoke checks.

The GitHub release workflow builds desktop binaries and publishes the Python
package using the repository's `PYPI_API_TOKEN` secret. It synchronizes the Python
version from the requested release tag before building. Python-only releases can
use the manual process above without rebuilding the desktop assets.
