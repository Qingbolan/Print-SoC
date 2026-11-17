import json
import runpy
from pathlib import Path

import pytest
from print_at_soc.virtual_printer import adjusted_queue_for_duplex
import print_at_soc


@pytest.mark.parametrize('queue,mode,expected', [
    ('psc111-sx', 'duplex-long-edge', 'psc111'),
    ('psc111-sx', 'duplex-short-edge', 'psc111'),
    ('psc111', 'simplex', 'psc111-sx'),
    ('cptsc', 'duplex-short-edge', 'cptsc-dx'),
    ('cptsc-dx', 'simplex', 'cptsc'),
    ('cptsc-a3-dx', 'simplex', 'cptsc-a3'),
    ('psts-sx', 'duplex-long-edge', 'psts-dx'),
    ('pstsb', 'simplex', 'pstb-sx'),
    ('psts-nb', 'simplex', 'psts-nb'),
    ('unlisted-printer', 'simplex', 'unlisted-printer'),
])
def test_physical_printer_queue_variants(queue, mode, expected):
    assert adjusted_queue_for_duplex(queue, mode) == expected


def test_packaged_routes_match_the_canonical_catalogue():
    root = Path(__file__).resolve().parents[3]
    script = root / 'scripts/printer_catalog.py'
    if not script.exists():
        pytest.skip('Catalogue projection is checked in the source checkout')
    generate = runpy.run_path(str(script))['render']
    packaged = Path(print_at_soc.__file__).with_name('queue-routing.json')
    assert packaged.read_text() == generate()
    assert isinstance(json.loads(packaged.read_text()), dict)
