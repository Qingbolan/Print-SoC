import json
from unittest.mock import Mock
import pytest
from print_at_soc.account import AccountStore
from print_at_soc import virtual_printer as vp

def test_identity_tombstone_and_credential_key(tmp_path):
    store = AccountStore(tmp_path)
    with pytest.raises(RuntimeError, match='desktop|Print@SoC'):
        store.identity()
    store.path.write_text('null')
    with pytest.raises(RuntimeError, match='No shared account'):
        store.identity()
    identity = {'host': 'STU.COMP.NUS.EDU.SG', 'port': 22, 'username': 'test-user'}
    store.path.write_text(json.dumps(identity))
    assert store.identity() == identity
    assert store.key(identity) == '["stu.comp.nus.edu.sg",22,"test-user"]'


def test_legacy_cli_identity_and_password_are_not_imported(monkeypatch, tmp_path):
    legacy = tmp_path / 'old.json'
    legacy.write_text(json.dumps({'ssh': {'username': 'old-cli-user', 'password': 'old-secret'}, 'print': {'printer': 'psc008'}}))
    monkeypatch.setattr(vp, 'user_config_path', lambda: legacy)
    monkeypatch.setattr(vp, '_env_config', lambda: {})
    monkeypatch.setattr(AccountStore, '__init__', lambda self: setattr(self, 'path', tmp_path / 'absent.json'))
    result = vp.load_config()
    assert result['ssh']['username'] == ''
    assert result['ssh']['password'] == ''
    assert result['print']['printer'] == 'psc008'


def test_cli_explicit_account_edit_uses_same_secret_store_and_identity(monkeypatch, tmp_path):
    import keyring
    import sys
    from pathlib import Path
    secrets = {}
    monkeypatch.setattr(keyring, 'get_password', lambda service, key: secrets.get((service, key)))
    monkeypatch.setattr(keyring, 'set_password', lambda service, key, password: secrets.__setitem__((service, key), password))
    monkeypatch.setattr(keyring, 'delete_password', lambda service, key: secrets.pop((service, key), None))
    store = AccountStore(tmp_path)
    old = {'host': 'stu.comp.nus.edu.sg', 'port': 22, 'username': 'first'}
    store.path.write_text(json.dumps(old))
    new = {**old, 'username': 'second'}
    store.save(new, 'test-only-password')
    assert store.identity()['username'] == 'second'
    assert store.identity()['auth_type'] == {'type': 'StoredPassword'}
    assert 'test-only-password' not in store.path.read_text()
    if sys.platform != 'win32':
        assert store.path.stat().st_mode & 0o777 == 0o600
    snapshot = dict(secrets)
    monkeypatch.setattr(Path, 'replace', Mock(side_effect=OSError('disk unavailable')))
    with pytest.raises(OSError, match='disk unavailable'):
        store.save({**new, 'username': 'third'}, 'must-rollback')
    assert secrets == snapshot
    assert store.identity()['username'] == 'second'


def test_replacing_missing_password_does_not_first_read_old_keyring(monkeypatch):
    from argparse import Namespace
    seen = []
    def load(**kwargs):
        seen.append(kwargs['resolve_credentials'])
        return json.loads(json.dumps(vp.DEFAULT_CONFIG))
    monkeypatch.setattr(vp, 'load_config', load)
    monkeypatch.setattr(vp.getpass, 'getpass', lambda _: 'new-fixture-password')
    args = Namespace(ask_password=True, dry_run=False)
    assert vp._build_config_from_args(args)['ssh']['password'] == 'new-fixture-password'
    assert seen == [False]
    monkeypatch.setattr(vp.getpass, 'getpass', Mock(side_effect=AssertionError('dry run prompted')))
    args.dry_run = True
    assert vp._build_config_from_args(args)['ssh']['password'] == ''
