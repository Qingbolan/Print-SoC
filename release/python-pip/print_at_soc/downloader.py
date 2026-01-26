"""Binary downloader for Print@SoC"""

import os
import sys
import platform
import urllib.request
import json
import tarfile
import zipfile
import shutil
from pathlib import Path
from typing import Optional, Tuple

from .config import (
    GITHUB_API_URL,
    BINARY_DIR,
    VERSION_FILE,
    PLATFORM_BINARIES,
    ensure_dirs,
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


def download_with_progress(url: str, dest: Path):
    """Download file with progress bar"""
    print(f"Downloading from: {url}")

    def reporthook(block_num, block_size, total_size):
        downloaded = block_num * block_size
        if total_size > 0:
            percent = min(downloaded * 100 / total_size, 100)
            size_mb = total_size / (1024 * 1024)
            downloaded_mb = downloaded / (1024 * 1024)
            sys.stdout.write(
                f"\rProgress: {percent:.1f}% ({downloaded_mb:.1f}/{size_mb:.1f} MB)"
            )
            sys.stdout.flush()

    try:
        urllib.request.urlretrieve(url, dest, reporthook=reporthook)
        print("\nDownload complete!")
    except Exception as e:
        raise RuntimeError(f"Download failed: {e}")


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

    try:
        os.system(f'"{installer_path}"')
        print("\nInstaller completed.")
    except Exception as e:
        print(f"Warning: Installer execution encountered an issue: {e}")
        print(f"You can run the installer manually at: {installer_path}")


def extract_archive(archive_path: Path, extract_dir: Path):
    """Extract downloaded archive or run installer"""
    print(f"Processing: {extract_dir}")

    if archive_path.suffix == ".gz" and archive_path.stem.endswith(".tar"):
        print("Extracting tar.gz archive...")
        with tarfile.open(archive_path, "r:gz") as tar:
            tar.extractall(extract_dir)
        print("Extraction complete!")
    elif archive_path.suffix == ".zip":
        print("Extracting zip archive...")
        with zipfile.ZipFile(archive_path, "r") as zip_ref:
            zip_ref.extractall(extract_dir)
        print("Extraction complete!")
    elif archive_path.suffix == ".AppImage":
        dest = extract_dir / archive_path.name
        try:
            if archive_path.resolve() != dest.resolve():
                shutil.move(str(archive_path), dest)
            os.chmod(dest, 0o755)
            print(f"AppImage ready: {dest}")
        except Exception as e:
            print(f"Warning: {e}")
    elif archive_path.suffix == ".exe":
        dest = extract_dir / archive_path.name
        try:
            if archive_path.resolve() != dest.resolve():
                shutil.copy(str(archive_path), dest)
        except Exception:
            pass
        _run_nsis_installer(archive_path if archive_path.exists() else dest)
    elif archive_path.suffix == ".msi":
        dest = extract_dir / archive_path.name
        try:
            if archive_path.resolve() != dest.resolve():
                shutil.copy(str(archive_path), dest)
        except Exception:
            pass
        print("Running MSI installer...")
        _install_msi(archive_path if archive_path.exists() else dest)
    else:
        raise RuntimeError(f"Unsupported archive format: {archive_path.suffix}")


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
    try:
        msiexec = "msiexec"
        log_path = BINARY_DIR / "msi-install.log"
        cmds = [
            [msiexec, "/i", str(msi_path), "/qn", "/norestart", f"/L*V\"{log_path}\"", "ALLUSERS=2", "MSIINSTALLPERUSER=1"],
            [msiexec, "/i", str(msi_path), "/passive", "/norestart", f"/L*V\"{log_path}\"", "ALLUSERS=2", "MSIINSTALLPERUSER=1"],
            [msiexec, "/i", str(msi_path)],
        ]
        for cmd in cmds:
            try:
                print(f"Running: {' '.join(cmd)}")
                rc = os.system(" ".join(cmd))
                if rc == 0:
                    return
            except Exception:
                continue
        print("Warning: MSI installation did not complete successfully. You may need to install manually.")
    except Exception as e:
        print(f"Warning: Failed to run msiexec: {e}")


def get_download_url() -> Tuple[str, str]:
    """Get download URL from GitHub releases"""
    platform_key = get_platform_key()
    config = PLATFORM_BINARIES[platform_key]
    asset_name = config["asset_name"]
    fallback_name = config.get("asset_name_fallback")

    print("Fetching latest release information...")

    try:
        req = urllib.request.Request(GITHUB_API_URL)
        req.add_header("Accept", "application/vnd.github.v3+json")

        with urllib.request.urlopen(req, timeout=30) as response:
            data = json.loads(response.read().decode())

        for asset in data.get("assets", []):
            if asset["name"] == asset_name:
                return asset["browser_download_url"], data["tag_name"]

        if fallback_name:
            for asset in data.get("assets", []):
                if asset["name"] == fallback_name:
                    print(f"Note: Using fallback installer ({fallback_name})")
                    return asset["browser_download_url"], data["tag_name"]

        raise RuntimeError(
            f"No matching binary found for platform: {platform_key}\n"
            f"Looking for: {asset_name}" +
            (f" or {fallback_name}" if fallback_name else "")
        )

    except urllib.error.HTTPError as e:
        if e.code == 404:
            raise RuntimeError(
                "No releases found. Please ensure binaries are published to GitHub Releases.\n"
                f"Repository: {GITHUB_API_URL}"
            )
        raise RuntimeError(f"Failed to fetch release info: {e}")
    except Exception as e:
        raise RuntimeError(f"Failed to get download URL: {e}")


def download_and_install():
    """Download and install the binary for current platform"""
    ensure_dirs()

    if is_installed():
        installed_version = get_installed_version()
        print(f"Print@SoC is already installed (version: {installed_version})")

        response = input("Do you want to reinstall? (y/N): ").strip().lower()
        if response not in ("y", "yes"):
            return

        print("Removing existing installation...")
        if BINARY_DIR.exists():
            shutil.rmtree(BINARY_DIR)
        BINARY_DIR.mkdir(parents=True, exist_ok=True)

    download_url, version = get_download_url()

    platform_key = get_platform_key()
    asset_name = PLATFORM_BINARIES[platform_key]["asset_name"]
    download_path = BINARY_DIR / asset_name

    download_with_progress(download_url, download_path)

    if PLATFORM_BINARIES[platform_key]["is_bundle"] or download_path.suffix in (".gz", ".zip"):
        extract_archive(download_path, BINARY_DIR)
        download_path.unlink()
    elif download_path.suffix == ".msi":
        try:
            _install_msi(download_path)
        finally:
            pass
    elif download_path.suffix == ".AppImage":
        target_path = BINARY_DIR / PLATFORM_BINARIES[platform_key]["executable_path"]
        try:
            if target_path.exists():
                target_path.unlink()
        except Exception:
            pass
        shutil.move(str(download_path), target_path)
        try:
            os.chmod(target_path, 0o755)
        except Exception:
            pass

    if platform.system() != "Windows":
        binary_path = get_binary_path()
        if binary_path.exists():
            os.chmod(binary_path, 0o755)

    VERSION_FILE.write_text(version)

    print(f"\nPrint@SoC {version} installed successfully!")
    print(f"Installation directory: {BINARY_DIR}")


def check_and_install():
    """Check if binary is installed, download if not"""
    if not is_installed():
        print("Print@SoC is not installed yet.")
        print("This will download the application (~50-150 MB depending on platform)")
        print()
        download_and_install()
        print()
