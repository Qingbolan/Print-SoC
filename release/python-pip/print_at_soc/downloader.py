"""Binary downloader for Print@SoC"""

import os
import platform
import subprocess
from pathlib import Path
from typing import Optional

from .config import (
    BINARY_DIR,
    VERSION_FILE,
    PLATFORM_BINARIES,
)


def _find_macos_app_binary(base_dir: Path) -> Optional[Path]:
    """Best-effort search for the executable inside any .app bundle."""
    try:
        for app_dir in base_dir.rglob("*.app"):
            macos_dir = app_dir / "Contents" / "MacOS"
            if macos_dir.is_dir():
                executables = []
                others = []
                for child in macos_dir.iterdir():
                    if child.is_file():
                        mode = child.stat().st_mode
                        if mode & 0o111:
                            executables.append(child)
                        else:
                            others.append(child)
                if executables:
                    return executables[0]
                if others:
                    return others[0]
    except Exception:
        pass
    return None


def get_platform_key() -> str:
    """Get the platform key for current system"""
    system = platform.system().lower()
    machine = platform.machine().lower()

    if machine in ("x86_64", "amd64"):
        machine = "x86_64"
    elif machine in ("aarch64", "arm64"):
        machine = "arm64"

    platform_key = f"{system}_{machine}"

    platform_map = {
        "darwin_arm64": "darwin_arm64",
        "darwin_x86_64": "darwin_x86_64",
        "linux_x86_64": "linux_x86_64",
        "windows_x86_64": "windows_x86_64"
    }

    if platform_key not in platform_map:
        raise RuntimeError(
            f"Unsupported platform: {system} {machine}\n"
            f"Supported platforms: macOS (Intel/ARM), Windows (x64), Linux (x64)"
        )

    return platform_map[platform_key]


def get_binary_path() -> Path:
    """Get the path to the executable for current platform."""
    platform_key = get_platform_key()
    config = PLATFORM_BINARIES[platform_key]

    expected_path = BINARY_DIR / config["executable_path"]

    if config["is_bundle"]:
        if expected_path.exists():
            return expected_path

        discovered = _find_macos_app_binary(BINARY_DIR)
        if discovered is not None:
            return discovered

        return expected_path

    if platform_key == "windows_x86_64":
        discovered_win = _find_windows_installed_exe()
        if discovered_win is not None:
            return discovered_win
    return expected_path


def is_installed() -> bool:
    """Check if binary is already installed."""
    try:
        binary_path = get_binary_path()
        if binary_path.exists() and binary_path.is_file():
            return True

        platform_key = get_platform_key()
        if PLATFORM_BINARIES[platform_key]["is_bundle"]:
            discovered = _find_macos_app_binary(BINARY_DIR)
            return discovered is not None and discovered.exists()
        if platform_key == "windows_x86_64":
            exe = _find_windows_installed_exe()
            return exe is not None and exe.exists()

        return False
    except Exception:
        return False


def get_installed_version() -> Optional[str]:
    """Get the currently installed version"""
    if VERSION_FILE.exists():
        return VERSION_FILE.read_text().strip()
    return None


def _run_nsis_installer(installer_path: Path) -> None:
    """Run NSIS installer."""
    if platform.system() != "Windows":
        return

    print("\n" + "="*60)
    print("Running Windows installer...")
    print("="*60)
    print("\nNOTE: The installer will:")
    print("  1. Check if Print@SoC is already installed")
    print("  2. If installed, offer to launch it or reinstall")
    print("  3. If not installed, proceed with installation")
    print("\nPlease follow the installer prompts.")
    print("="*60 + "\n")

    subprocess.run([str(installer_path)], check=True)
    print("\nInstaller completed.")


def _find_windows_installed_exe(product_name: str = "Print_at_SoC",
                                 exe_name: str = "Print_at_SoC.exe") -> Optional[Path]:
    """Try to discover installed Windows executable location."""
    if platform.system() != "Windows":
        return None

    try:
        import winreg

        def _scan_hive(root):
            subkeys = [
                r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall",
                r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall",
            ]
            for sub in subkeys:
                try:
                    with winreg.OpenKey(root, sub) as hkey:
                        for i in range(0, winreg.QueryInfoKey(hkey)[0]):
                            skn = winreg.EnumKey(hkey, i)
                            with winreg.OpenKey(hkey, skn) as sk:
                                try:
                                    name, _ = winreg.QueryValueEx(sk, "DisplayName")
                                except Exception:
                                    name = ""
                                if not name or product_name.lower() not in name.lower():
                                    continue
                                path_val = None
                                for valname in ("InstallLocation", "DisplayIcon"):
                                    try:
                                        v, _ = winreg.QueryValueEx(sk, valname)
                                        if v:
                                            path_val = v
                                            break
                                    except Exception:
                                        pass
                                if path_val:
                                    path_text = str(path_val).split(",")[0]
                                    p = Path(path_text)
                                    if p.is_file():
                                        return p
                                    if p.is_dir():
                                        cand = p / exe_name
                                        if cand.exists():
                                            return cand
                except Exception:
                    continue
            return None

        for hive in (winreg.HKEY_CURRENT_USER, winreg.HKEY_LOCAL_MACHINE):
            found = _scan_hive(hive)
            if found:
                return found
    except Exception:
        pass

    candidates = []
    for env_var in ("ProgramFiles", "ProgramFiles(x86)"):
        base = os.environ.get(env_var)
        if base:
            candidates.append(Path(base) / product_name / exe_name)
    local_app = os.environ.get("LOCALAPPDATA")
    if local_app:
        candidates.append(Path(local_app) / "Programs" / product_name / exe_name)

    for cand in candidates:
        if cand.exists():
            return cand

    return None


def _install_msi(msi_path: Path) -> None:
    """Install an MSI package using msiexec."""
    if platform.system() != "Windows":
        return
    result = subprocess.run(["msiexec", "/i", str(msi_path)], check=False)
    if result.returncode not in (0, 1641, 3010):
        raise RuntimeError(f"MSI installation failed with exit code {result.returncode}")


def download_and_install():
    """Install or repair through the shared verified transaction engine."""
    from .maintenance import maintenance_cli
    code = maintenance_cli(["update", "--force"])
    if code:
        raise RuntimeError("Desktop installation did not complete; see the maintenance guidance above")


def check_and_install():
    """Check if binary is installed, download if not"""
    if not is_installed():
        print("Print@SoC is not installed yet.")
        print("This will download the application (~50-150 MB depending on platform)")
        print()
        download_and_install()
        print()
