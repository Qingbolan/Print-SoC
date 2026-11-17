#!/usr/bin/env python3
"""Exercise the real stdio server in an isolated home. Never contacts SoC or prints."""
import argparse
import struct
import zlib
import json
import os
from pathlib import Path
import subprocess
import tempfile


class Client:
    def __init__(self, binary, home):
        env = {k: v for k, v in os.environ.items() if not k.startswith('PSOC_SSH_')}
        env.update(HOME=str(home), XDG_DATA_HOME=str(home / 'data'), APPDATA=str(home / 'data'))
        self.log = tempfile.TemporaryFile()
        self.process = subprocess.Popen([str(binary), '--mcp'], env=env, stdin=subprocess.PIPE,
                                        stdout=subprocess.PIPE, stderr=self.log, text=True)
        self.serial = 0
        self.request('initialize', {'protocolVersion': '2025-06-18'})

    def request(self, method, params):
        self.serial += 1
        self.process.stdin.write(json.dumps({'jsonrpc': '2.0', 'id': self.serial, 'method': method, 'params': params}) + '\n')
        self.process.stdin.flush()
        response = json.loads(self.process.stdout.readline())
        assert response.get('id') == self.serial, response
        assert 'error' not in response, response
        return response['result']

    def tool(self, name, args=None, error=False):
        response = self.request('tools/call', {'name': name, 'arguments': args or {}})
        assert bool(response.get('isError')) == error, response
        return response if error else response['structuredContent']

    def close(self):
        self.process.stdin.close()
        self.process.wait(timeout=10)
        self.process.stdout.close()
        self.log.close()
        assert self.process.returncode == 0


def verify(binary, require_layout):
    with tempfile.TemporaryDirectory(prefix='print-soc-agent-') as directory:
        home = Path(directory)
        client = Client(binary, home)
        peer = None
        try:
            names = [t['name'] for t in client.request('tools/list', {})['tools']]
            assert len(names) == len(set(names)) == 22, names
            assert client.tool('get_saved_account')['account'] is None
            assert client.tool('list_print_jobs')['jobs'] == []
            assert client.tool('system_printer_status')['configured'] is False
            client.tool('submit_print_job', {'job_id': 'not-a-job', 'confirm': False}, error=True)
            client.tool('find_printers', error=True)
            client.tool('connect_ssh', error=True)
            # A static PNG fixture; conversion exercises the Rust path without a host converter.
            image = home / 'one.png'
            def chunk(kind, data):
                return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data))
            image.write_bytes(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', 2, 1, 8, 2, 0, 0, 0))
                              + chunk(b'IDAT', zlib.compress(b'\x00\xff\x00\x00\x00\x00\xff')) + chunk(b'IEND', b''))
            converted = client.tool('prepare_document', {'file_path': str(image)})
            assert Path(converted['path']).read_bytes().startswith(b'%PDF')

            # Copy a public repository example, never a user's document.
            source = home / 'source.pdf'
            source.write_bytes((Path(__file__).resolve().parents[1] / 'docs/examples/print-guide.pdf').read_bytes())
            first = client.tool('prepare_print_job', {'file_path': str(source), 'printer': 'psts-dx',
                'duplex': 'duplex_short_edge', 'page_range': {'type': 'Range', 'start': 1, 'end': 1},
                'color_mode': 'monochrome', 'scaling': 'actual_size'})
            job = first['job']
            assert job['status'] == 'Pending' and job['settings']['scaling'] == 'ActualSize'
            assert Path(job['file_path']).is_relative_to(home), 'Isolation failed'
            if require_layout:
                assert 'preview' in first, first
                assert first['preview']['info']['num_pages'] == 1
            assert Path(job['file_path']).read_bytes() == source.read_bytes()
            source.write_bytes(b'changed source after preparation')
            assert Path(job['file_path']).read_bytes() != source.read_bytes()
            peer = Client(binary, home)
            assert peer.tool('get_print_job', {'job_id': job['id']})['status'] == 'Pending'
            peer.tool('cancel_print_job', {'job_id': job['id'], 'confirm': True})
            assert client.tool('get_print_job', {'job_id': job['id']})['status'] == 'Cancelled'
            client.tool('submit_print_job', {'job_id': job['id'], 'confirm': True}, error=True)
            second = client.tool('prepare_print_job', {'file_path': job['file_path'], 'printer': 'psts-dx'})
            assert client.tool('list_print_jobs')['jobs'][0]['id'] == second['job']['id']
            client.tool('prepare_print_job', {'file_path': job['file_path'], 'printer': 'psts-dx', 'color_mode': 'color'}, error=True)
            client.tool('prepare_print_job', {'file_path': job['file_path'], 'printer': 'psts-dx', 'pages_per_sheet': 3}, error=True)
            client.tool('prepare_document', {'file_path': str(home / 'missing.pptx')}, error=True)
            client.tool('configure_system_printer', {'printer': 'psts-dx', 'dry_run': False, 'confirm': False}, error=True)
            # Simulate a crashed worker in this isolated store. A live lease
            # must prevent another process from recovering it as interrupted.
            if os.name == 'posix':
                import fcntl
                import uuid
                store = Path(job['file_path']).parents[2] / 'native-jobs'
                running = dict(second['job'], id=str(uuid.uuid4()), status='Uploading',
                               progress={'stage': 'Uploading', 'bytes_sent': 0, 'total_bytes': 100})
                (store / (running['id'] + '.json')).write_text(json.dumps(running))
                with (store / (running['id'] + '.worker')).open('w') as lease:
                    fcntl.flock(lease, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    probe = Client(binary, home)
                    try:
                        assert probe.tool('get_print_job', {'job_id': running['id']})['status'] == 'Uploading'
                    finally:
                        probe.close()
                probe = Client(binary, home)
                try:
                    assert probe.tool('get_print_job', {'job_id': running['id']})['status'] == 'Failed'
                finally:
                    probe.close()
                legacy = dict(second['job'], id=str(uuid.uuid4()))
                history = store.parent / 'history' / 'print_jobs.json'
                history.write_text(json.dumps([legacy]))
                probe = Client(binary, home)
                try:
                    assert probe.tool('get_print_job', {'job_id': legacy['id']})['status'] == 'Pending'
                    assert not history.exists()
                    assert history.with_suffix('.migrated.json').exists()
                finally:
                    probe.close()
            print('PASS: 22 tools; isolated account; durable preparation; preview; cross-process history/cancellation; refusal of unsafe submissions.')
        finally:
            if peer:
                peer.close()
            client.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('binary', type=Path)
    parser.add_argument('--require-layout', action='store_true', help='Require installed pdfjam and a generated preview')
    args = parser.parse_args()
    verify(args.binary.resolve(), args.require_layout)
