"""Command-line interface for Print@SoC"""
from __future__ import annotations

import sys
import os
import shutil
import subprocess
import platform
from pathlib import Path
from .downloader import check_and_install, get_binary_path, is_installed
from .config import VERSION


def print_usage():
    """Print usage information"""
    print(f"""
Print@SoC v{VERSION}
Smart Printing for NUS SoC

Usage:
  print-at-soc           Launch the application
  print-at-soc --help    Show this help message
  print-at-soc --version Show version information
  print-at-soc --install Force reinstall the binary
  print-at-soc --path    Show binary installation path
  print-at-soc --fix-path         Windows: add Scripts to PATH and App Paths
  print-at-soc --register-app     Windows: register App Paths only
  print-at-soc --unregister       Windows: remove App Paths and PATH entry
  print-at-soc --doctor           Linux: check runtime deps and exit
  print-at-soc --no-check         Linux: skip runtime checks (warn-only)

Examples:
  print-at-soc          # Start the application
    """)


# ----------------------
# Windows PATH utilities
# ----------------------
def _win_get_scripts_dirs():
    """Return likely Scripts directories for current Python/user."""
    dirs = []
    try:
        import sysconfig
        p = sysconfig.get_paths().get("scripts")
        if p:
            dirs.append(Path(p))
    except Exception:
        pass
    try:
        import site
        user_base = getattr(site, "USER_BASE", None) or site.getusersitepackages()
        if user_base:
            ub = Path(user_base)
            if ub.name == "site-packages":
                ub = ub.parent.parent
            dirs.append(ub / "Scripts")
    except Exception:
        pass
    unique = []
    for d in dirs:
        if d and d not in unique:
            unique.append(d)
    return unique


def _win_add_to_user_path(dir_path: Path):
    import winreg
    dir_str = str(dir_path)
    with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Environment", 0, winreg.KEY_READ | winreg.KEY_WRITE) as k:
        try:
            current, _ = winreg.QueryValueEx(k, "Path")
        except FileNotFoundError:
            current = ""
        parts = [p for p in current.split(";") if p]
        if dir_str in parts:
            return False
        parts.append(dir_str)
        new_val = ";".join(parts)
        winreg.SetValueEx(k, "Path", 0, winreg.REG_EXPAND_SZ, new_val)
    try:
        import ctypes
        HWND_BROADCAST = 0xFFFF
        WM_SETTINGCHANGE = 0x001A
        ctypes.windll.user32.SendMessageTimeoutW(HWND_BROADCAST, WM_SETTINGCHANGE, 0, "Environment", 0x0002, 5000, None)
    except Exception:
        pass
    return True


def _win_register_app_path(exe_name: str, target_path: Path):
    import winreg
    key_path = rf"Software\Microsoft\Windows\CurrentVersion\App Paths\{exe_name}"
    with winreg.CreateKey(winreg.HKEY_CURRENT_USER, key_path) as k:
        winreg.SetValueEx(k, None, 0, winreg.REG_SZ, str(target_path))
        winreg.SetValueEx(k, "Path", 0, winreg.REG_SZ, str(target_path.parent))


def _windows_setup_shortcuts(register_app: bool = True, fix_path: bool = True):
    """Set up Windows conveniences"""
    if platform.system() != "Windows":
        return
    candidates = _win_get_scripts_dirs()
    scripts_dir = next((d for d in candidates if d and d.exists()), None)
    if not scripts_dir:
        return
    if fix_path:
        try:
            _win_add_to_user_path(scripts_dir)
        except Exception:
            pass
    if register_app:
        for exe in ("print-at-soc.exe", "print_at_soc.exe"):
            p = scripts_dir / exe
            if p.exists():
                try:
                    _win_register_app_path(exe, p)
                except Exception:
                    pass


def _win_remove_from_user_path(dir_path: Path):
    import winreg
    dir_norm = str(dir_path).rstrip("\\/").lower()
    with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Environment", 0, winreg.KEY_READ | winreg.KEY_WRITE) as k:
        try:
            current, _ = winreg.QueryValueEx(k, "Path")
        except FileNotFoundError:
            return False
        parts = [p for p in current.split(";") if p]
        new_parts = []
        changed = False
        for p in parts:
            if p.rstrip("\\/").lower() == dir_norm:
                changed = True
                continue
            new_parts.append(p)
        if changed:
            winreg.SetValueEx(k, "Path", 0, winreg.REG_EXPAND_SZ, ";".join(new_parts))
            try:
                import ctypes
                HWND_BROADCAST = 0xFFFF
                WM_SETTINGCHANGE = 0x001A
                ctypes.windll.user32.SendMessageTimeoutW(HWND_BROADCAST, WM_SETTINGCHANGE, 0, "Environment", 0x0002, 5000, None)
            except Exception:
                pass
        return changed


def _win_delete_app_path(exe_name: str):
    import winreg
    key_path = rf"Software\Microsoft\Windows\CurrentVersion\App Paths\{exe_name}"
    try:
        winreg.DeleteKey(winreg.HKEY_CURRENT_USER, key_path)
        return True
    except FileNotFoundError:
        return False
    except Exception:
        return False


def _windows_cleanup_shortcuts():
    if platform.system() != "Windows":
        return
    candidates = _win_get_scripts_dirs()
    scripts_dir = next((d for d in candidates if d and d.exists()), None)
    if scripts_dir:
        try:
            _win_remove_from_user_path(scripts_dir)
        except Exception:
            pass
    for exe in ("print-at-soc.exe", "print_at_soc.exe"):
        try:
            _win_delete_app_path(exe)
        except Exception:
            pass


def main():
    """Main entry point for CLI"""
    args = sys.argv[1:]

    if "--help" in args or "-h" in args:
        print_usage()
        return 0

    if "--version" in args or "-v" in args:
        print(f"Print@SoC v{VERSION}")
        return 0

    if "--install" in args:
        from .downloader import download_and_install
        try:
            download_and_install()
            return 0
        except Exception as e:
            print(f"Installation failed: {e}", file=sys.stderr)
            return 1

    if platform.system() == "Windows":
        if "--fix-path" in args or "--register-app" in args:
            try:
                _windows_setup_shortcuts(register_app=True, fix_path=("--fix-path" in args))
                print("Windows shortcuts registered.")
                if "--register-app" in args and "--fix-path" not in args:
                    return 0
            except Exception as e:
                print(f"Windows setup failed: {e}", file=sys.stderr)
                return 1

        if "--unregister" in args:
            try:
                _windows_cleanup_shortcuts()
                print("Windows shortcuts unregistered.")
                return 0
            except Exception as e:
                print(f"Windows unregister failed: {e}", file=sys.stderr)
                return 1

        try:
            _windows_setup_shortcuts(register_app=True, fix_path=True)
        except Exception:
            pass

    if "--path" in args:
        if is_installed():
            print(f"Binary path: {get_binary_path()}")
            print(f"Installed: Yes")
        else:
            print("Binary not installed yet. Run 'print-at-soc' to install.")
        return 0

    try:
        check_and_install()
    except Exception as e:
        print(f"Error during installation check: {e}", file=sys.stderr)
        return 1

    binary_path = get_binary_path()

    if not binary_path.exists():
        print(f"Error: Binary not found at {binary_path}", file=sys.stderr)
        print("Try running 'print-at-soc --install' to reinstall", file=sys.stderr)
        return 1

    def _linux_runtime_check():
        missing = []
        def has_lib(name: str) -> bool:
            try:
                out = subprocess.run(["ldconfig", "-p"], capture_output=True, text=True, check=False)
                return name in out.stdout
            except Exception:
                return False
        if not (has_lib("libwebkit2gtk-4.1.so.0") or has_lib("libwebkit2gtk-4.0.so.37")):
            missing.append("WebKitGTK")
        if not has_lib("libgtk-3.so.0"):
            missing.append("GTK3")
        if not (has_lib("libayatana-appindicator3.so.1") or has_lib("libappindicator3.so") or has_lib("libappindicator-gtk3.so")):
            missing.append("AppIndicator3")
        fuse_missing = not (has_lib("libfuse.so.2"))
        if fuse_missing:
            missing.append("FUSE (libfuse2)")
        if not os.environ.get("DISPLAY") and not os.environ.get("WAYLAND_DISPLAY"):
            missing.append("GUI session (X11/Wayland)")
        return missing, fuse_missing

    if "--doctor" in args and platform.system() == "Linux":
        missing, _fuse_missing = _linux_runtime_check()
        if not missing:
            print("Linux runtime check: OK")
            return 0
        try:
            with open("/etc/os-release", "r", encoding="utf-8") as f:
                data = f.read()
            def _get(field: str) -> str:
                import re
                m = re.search(rf"^{field}=(.*)$", data, re.MULTILINE)
                return m.group(1).strip().strip('"') if m else ""
            distro = (_get("ID_LIKE") or _get("ID")).lower()
        except Exception:
            distro = ""
        print("Missing Linux runtime dependencies:")
        for item in missing:
            print(f"  - {item}")
        print("\nInstall suggestions:")
        if "debian" in distro or "ubuntu" in distro:
            print("  sudo apt update && sudo apt install -y libwebkit2gtk-4.1-0 libgtk-3-0 libayatana-appindicator3-1 libfuse2")
        elif "fedora" in distro or "rhel" in distro or "centos" in distro:
            print("  sudo dnf install -y webkit2gtk4.1 gtk3 libappindicator-gtk3 fuse")
        elif "arch" in distro or "manjaro" in distro:
            print("  sudo pacman -S --needed webkit2gtk-4.1 gtk3 libappindicator-gtk3 fuse2")
        elif "suse" in distro or "opensuse" in distro:
            print("  sudo zypper install -y libwebkit2gtk-4_1-0 gtk3-tools libappindicator3-1 libfuse2")
        else:
            print("  Install WebKitGTK 4.1+, GTK3, AppIndicator3, and libfuse2 via your package manager.")
        return 0

    if platform.system() == "Linux":
        skip_checks = ("--no-check" in args) or bool(os.environ.get("PRINT_AT_SOC_NO_CHECKS"))
        strict = bool(os.environ.get("PRINT_AT_SOC_STRICT_CHECKS"))
        if not skip_checks:
            missing, fuse_missing = _linux_runtime_check()
            if missing:
                try:
                    with open("/etc/os-release", "r", encoding="utf-8") as f:
                        data = f.read()
                    def _get(field: str) -> str:
                        import re
                        m = re.search(rf"^{field}=(.*)$", data, re.MULTILINE)
                        return m.group(1).strip().strip('"') if m else ""
                    distro = (_get("ID_LIKE") or _get("ID")).lower()
                except Exception:
                    distro = ""
                print("Missing Linux runtime dependencies:", file=sys.stderr)
                for item in missing:
                    print(f"  - {item}", file=sys.stderr)
                print("\nInstall suggestions:", file=sys.stderr)
                if "debian" in distro or "ubuntu" in distro:
                    print("  sudo apt update && sudo apt install -y libwebkit2gtk-4.1-0 libgtk-3-0 libayatana-appindicator3-1 libfuse2", file=sys.stderr)
                elif "fedora" in distro or "rhel" in distro or "centos" in distro:
                    print("  sudo dnf install -y webkit2gtk4.1 gtk3 libappindicator-gtk3 fuse", file=sys.stderr)
                elif "arch" in distro or "manjaro" in distro:
                    print("  sudo pacman -S --needed webkit2gtk-4.1 gtk3 libappindicator-gtk3 fuse2", file=sys.stderr)
                elif "suse" in distro or "opensuse" in distro:
                    print("  sudo zypper install -y libwebkit2gtk-4_1-0 gtk3-tools libappindicator3-1 libfuse2", file=sys.stderr)
                else:
                    print("  Install WebKitGTK 4.1+, GTK3, AppIndicator3, and libfuse2 via your package manager.", file=sys.stderr)
                if missing == ["FUSE (libfuse2)"]:
                    print("\nFUSE missing: will attempt extraction-run fallback.", file=sys.stderr)
                elif strict:
                    print("\nAborting launch due to missing dependencies (strict mode).", file=sys.stderr)
                    return 1

    try:
        print(f"Launching Print@SoC...")

        if platform.system() == "Darwin" and binary_path.suffix == "":
            app_bundle = binary_path.parent.parent.parent

            try:
                subprocess.run(
                    ["xattr", "-dr", "com.apple.quarantine", str(app_bundle)],
                    capture_output=True,
                    check=False
                )
            except Exception:
                pass

            app_args = [a for a in args if a not in {"--no-check", "--doctor", "--fix-path", "--register-app", "--unregister", "--install", "--path", "--help", "-h", "--version", "-v"}]
            subprocess.run(["open", str(app_bundle)] + app_args, check=True)
        else:
            env = os.environ.copy()
            if platform.system() == "Linux":
                try:
                    out = subprocess.run(["ldconfig", "-p"], capture_output=True, text=True, check=False)
                    fuse_missing = "libfuse.so.2" not in out.stdout
                except Exception:
                    fuse_missing = False
                if fuse_missing:
                    env["APPIMAGE_EXTRACT_AND_RUN"] = "1"
            app_args = [a for a in args if a not in {"--no-check", "--doctor", "--fix-path", "--register-app", "--unregister", "--install", "--path", "--help", "-h", "--version", "-v"}]
            subprocess.run([str(binary_path)] + app_args, check=True, env=env)

        return 0

    except KeyboardInterrupt:
        print("\nApplication closed by user")
        return 0
    except subprocess.CalledProcessError as e:
        print(f"Application exited with error: {e.returncode}", file=sys.stderr)
        return e.returncode
    except Exception as e:
        print(f"Failed to launch application: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
