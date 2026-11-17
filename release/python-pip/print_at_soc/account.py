"""Shared desktop/CLI account identity and native credential-store access."""
import json
from pathlib import Path
import sys

SERVICE = 'tech.silan.PrintAtSoC.ssh'

class AccountStore:
    def __init__(self, root=None):
        self.path = Path(root or Path.home() / '.PrintAtSoC') / 'account.json'

    @staticmethod
    def key(identity):
        return json.dumps([identity['host'].lower(), int(identity['port']), identity['username']], ensure_ascii=False, separators=(',', ':'))

    def identity(self):
        if not self.path.exists():
            raise RuntimeError('Open Print@SoC and save your account first. Legacy CLI credentials are not imported.')
        identity = json.loads(self.path.read_text())
        if not isinstance(identity, dict):
            raise RuntimeError('No shared account is saved. Save your account in desktop Settings.')
        if not identity.get('host') or not identity.get('username') or not 1 <= int(identity.get('port', 0)) <= 65535:
            raise RuntimeError('Shared account identity is invalid. Save the account again in Settings.')
        return identity

    def password(self, identity):
        key = self.key(identity)
        if sys.platform.startswith('linux'):
            import secretstorage
            bus = secretstorage.dbus_init()
            items = list(secretstorage.search_items(bus, {'service': SERVICE, 'username': key}))
            if len(items) != 1:
                raise RuntimeError('Saved password is missing or ambiguous. Save it again in the desktop app.')
            if items[0].is_locked():
                items[0].unlock()
            return items[0].get_secret().decode('utf-8')
        import keyring
        service = key + '.' + SERVICE if sys.platform == 'win32' else SERVICE
        password = keyring.get_password(service, key)
        if password is None:
            raise RuntimeError('Saved password unavailable. Unlock your credential store or save the account in the desktop app.')
        return password

    def ssh(self):
        identity = self.identity()
        return {**{key: identity[key] for key in ('host', 'port', 'username')},
                'password': self.password(identity), 'key_path': '', 'key_passphrase': ''}

    def save(self, identity, password):
        """Explicit CLI edits update the same native identity and password store."""
        import os
        import tempfile
        import keyring
        previous = self.identity()  # Only the desktop can migrate an existing account.
        if not password or not identity.get('host') or not identity.get('username'):
            raise RuntimeError('A server, username and password are required')
        if not 1 <= int(identity.get('port', 0)) <= 65535:
            raise RuntimeError('Invalid server port')
        identity = {key: identity[key] for key in ('host', 'port', 'username')}
        identity['auth_type'] = {'type': 'StoredPassword'}
        key = self.key(identity)
        service = key + '.' + SERVICE if sys.platform == 'win32' else SERVICE
        prior_password = keyring.get_password(service, key)
        keyring.set_password(service, key, password)
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(mode='w', dir=self.path.parent, delete=False) as stream:
                temporary = Path(stream.name)
                json.dump(identity, stream)
                stream.flush()
                os.fsync(stream.fileno())
            temporary.replace(self.path)
        except Exception:
            if prior_password is None:
                keyring.delete_password(service, key)
            else:
                keyring.set_password(service, key, prior_password)
            raise
        finally:
            if temporary is not None:
                temporary.unlink(missing_ok=True)
        if self.key(previous) != key:
            old_key = self.key(previous)
            old_service = old_key + '.' + SERVICE if sys.platform == 'win32' else SERVICE
            if keyring.get_password(old_service, old_key) is not None:
                keyring.delete_password(old_service, old_key)
