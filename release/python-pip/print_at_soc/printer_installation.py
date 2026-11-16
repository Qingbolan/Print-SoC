"""The system-printer installation lifecycle, independent of terminal rendering."""
from __future__ import annotations

import argparse
import copy
from enum import Enum
from pathlib import Path
import shlex
import sys
from typing import Any, Dict


class SetupError(RuntimeError):
    def __init__(self, message, commands):
        super().__init__(message)
        self.commands = commands


class InstallationState(Enum):
    PREFLIGHT = "Check this computer"
    CONFIGURE = "Choose printing settings"
    REVIEW = "Review installation"
    AUTHORIZE = "Administrator authentication"
    RUNTIME = "Prepare the printing service"
    CONFIGURATION = "Save forwarding configuration"
    REGISTER = "Add the system printer"
    ENABLE = "Enable the print queue"
    VERIFY = "Verify registration"
    COMPLETE = "Installation complete"
    CANCELLED = "Installation cancelled"
    FAILED = "Installation failed"


class PrinterInstallation:
    """One ordered installation; no system changes before configuration review."""

    STEPS = (
        InstallationState.PREFLIGHT, InstallationState.CONFIGURE,
        InstallationState.REVIEW, InstallationState.AUTHORIZE,
        InstallationState.RUNTIME, InstallationState.CONFIGURATION,
        InstallationState.REGISTER, InstallationState.ENABLE, InstallationState.VERIFY,
    )

    def __init__(self, args: argparse.Namespace, ui: Any):
        from . import virtual_printer
        self.backend = virtual_printer
        self.args = args
        self.ui = ui
        self.state = InstallationState.PREFLIGHT
        self.changed = False
        self.config: Dict[str, Any] = {}
        self.wrapper = ""
        self.destination = None
        self.existing = False
        self.secrets = []

    def run(self) -> int:
        try:
            self.ui.intro()
            for index, state in enumerate(self.STEPS, 1):
                self.state = state
                animate = state not in (
                    InstallationState.CONFIGURE, InstallationState.REVIEW,
                    InstallationState.AUTHORIZE,
                ) and not self.args.dry_run
                with self.ui.stage(state.value, index, len(self.STEPS), animate=animate):
                    proceed = self._execute(state)
                if proceed is False:
                    self.state = InstallationState.CANCELLED
                    self.ui.cancelled(changed=self.changed)
                    return 0
            self.state = InstallationState.COMPLETE
            self.ui.finish(self.args.name, self.args.display_name, dry_run=self.args.dry_run)
            return 0
        except (KeyboardInterrupt, EOFError):
            self.state = InstallationState.CANCELLED
            self.ui.cancelled(changed=self.changed)
            return 130
        except Exception as error:
            failed = self.state
            self.state = InstallationState.FAILED
            detail = self._redact(str(error))
            self.ui.failure(failed.value, detail, getattr(error, "commands", self._repair_commands(failed)), changed=self.changed)
            return 1

    def _execute(self, state: InstallationState):
        vp, args = self.backend, self.args
        if state == InstallationState.PREFLIGHT:
            self._preflight()
        elif state == InstallationState.CONFIGURE:
            self._configure()
        elif state == InstallationState.REVIEW:
            while True:
                self._review()
                if not self.ui.interactive or args.yes:
                    break
                if self.ui.confirm("Preview these steps?" if args.dry_run else "Add this system printer?", default=True):
                    break
                action = self.ui.choose("Before continuing", [("Cancel setup", "cancel"), ("Edit settings", "edit")], default="cancel")
                if action == "cancel":
                    return False
                self.state = InstallationState.CONFIGURE
                self._configure()
                self.state = InstallationState.REVIEW
        elif state == InstallationState.AUTHORIZE:
            if args.dry_run:
                self.ui.note("Preview only: no administrator authentication or system changes.")
            elif self.ui.interactive:
                self.ui.note("Enter your COMPUTER administrator password at sudo's prompt. This is not your SoC password.")
                vp._authorize_system_changes()
            elif vp._sudo_prefix():
                result = vp._run_command(["sudo", "-n", "-v"], check=False)
                if result.returncode:
                    raise RuntimeError("Administrator access is not cached. Run sudo -v in your terminal, then retry; unattended setup never requests a password.")
        elif state == InstallationState.RUNTIME:
            # A failed operation may leave partial files. Report that truthfully.
            self.changed = not args.dry_run
            self.wrapper = vp._install_runtime(dry_run=args.dry_run)
        elif state == InstallationState.CONFIGURATION:
            self.destination = vp.find_cups_backend_dir() / vp.BACKEND_NAME
            vp._run_command(vp._sudo_prefix() + ["mkdir", "-p", str(self.destination.parent)], dry_run=args.dry_run)
            if args.dry_run:
                self.ui.note("Would save private SSH settings and install the CUPS backend. No secrets are displayed or written.")
            else:
                vp._write_backend_config(self.config)
                if not args.system_config:
                    vp._write_config(self.config)
                vp._install_file(self.wrapper, self.destination, mode="0500")
        elif state == InstallationState.REGISTER:
            printing = self.config["print"]
            duplex = {"simplex": "None", "duplex-long-edge": "DuplexNoTumble", "duplex-short-edge": "DuplexTumble"}[printing["duplex"]]
            vp._run_command(vp._sudo_prefix() + [
                vp.shutil.which("lpadmin"), "-p", args.name, "-E", "-v", vp.BACKEND_URI,
                "-P", str(vp.PDF_DRIVER_PATH), "-D", args.display_name, "-L", args.location,
                "-o", "printer-error-policy=abort-job",
                "-o", f"PageSize={printing['paper_size']}",
                "-o", f"PageRegion={printing['paper_size']}",
                "-o", f"Duplex={duplex}",
            ], dry_run=args.dry_run)
        elif state == InstallationState.ENABLE:
            for tool in ("cupsaccept", "cupsenable"):
                vp._run_command(vp._sudo_prefix() + [vp.shutil.which(tool), args.name], dry_run=args.dry_run)
        elif state == InstallationState.VERIFY:
            if args.dry_run:
                self.ui.note("Would verify the registered device URI. Remote printing has not been tested.")
            elif vp._cups_devices().get(args.name) != vp.BACKEND_URI:
                raise RuntimeError("CUPS did not register the expected Print@SoC device URI. Installation is incomplete.")
        return True

    def _preflight(self):
        vp = self.backend
        if vp.platform.system() not in {"Darwin", "Linux"}:
            raise SetupError("This installer supports macOS and Linux CUPS only. On Windows, use the Print@SoC desktop app for printing.", ["print-soc app launch"])
        missing = [tool for tool in ("lpadmin", "lpstat", "cupsaccept", "cupsenable") if not vp.shutil.which(tool)]
        if missing:
            commands = ["lpstat -r"]
            if vp.platform.system() == "Darwin":
                commands.insert(0, "open 'x-apple.systempreferences:com.apple.Print-Scan-Settings.extension'")
            else:
                for manager, command in [("apt-get", "sudo apt-get install cups cups-client"),
                                         ("dnf", "sudo dnf install cups cups-client"),
                                         ("pacman", "sudo pacman -S cups")]:
                    if vp.shutil.which(manager):
                        commands.insert(0, command)
                        break
                if vp.shutil.which("systemctl"):
                    commands.insert(1, "sudo systemctl enable --now cups")
            raise SetupError("Missing CUPS tools: " + ", ".join(missing) + ". Install/enable your system's CUPS printing service, then rerun setup.", commands)
        if not vp.PDF_DRIVER_PATH.is_file():
            raise RuntimeError("Packaged Print@SoC PDF driver is missing; reinstall print-at-soc.")
        from .cups_runtime import CupsRuntime
        try:
            CupsRuntime()  # Reject an inaccessible interpreter before prompting.
        except RuntimeError as error:
            raise SetupError(str(error), ["Install Python outside your home directory using your system package manager or Homebrew.",
                                          "Use that Python to run: python3 -m pip install --upgrade print-at-soc"]) from error
        vp.validate_queue_name(self.args.name)
        try:
            uri = vp._cups_devices().get(self.args.name)
        except RuntimeError as error:
            commands = ["lpstat -r"]
            if vp.platform.system() == "Linux" and vp.shutil.which("systemctl"):
                commands.append("sudo systemctl restart cups")
            commands.append("print-soc virtual-printer install")
            raise SetupError(f"Cannot inspect the local CUPS service: {error}", commands) from error
        if uri and not uri.startswith(vp.BACKEND_NAME + ":"):
            raise SetupError(f"Queue {self.args.name} belongs to another printer. Choose a different local name to keep it untouched.", ["print-soc virtual-printer install --name PrintAtSoC_2"])
        self.existing = bool(uri)

    @staticmethod
    def _identity(value):
        return bool(value.strip() and not value.startswith("-") and not any(c.isspace() or ord(c) < 32 for c in value)) or "Enter a value without spaces or a leading hyphen."

    def _queue(self, value):
        try:
            self.backend.validate_queue_name(value)
            return True
        except ValueError:
            return "Use letters, numbers, hyphens or underscores (up to 128 characters)."

    def _configure(self):
        args, vp, ui = self.args, self.backend, self.ui
        if args.ask_password and not ui.interactive and not args.dry_run:
            raise RuntimeError("--ask-password needs an interactive terminal. Use --password-stdin or --key-path with --non-interactive.")
        load_args = copy.copy(args)
        load_args.ask_password = False  # The view owns every interactive prompt.
        if args.dry_run:
            load_args.password_stdin = False
        self.config = vp._build_config_from_args(load_args)
        ssh, printing = self.config["ssh"], self.config["print"]
        printing["duplex"] = vp._normalize_duplex(printing.get("duplex", "duplex-long-edge"))
        printing["paper_size"] = str(printing.get("paper_size", "A4")).upper()
        self._remember_secrets()
        if ui.interactive:
            ui.note("Defaults come from your saved settings. You can review and edit them before installation.")
            ssh["username"] = ui.ask_text("SoC username", default=ssh.get("username", ""), validate=self._identity)
            servers = [("Student · stu.comp.nus.edu.sg", "stu.comp.nus.edu.sg"),
                       ("Staff · stf.comp.nus.edu.sg", "stf.comp.nus.edu.sg"), ("Custom SSH host", "custom")]
            host = ssh.get("host", "stu.comp.nus.edu.sg")
            choice = ui.choose("SoC server", servers, default=host if host in [v for _, v in servers] else "custom")
            ssh["host"] = ui.ask_text("SSH host", default=host, validate=self._identity) if choice == "custom" else choice
            ssh["port"] = int(ui.ask_text("SSH port", default=str(ssh.get("port", 22)),
                                           validate=lambda v: (v.isascii() and v.isdigit() and 1 <= int(v) <= 65535) or "Enter a port from 1 to 65535."))
            ui.note("The remote queue is the SoC printer that receives your documents, for example psts-dx.")
            printing["printer"] = ui.ask_text("Remote printer queue", default=printing["printer"], validate=self._queue)
            printing["paper_size"] = ui.choose("Paper size", [("A4", "A4"), ("A3", "A3")], default=printing["paper_size"])
            printing["duplex"] = ui.choose("Print sides", [("Two-sided · long edge", "duplex-long-edge"),
                ("Two-sided · short edge", "duplex-short-edge"), ("One-sided", "simplex")], default=printing["duplex"])
            if not args.dry_run:
                methods = [("SoC password", "password"), ("SSH private key", "key")]
                saved = bool(ssh.get("password") or ssh.get("key_path"))
                if saved and not args.ask_password:
                    methods.insert(0, ("Use configured credentials (hidden)", "saved"))
                method = ui.choose("Authentication", methods, default=methods[0][1])
                if method == "password":
                    ui.note("Enter your SoC account password, not your computer password. Input is hidden.")
                    ssh.update(password=ui.ask_text("SoC password", secret=True, validate=lambda v: bool(v) or "Password cannot be empty."), key_path="", key_passphrase="")
                elif method == "key":
                    ssh["key_path"] = ui.ask_text("SSH private key path", default=ssh.get("key_path", ""),
                        validate=lambda v: Path(v).expanduser().is_file() or "Enter an existing private key file.")
                    ssh["key_passphrase"] = ui.ask_text("Key passphrase (Enter if none)", secret=True)
                    ssh["password"] = ""
        self._remember_secrets()
        vp._validate_print_config(self.config)
        if printing["paper_size"] not in {"A4", "A3"}:
            raise RuntimeError("This printer driver supports A4 and A3. Select --paper-size A4 or --paper-size A3.")
        if not args.dry_run:
            vp._validate_backend_config(self.config)

    def _remember_secrets(self):
        ssh = self.config.get("ssh", {})
        self.secrets.extend(str(ssh[key]) for key in ("password", "key_passphrase") if ssh.get(key))

    def _review(self):
        ssh, printing = self.config["ssh"], self.config["print"]
        # Show the effective destination, including suffix normalization.
        queue = self.backend.adjusted_queue_for_duplex(printing["printer"], printing["duplex"])
        self.ui.summary([
            ("Action", "Preview only" if self.args.dry_run else "Repair / update" if self.existing else "Add printer"),
            ("System printer", f"{self.args.display_name} ({self.args.name})"),
            ("Forward to", f"{ssh['username']}@{ssh['host']}:{ssh['port']} → {queue}"),
            ("Print defaults", f"{printing['paper_size']} · {printing['duplex']}"),
            ("Credentials", "Not needed for preview" if self.args.dry_run else "Private key (hidden)" if ssh.get("key_path") else "Password (hidden)"),
        ])
        self.ui.note("The system service stores private SSH credentials with mode 0600. All Print@SoC queues on this computer share this forwarding account.")
        self.ui.note("No document will be printed during setup. NUS network access or VPN is needed when printing.")

    def _redact(self, detail):
        for secret in sorted(set(self.secrets), key=len, reverse=True):
            detail = detail.replace(secret, "[hidden]")
        # Remove terminal control characters from subprocess errors.
        return "".join(c for c in detail if c in "\n\t" or (ord(c) >= 32 and ord(c) != 127)).replace("\x1b", "")

    def _repair_commands(self, state):
        name = shlex.quote(self.args.name)
        retry = f"print-soc virtual-printer install --name {name}"
        if state == InstallationState.PREFLIGHT:
            return ["print-soc virtual-printer install --help", "python3 -m pip install --upgrade print-at-soc", "lpstat -r", retry]
        if state in (InstallationState.CONFIGURE, InstallationState.REVIEW):
            return [f"print-soc virtual-printer install --name {name} --username YOUR_SOC_ID --ask-password",
                    "print-soc virtual-printer install --help"]
        if state == InstallationState.AUTHORIZE:
            return ["sudo -v", retry]
        if state == InstallationState.RUNTIME:
            return ["python3 -m pip install --upgrade print-at-soc", retry,
                    f"print-soc virtual-printer uninstall --name {name} --keep-config"]
        return [f"print-soc virtual-printer status --name {name}", "lpstat -r", retry,
                f"print-soc virtual-printer uninstall --name {name} --keep-config"]


def run_installation(argv):
    from . import virtual_printer as vp
    from .installer_ui import InstallerUI
    parser = argparse.ArgumentParser(
        prog="print-soc virtual-printer install",
        description="Add Print@SoC to this computer's print dialog. Run without options for the interactive setup wizard.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""Examples:
  print-soc virtual-printer install
  print-soc virtual-printer install --dry-run
  print-soc virtual-printer install --plain
  print-soc virtual-printer install --non-interactive --username YOUR_SOC_ID --password-stdin
  print-soc virtual-printer install --non-interactive --username YOUR_SOC_ID --key-path ~/.ssh/id_ed25519

Automation: use sudo -v beforehand or run with administrator privileges.
--password-stdin reads one line; never include passwords in shell history.
No test page is printed. Use Ctrl+C to cancel; --dry-run makes no system changes.""",
    )
    vp.add_config_args(parser)
    parser.add_argument("--name", default=vp.PRINTER_NAME, help="Local system queue name")
    parser.add_argument("--display-name", default=vp.DISPLAY_NAME, help="Name shown in print dialogs")
    parser.add_argument("--location", default=vp.LOCATION)
    parser.add_argument("--system-config", action="store_true", help="Save credentials only for the system service")
    parser.add_argument("--dry-run", action="store_true", help="Preview installation without authentication or system changes")
    parser.add_argument("--non-interactive", action="store_true", help="Never prompt; require supplied or saved configuration and cached administrator access")
    parser.add_argument("--yes", action="store_true", help="Skip the final review confirmation (use --non-interactive for scripts)")
    parser.add_argument("--plain", action="store_true", help="Use simple text without color, animations or arrow-key menus")
    args = parser.parse_args(argv)
    secret_sources = sum((args.ask_password, args.password_stdin, args.password is not None, bool(args.key_path)))
    if secret_sources > 1:
        parser.error("Choose one authentication source: --ask-password, --password-stdin, --password, or --key-path")
    interactive = bool(sys.stdin.isatty() and sys.stdout.isatty() and not args.non_interactive and not args.password_stdin)
    ui = InstallerUI(interactive=interactive, plain=args.plain)
    return PrinterInstallation(args, ui).run()
