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

MCP_ARGS = {"mcp", "mcp-server", "--mcp", "--mcp-server"}
WRAPPER_FLAGS = {
    "--no-check",
    "--doctor",
    "--fix-path",
    "--register-app",
    "--unregister",
    "--install",
    "--path",
    "--install-virtual-printer",
    "--uninstall-virtual-printer",
    "--configure-virtual-printer",
    "--virtual-printer-status",
    "--help",
    "-h",
    "--version",
    "-v",
}


def print_usage():
    """Print usage information"""
    print(f"""
Print@SoC v{VERSION}
Smart Printing for NUS SoC

Usage:
  print-soc                         Launch the desktop application
  print-soc <command> [options]

Printing:
  print-soc print FILE              Submit a file without opening the desktop UI

Inspection:
  print-soc printer list            List SoC printer queues from /etc/printcap
  print-soc job list --printer psts-dx    List queued jobs with rank/owner/job_id/file/size
  print-soc job cancel --printer psts-dx --id 123 --yes
  print-soc quota show              Show print quota/balance from pusage
  print-soc config show             Show effective CLI config with secrets redacted

Runtime:
  print-soc mcp                     Start the MCP stdio server
  print-soc mcp start               Start the MCP stdio server
  print-soc app launch              Launch the desktop application

Virtual printer:
  print-soc virtual-printer configure  Save SSH/default printer settings
  print-soc virtual-printer install    Install the macOS/Linux CUPS queue
  print-soc virtual-printer status     Show virtual printer installation status
  print-soc virtual-printer uninstall  Remove the CUPS queue/backend/config

Maintenance:
  print-soc self install            Force reinstall the desktop binary
  print-soc self path               Show binary installation path
  print-soc self doctor             Linux runtime dependency check
  print-soc --help                  Show this help message
  print-soc --version               Show version information

Examples:
  print-soc
  psoc mcp
  print-soc printer list --username your-soc-id --ask-password
  print-soc job list --printer psts-dx --json
  print-soc quota show --json
  print-soc --install-virtual-printer --username your-soc-id --ask-password --printer psts-dx
    """)


def _is_mcp_mode(args):
    return any(arg in MCP_ARGS for arg in args)


def _args_after_flag(args, flag):
    index = args.index(flag)
    return args[index + 1 :]


def _run_virtual_command(handler, command_args):
    try:
        return handler(command_args)
    except Exception as e:
        print(f"Virtual printer command failed: {e}", file=sys.stderr)
        return 1


def _is_top_level_help(args):
    return args in (["--help"], ["-h"], ["help"])


def _route_structured_command(args):
    if not args:
        return None

    command = args[0]
    rest = args[1:]

    try:
        if command in ("printer", "printers"):
            from .soc_commands import printer_cli

            return printer_cli(rest)
        if command in ("list", "queues"):
            from .soc_commands import flat_list_cli

            return flat_list_cli(rest)
        if command in ("job", "jobs"):
            from .soc_commands import flat_jobs_cli, job_cli

            return job_cli(rest) if command == "job" else flat_jobs_cli(rest)
        if command == "quota":
            from .soc_commands import quota_cli

            return quota_cli(rest)
        if command == "config":
            from .soc_commands import config_cli

            return config_cli(rest)
        if command == "virtual-printer":
            from .soc_commands import virtual_printer_cli

            return virtual_printer_cli(rest)
    except SystemExit as exc:
        return int(exc.code or 0)
    except Exception as e:
        print(f"{command} command failed: {e}", file=sys.stderr)
        return 1

    return None


def _rewrite_layered_shortcuts(args):
    if not args:
        return args
    if args[0] == "mcp" and len(args) >= 2 and args[1] == "start":
        return ["mcp"] + args[2:]
    if args[0] == "app":
        if len(args) == 1 or args[1] == "launch":
            return args[2:]
        if args[1] in ("help", "--help", "-h"):
            return ["--help"]
    if args[0] == "self":
        sub = args[1] if len(args) >= 2 else "path"
        rest = args[2:]
        mapping = {
            "install": "--install",
            "path": "--path",
            "doctor": "--doctor",
            "version": "--version",
        }
        if sub in mapping:
            return [mapping[sub]] + rest
    return args


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
        for exe in ("print-at-soc.exe", "print_at_soc.exe", "print-soc.exe", "psoc.exe"):
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
    for exe in ("print-at-soc.exe", "print_at_soc.exe", "print-soc.exe", "psoc.exe"):
        try:
            _win_delete_app_path(exe)
        except Exception:
            pass


def main():
    """Main entry point for CLI"""
    args = _rewrite_layered_shortcuts(sys.argv[1:])
    mcp_mode = _is_mcp_mode(args)

    routed = _route_structured_command(args)
    if routed is not None:
        return routed

    if _is_top_level_help(args):
        print_usage()
        return 0

    if "--version" in args or "-v" in args:
        print(f"Print@SoC v{VERSION}")
        return 0

    if args and args[0] == "print":
        from .virtual_printer import print_file_cli

        return _run_virtual_command(print_file_cli, args[1:])

    if "--configure-virtual-printer" in args:
        from .virtual_printer import configure_virtual_printer

        return _run_virtual_command(
            configure_virtual_printer,
            _args_after_flag(args, "--configure-virtual-printer"),
        )

    if "--install-virtual-printer" in args:
        from .virtual_printer import install_virtual_printer

        return _run_virtual_command(
            install_virtual_printer,
            _args_after_flag(args, "--install-virtual-printer"),
        )

    if "--uninstall-virtual-printer" in args:
        from .virtual_printer import uninstall_virtual_printer

        return _run_virtual_command(
            uninstall_virtual_printer,
            _args_after_flag(args, "--uninstall-virtual-printer"),
        )

    if "--virtual-printer-status" in args:
        from .virtual_printer import virtual_printer_status

        return _run_virtual_command(
            virtual_printer_status,
            _args_after_flag(args, "--virtual-printer-status"),
        )

    if "--install" in args:
        from .downloader import download_and_install
        try:
            download_and_install()
            return 0
        except Exception as e:
            print(f"Installation failed: {e}", file=sys.stderr)
            return 1

    if platform.system() == "Windows" and not mcp_mode:
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
            print("Binary not installed yet. Run 'print-soc --install' to install.")
        return 0

    if mcp_mode:
        if not is_installed():
            print(
                "Print@SoC binary is not installed. Run 'print-soc --install' before starting the MCP server.",
                file=sys.stderr,
            )
            return 1
    else:
        try:
            check_and_install()
        except Exception as e:
            print(f"Error during installation check: {e}", file=sys.stderr)
            return 1

    binary_path = get_binary_path()

    if not binary_path.exists():
        print(f"Error: Binary not found at {binary_path}", file=sys.stderr)
        print("Try running 'print-soc --install' to reinstall", file=sys.stderr)
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
        if not mcp_mode:
            print(f"Launching Print@SoC...")

        if platform.system() == "Darwin" and binary_path.suffix == "" and not mcp_mode:
            app_bundle = binary_path.parent.parent.parent

            # Remove quarantine attribute to allow unsigned app to run
            try:
                # Remove quarantine from entire app bundle
                subprocess.run(
                    ["xattr", "-cr", str(app_bundle)],
                    capture_output=True,
                    check=False
                )
                # Also try the specific quarantine attribute
                subprocess.run(
                    ["xattr", "-dr", "com.apple.quarantine", str(app_bundle)],
                    capture_output=True,
                    check=False
                )
            except Exception:
                pass

            app_args = [a for a in args if a not in WRAPPER_FLAGS]

            # Try to launch, with helpful error message on failure
            result = subprocess.run(["open", str(app_bundle), "--args"] + app_args, capture_output=True, text=True)
            if result.returncode != 0:
                print(f"\nFailed to launch application.", file=sys.stderr)
                print(f"\nIf macOS blocks the app, try one of these solutions:", file=sys.stderr)
                print(f"  1. Open System Preferences > Security & Privacy > General", file=sys.stderr)
                print(f"     Click 'Open Anyway' for Print_at_SoC", file=sys.stderr)
                print(f"  2. Or run in terminal:", file=sys.stderr)
                print(f"     xattr -cr '{app_bundle}'", file=sys.stderr)
                print(f"     open '{app_bundle}'", file=sys.stderr)
                return 1
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
            app_args = [a for a in args if a not in WRAPPER_FLAGS]
            subprocess.run([str(binary_path)] + app_args, check=True, env=env)

        return 0

    except KeyboardInterrupt:
        print("\nApplication closed by user", file=sys.stderr if mcp_mode else sys.stdout)
        return 0
    except subprocess.CalledProcessError as e:
        print(f"Application exited with error: {e.returncode}", file=sys.stderr)
        return e.returncode
    except Exception as e:
        print(f"Failed to launch application: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
