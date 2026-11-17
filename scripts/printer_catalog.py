#!/usr/bin/env python3
"""Project the shared printer catalogue into the routing table used by Rust and pip."""
import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / 'release/python-pip/print_at_soc/queue-routing.json'


def render():
    printers = json.loads((ROOT / 'app/shared/printers.json').read_text())
    aliases = json.loads((ROOT / 'app/shared/printer-aliases.json').read_text())
    routes = {}
    for printer in printers:
        group = [p for p in printers if p['group_id'] == printer['group_id']]
        choices = {}
        for mode, variant in [('simplex', 'sx'), ('duplex', 'dx')]:
            if printer['variant'] == 'nb':
                choices[mode] = printer['queue_name']
                continue
            eligible = [p for p in group if mode == 'simplex' or p['supports_duplex']]
            target = next((p for p in eligible if p['variant'] == variant), None)
            if target is None:
                target = next((p for p in eligible if p['variant'] == 'main'), None)
            choices[mode] = target['queue_name'] if target else None
        routes[printer['queue_name']] = choices
    for alias, target in aliases.items():
        routes[alias] = routes[target]
    return json.dumps(routes, indent=2, sort_keys=True) + '\n'


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    expected = render()
    if args.check:
        if not TARGET.exists() or TARGET.read_text() != expected:
            raise SystemExit('Stale queue routing. Run python3 scripts/printer_catalog.py')
    else:
        TARGET.write_text(expected)
