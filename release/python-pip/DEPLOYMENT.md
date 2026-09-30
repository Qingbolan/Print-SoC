# Publishing Print@SoC

Versioning and release procedures are defined in [VERSIONING.md](../../VERSIONING.md).
Tide is the only version authority. The Python source build stamps its version
from Tide; source distributions and wheels carry that stamp without requiring
Tide on the installing machine.

From a full repository checkout:

```bash
python3 scripts/version.py sync
python3 -m pip install build twine pytest
python3 -m pip install -e release/python-pip
python3 -m pytest release/python-pip/tests -q
python3 -m build --outdir dist/python release/python-pip
python3 -m twine check dist/python/*
```

Use the release workflow for publication so the corresponding desktop assets
exist first. Supply `PYPI_API_TOKEN` through repository secrets; never store it
in source files. Verify installation from PyPI and run `print-soc --install`
to update the separate desktop application.
