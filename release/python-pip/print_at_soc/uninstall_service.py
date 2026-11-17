"""Ownership-scoped removal of the desktop, print service and optional user data."""
from __future__ import annotations

import csv
from dataclasses import dataclass
import os
from pathlib import Path
import platform
import re
import shutil
import subprocess
from typing import List, Optional

from .config import INSTALL_DIR

APP_ID = "tech.silan.PrintAtSoC"
CREDENTIAL_SERVICE = APP_ID + ".ssh"


@dataclass(frozen=True)
class RemovalItem:
    label: str
    path: Optional[Path]
    kind: str


class UninstallService:
    """Build and execute the same finite removal inventory; never delete a home tree."""

    RUNTIME_NAMES = (
        "bin", "version.txt", "receipt.json", ".previous", ".update-backup",
        ".update-transaction.json", "win_postinstall_done", "native-runtime", "native-service.json",
    )

    def __init__(self, root: Path = INSTALL_DIR):
        self.root = Path(root).absolute()
        self.home = Path.home().resolve()
        self.system = platform.system()
        if self.root in {self.home, Path(self.root.anchor)}:
            raise RuntimeError("The installation directory cannot be a home or filesystem root")

    def _user_data_paths(self) -> List[Path]:
        if self.system == "Darwin":
            return [
                self.home / "Library/Application Support" / APP_ID,
                self.home / "Library/Caches" / APP_ID,
                self.home / "Library/WebKit" / APP_ID,
                self.home / "Library/Preferences" / (APP_ID + ".plist"),
                self.home / "Library/Saved Application State" / (APP_ID + ".savedState"),
            ]
        if self.system == "Linux":
            return [
                Path(os.environ.get("XDG_DATA_HOME", str(self.home / ".local/share"))) / APP_ID,
                Path(os.environ.get("XDG_CONFIG_HOME", str(self.home / ".config"))) / APP_ID,
                Path(os.environ.get("XDG_CACHE_HOME", str(self.home / ".cache"))) / APP_ID,
            ]
        if self.system == "Windows":
            return [Path(os.environ.get("APPDATA", str(self.home / "AppData/Roaming"))) / APP_ID,
                    Path(os.environ.get("LOCALAPPDATA", str(self.home / "AppData/Local"))) / APP_ID]
        raise RuntimeError("Uninstall supports macOS, Linux and Windows only")

    def _check_path(self, path: Path, *, root_child: bool = False) -> None:
        if not path.is_absolute() or path == Path(path.anchor) or path == self.home:
            raise RuntimeError(f"Refusing unsafe cleanup path: {path}")
        # Unlinking a final symlink is safe; following an ancestor is not.
        anchor = self.root if root_child else self.home
        if root_child and self.root.is_symlink():
            raise RuntimeError(f"Installation directory is a symlink: {self.root}; remove it manually")
        if path.is_relative_to(anchor) if hasattr(path, 'is_relative_to') else anchor in path.parents:
            cursor = path.parent
            while cursor != anchor and cursor != cursor.parent:
                if cursor.is_symlink():
                    raise RuntimeError(f"Cleanup path traverses a symlink: {cursor}")
                cursor = cursor.parent
        elif not root_child:
            # XDG data roots outside home are supported only if their existing
            # ancestors do not redirect the app-specific directory.
            cursor = path.parent
            while cursor != cursor.parent:
                if cursor.is_symlink():
                    raise RuntimeError(f"Cleanup path traverses a symlink: {cursor}")
                cursor = cursor.parent

    def _cups_inventory(self, purge: bool) -> List[RemovalItem]:
        if self.system not in {"Darwin", "Linux"}:
            return []
        from . import virtual_printer as vp
        backend = vp.backend_path()
        paths = [backend, vp.RUNTIME_DIR]
        paths.extend([vp.SYSTEM_CONFIG_PATH, vp.STATUS_PATH, vp.SYSTEM_CONFIG_DIR / "ssh_key", vp.SYSTEM_CONFIG_DIR / "native.conf"])
        if not shutil.which("lpstat"):
            if any(path.exists() for path in paths):
                raise RuntimeError("CUPS files are installed but lpstat is missing. Restore CUPS tools before uninstalling.")
            return []
        devices = vp._cups_devices()
        queues = [RemovalItem(name, None, "cups-queue") for name, uri in devices.items()
                  if uri.startswith(vp.BACKEND_NAME + ":")]
        for path in paths:
            cursor = path.parent
            while cursor != cursor.parent:
                if cursor.is_symlink() and cursor not in {Path("/etc"), Path("/var"), Path("/tmp")}:
                    raise RuntimeError(f"System print service path traverses a symlink: {cursor}")
                cursor = cursor.parent
        return queues + [RemovalItem("System print service", path, "system-path") for path in paths
                         if path.exists() or path.is_symlink()]

    def plan(self, purge: bool) -> List[RemovalItem]:
        """Read-only inventory. Credential values are never read for preview."""
        self._check_path(self.root / "bin", root_child=True)
        items = []
        for name in self.RUNTIME_NAMES:
            path = self.root / name
            self._check_path(path, root_child=True)
            if path.exists() or path.is_symlink():
                items.append(RemovalItem("Desktop installation and update state", path, "path"))
        if self.root.is_dir():
            for path in self.root.glob(".update-stage-*"):
                self._check_path(path, root_child=True)
                items.append(RemovalItem("Incomplete update download", path, "path"))
        items.extend(self._cups_inventory(purge))
        if self.system in {'Darwin', 'Linux'}:
            from .native_driver import service_path
            agent = service_path(self.home, self.system)
            self._check_path(agent)
            if agent.exists() or (self.home / '.PrintAtSoC/native-service.json').exists():
                items.append(RemovalItem('User print forwarding service', agent, 'relay'))
        if self.system == "Windows":
            uninstallers = self._windows_uninstallers()
            if not uninstallers:
                from .downloader import _find_windows_installed_exe
                if _find_windows_installed_exe() is not None:
                    raise RuntimeError("A Windows desktop installation exists without a supported uninstall registration. Repair/remove it through Installed apps before continuing.")
            for command in uninstallers:
                items.append(RemovalItem("Registered Windows desktop installation", Path(command[0]), "native-uninstall"))
        if purge:
            for path in [self.root / "virtual-printer.json", self.root / "maintenance.json", self.home / ".PrintAtSoC/account.json"] + self._user_data_paths():
                self._check_path(path, root_child=path.parent == self.root)
                if path.exists() or path.is_symlink():
                    items.append(RemovalItem("Saved settings, history and cached document copies", path, "path"))
            items.append(RemovalItem("OS credentials: " + CREDENTIAL_SERVICE, None, "credentials"))
        return items

    def _assert_idle(self, items: List[RemovalItem]) -> None:
        if self.system == "Windows":
            result = subprocess.run(["tasklist", "/FO", "CSV", "/NH"], capture_output=True, text=True, check=True)
            running = any(row and row[0].lower() == "print_at_soc.exe" for row in csv.reader(result.stdout.splitlines()))
        else:
            result = subprocess.run(["ps", "-axo", "args="], capture_output=True, text=True, check=True)
            running = any(re.search(r"(?:^|/)(?:Print_at_SoC|print_at_soc|print-at-soc)(?:\s|$)", line)
                          and "--native-print-service" not in line.split() for line in result.stdout.splitlines())
        if running:
            raise RuntimeError("Print@SoC is running. Close the desktop application and finish active jobs before uninstalling.")
        from . import virtual_printer as vp
        for item in items:
            if item.kind == "cups-queue":
                result = vp._run_command([shutil.which("lpstat") or "lpstat", "-o", item.label])
                if result.stdout.strip():
                    raise RuntimeError(f"Queue {item.label} still has pending jobs. Complete or explicitly cancel them before uninstalling.")

    def execute(self, purge: bool, non_interactive: bool = False) -> None:
        from .update_service import MaintenanceLock, UpdateService
        from . import virtual_printer as vp
        self._check_path(self.root / "bin", root_child=True)
        with MaintenanceLock(self.root):
            items = self.plan(purge)
            self._assert_idle(items)
            native_removed = False
            if (self.root / ".update-transaction.json").exists():
                updater = UpdateService(self.root)
                updater._validate_managed_paths()
                transaction = updater._read_journal()
                # A failed first native installation has no prior installer to
                # restore. Remove its registered partial app before recovering
                # local files; preserve existing-install rollback ordering.
                if (self.system == "Windows" and transaction.get("windows")
                        and transaction["state"] == "committing"
                        and transaction.get("had_native", transaction["had_old"]) is False):
                    self._uninstall_windows(non_interactive)
                    native_removed = True
                updater._recover_locked()
                items = self.plan(purge)
            system_items = [item for item in items if item.kind in {"cups-queue", "system-path"}]
            if system_items and vp._sudo_prefix():
                if non_interactive:
                    result = vp._run_command(["sudo", "-n", "-v"], check=False)
                    if result.returncode:
                        raise RuntimeError("Administrator access is required. Run sudo -v in your terminal and retry.")
                else:
                    vp._authorize_system_changes()
            shared_service_checked = False
            for item in system_items:
                if item.kind == "cups-queue":
                    current = vp._cups_devices().get(item.label)
                    if current is None:
                        continue
                    if not current.startswith(vp.BACKEND_NAME + ":"):
                        raise RuntimeError(f"Queue {item.label} changed ownership; cleanup stopped")
                    vp._run_command(vp._sudo_prefix() + [shutil.which("lpadmin") or "lpadmin", "-x", item.label])
                else:
                    if not shared_service_checked:
                        if any(uri.startswith(vp.BACKEND_NAME + ":") for uri in vp._cups_devices().values()):
                            raise RuntimeError("A Print@SoC queue remains or was added during cleanup. Shared print service files were retained; retry uninstall.")
                        shared_service_checked = True
                    # These exact paths belong to this package. rm does not
                    # follow the final symlink; no arbitrary paths are accepted.
                    vp._run_command(vp._sudo_prefix() + ["rm", "-rf", str(item.path)])
            if purge and system_items:
                vp._run_command(vp._sudo_prefix() + ["rmdir", str(vp.SYSTEM_CONFIG_DIR)], check=False)
            if any(item.kind == 'relay' for item in items):
                from .native_driver import stop_service
                stop_service(self.home, self.system)
            if self.system == "Windows" and not native_removed:
                self._uninstall_windows(non_interactive)
            # Keep local configuration available for recovery when the password
            # store is locked. The operation is service-scoped and idempotent.
            if purge:
                self._clear_credentials()
            for item in items:
                if item.kind == "path":
                    self._remove_path(item.path)
            # Do not unlink the live maintenance lock: replacing its inode lets
            # another maintenance process acquire a different lock concurrently.

    def _remove_path(self, path: Path) -> None:
        self._check_path(path, root_child=path.parent == self.root)
        if path.is_symlink():
            path.unlink()
        elif path.is_dir():
            shutil.rmtree(path)
        elif path.exists():
            path.unlink()

    def _clear_credentials(self) -> None:
        try:
            if self.system == "Darwin":
                # security deletes one matching item at a time, without exposing
                # the password. errSecItemNotFound is the only accepted stop.
                while True:
                    result = subprocess.run(["security", "delete-generic-password", "-s", CREDENTIAL_SERVICE],
                                            capture_output=True, text=True, check=False)
                    if result.returncode == 44:
                        return
                    if result.returncode:
                        raise RuntimeError("Unlock the login keychain, then retry purge; credential removal was denied.")
            elif self.system == "Linux":
                import secretstorage
                connection = secretstorage.dbus_init()
                try:
                    items = list(secretstorage.search_items(connection, {"service": CREDENTIAL_SERVICE}))
                    if any(item.is_locked() for item in items):
                        raise RuntimeError("Unlock the system password store before purging Print@SoC credentials.")
                    for item in items:
                        if item.get_attributes().get("service") == CREDENTIAL_SERVICE:
                            item.delete()
                finally:
                    connection.close()
            elif self.system == "Windows":
                self._clear_windows_credentials()
        except RuntimeError:
            raise
        except Exception as error:
            raise RuntimeError("Could not remove Print@SoC credentials. Unlock the system password store and retry; cleanup is incomplete.") from error

    @staticmethod
    def _clear_windows_credentials():
        import ctypes
        from ctypes import wintypes
        class Credential(ctypes.Structure):
            _fields_ = [("Flags", wintypes.DWORD), ("Type", wintypes.DWORD),
                        ("TargetName", wintypes.LPWSTR), ("Comment", wintypes.LPWSTR),
                        ("LastWritten", wintypes.FILETIME), ("CredentialBlobSize", wintypes.DWORD),
                        ("CredentialBlob", ctypes.c_void_p), ("Persist", wintypes.DWORD),
                        ("AttributeCount", wintypes.DWORD), ("Attributes", ctypes.c_void_p),
                        ("TargetAlias", wintypes.LPWSTR), ("UserName", wintypes.LPWSTR)]
        library = ctypes.WinDLL("Advapi32.dll", use_last_error=True)
        pointer = ctypes.POINTER(Credential)
        credentials = ctypes.POINTER(pointer)()
        count = wintypes.DWORD()
        library.CredEnumerateW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, ctypes.POINTER(wintypes.DWORD), ctypes.POINTER(ctypes.POINTER(pointer))]
        library.CredEnumerateW.restype = wintypes.BOOL
        library.CredDeleteW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD]
        library.CredDeleteW.restype = wintypes.BOOL
        library.CredFree.argtypes = [ctypes.c_void_p]
        if not library.CredEnumerateW(None, 0, ctypes.byref(count), ctypes.byref(credentials)):
            if ctypes.get_last_error() == 1168:
                return
            raise ctypes.WinError(ctypes.get_last_error())
        try:
            for index in range(count.value):
                credential = credentials[index].contents
                if credential.Type == 1 and credential.TargetName.endswith("." + CREDENTIAL_SERVICE):
                    if not library.CredDeleteW(credential.TargetName, 1, 0):
                        raise ctypes.WinError(ctypes.get_last_error())
        finally:
            library.CredFree(credentials)

    @staticmethod
    def _windows_uninstallers():
        import winreg
        commands = []
        for hive in (winreg.HKEY_CURRENT_USER, winreg.HKEY_LOCAL_MACHINE):
            for subkey in (r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall", r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall"):
                try:
                    parent = winreg.OpenKey(hive, subkey)
                except FileNotFoundError:
                    continue
                with parent:
                    for index in range(winreg.QueryInfoKey(parent)[0]):
                        with winreg.OpenKey(parent, winreg.EnumKey(parent, index)) as entry:
                            try:
                                name = winreg.QueryValueEx(entry, "DisplayName")[0]
                            except FileNotFoundError:
                                continue
                            if name not in {"Print_at_SoC", "Print@SoC"}:
                                continue
                            try:
                                command = winreg.QueryValueEx(entry, "UninstallString")[0]
                            except FileNotFoundError as error:
                                raise RuntimeError("Print@SoC has no registered Windows uninstall command; repair its installer first.") from error
                            commands.append(UninstallService._parse_windows_uninstaller(command))
        return commands

    @staticmethod
    def _parse_windows_uninstaller(command):
        import ctypes
        from ctypes import wintypes
        count = ctypes.c_int()
        shell = ctypes.WinDLL("shell32", use_last_error=True)
        shell.CommandLineToArgvW.argtypes = [wintypes.LPCWSTR, ctypes.POINTER(ctypes.c_int)]
        shell.CommandLineToArgvW.restype = ctypes.POINTER(wintypes.LPWSTR)
        pointer = shell.CommandLineToArgvW(command, ctypes.byref(count))
        if not pointer:
            raise ctypes.WinError(ctypes.get_last_error())
        try:
            parts = [pointer[index] for index in range(count.value)]
        finally:
            kernel = ctypes.WinDLL("kernel32")
            kernel.LocalFree.argtypes = [ctypes.c_void_p]
            kernel.LocalFree(pointer)
        if not parts:
            raise RuntimeError("Empty Windows uninstall command")
        if Path(parts[0]).name.lower() in {"msiexec", "msiexec.exe"}:
            match = re.search(r"\{[0-9a-fA-F-]{36}\}", command)
            if not match:
                raise RuntimeError("Invalid registered MSI product identity")
            return ["msiexec", "/x", match.group()]
        executable = Path(parts[0])
        if not executable.is_absolute() or executable.name.lower() not in {"uninstall.exe", "unins000.exe"} or not executable.is_file():
            raise RuntimeError("Unsupported registered Windows uninstaller. Use Windows Installed apps, then retry cleanup.")
        return [str(executable)]

    def _uninstall_windows(self, non_interactive):
        for command in self._windows_uninstallers():
            args = list(command)
            if Path(args[0]).name.lower().startswith("msiexec"):
                args.extend(["/quiet", "/norestart"] if non_interactive else ["/norestart"])
            elif non_interactive:
                args.append("/S")
            result = subprocess.run(args, check=False)
            if result.returncode not in {0, 1605, 3010}:
                raise RuntimeError(f"Windows uninstall failed ({result.returncode}); cleanup is incomplete.")
        # App Paths entries are package-specific. Never remove Python's shared
        # Scripts directory from PATH; other installed commands still need it.
        import winreg
        from .cli import _win_get_scripts_dirs
        directories = _win_get_scripts_dirs()
        for name in ("print-at-soc.exe", "print_at_soc.exe", "print-soc.exe", "psoc.exe"):
            key = rf"Software\Microsoft\Windows\CurrentVersion\App Paths\{name}"
            try:
                with winreg.OpenKey(winreg.HKEY_CURRENT_USER, key) as entry:
                    target = str(winreg.QueryValueEx(entry, None)[0]).strip('"').lower()
                expected = {str(directory / name).lower() for directory in directories if directory}
                if target in expected:
                    winreg.DeleteKey(winreg.HKEY_CURRENT_USER, key)
            except FileNotFoundError:
                pass
