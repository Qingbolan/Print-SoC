"""CUPS virtual printer support for Print@SoC.

The virtual printer is intentionally installed by an explicit command instead
of running during ``pip install``. System print queues and CUPS backends live
outside Python package metadata, so they need their own install/uninstall path.
"""

from __future__ import annotations

import argparse
import getpass
import json
import os
import platform
import shlex
import shutil
import subprocess
import sys
import tempfile
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

try:
    import pwd
except Exception:  # pragma: no cover - Windows does not provide pwd.
    pwd = None  # type: ignore[assignment]


PRINTER_NAME = "PrintAtSoC"
BACKEND_NAME = "printatsoc"
BACKEND_URI = "printatsoc://default"
DISPLAY_NAME = "Print@SoC Virtual Printer"
LOCATION = "NUS SoC"
APP_DIR_NAME = ".PrintAtSoC"
CONFIG_FILE_NAME = "virtual-printer.json"
SYSTEM_CONFIG_DIR = Path("/etc/print-at-soc")
SYSTEM_CONFIG_PATH = SYSTEM_CONFIG_DIR / CONFIG_FILE_NAME
RUNTIME_DIR = Path("/Library/Application Support/PrintAtSoC/cups") if platform.system() == "Darwin" else Path("/usr/local/lib/print-at-soc/cups")
STATUS_PATH = SYSTEM_CONFIG_DIR / "status.json"

DEFAULT_CONFIG: Dict[str, Any] = {
    "ssh": {
        "host": "stu.comp.nus.edu.sg",
        "port": 22,
        "username": "",
        "password": "",
        "key_path": "",
        "key_passphrase": "",
    },
    "print": {
        "printer": "psts-dx",
        "duplex": "duplex-long-edge",
        "paper_size": "A4",
        "scale_to_paper": True,
    },
}


def user_config_path(home: Optional[Path] = None) -> Path:
    base = home or Path.home()
    return base / APP_DIR_NAME / CONFIG_FILE_NAME


def _server_to_host(server: str) -> str:
    value = server.strip().lower()
    if value == "stu":
        return "stu.comp.nus.edu.sg"
    if value == "stf":
        return "stf.comp.nus.edu.sg"
    return server


def _merge_dict(base: Dict[str, Any], override: Dict[str, Any]) -> Dict[str, Any]:
    merged = dict(base)
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = _merge_dict(merged[key], value)
        else:
            merged[key] = value
    return merged


def _read_json(path: Path) -> Dict[str, Any]:
    try:
        if path.exists():
            return json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        raise RuntimeError(f"Failed to read config {path}: {exc}") from exc
    return {}


def _home_for_user(username: str) -> Optional[Path]:
    if not username:
        return None
    if pwd is None:
        return None
    try:
        return Path(pwd.getpwnam(username).pw_dir)
    except Exception:
        return None


def _env_config() -> Dict[str, Any]:
    ssh: Dict[str, Any] = {}
    print_cfg: Dict[str, Any] = {}

    server = os.environ.get("PSOC_SSH_SERVER")
    host = os.environ.get("PSOC_SSH_HOST")
    if host:
        ssh["host"] = host
    elif server:
        ssh["host"] = _server_to_host(server)

    for env_name, field in (
        ("PSOC_SSH_USERNAME", "username"),
        ("PSOC_SSH_PASSWORD", "password"),
        ("PSOC_SSH_KEY_PATH", "key_path"),
        ("PSOC_SSH_KEY_PASSPHRASE", "key_passphrase"),
    ):
        value = os.environ.get(env_name)
        if value:
            ssh[field] = value

    port = os.environ.get("PSOC_SSH_PORT")
    if port:
        try:
            ssh["port"] = int(port)
        except ValueError:
            pass

    printer = os.environ.get("PSOC_PRINTER") or os.environ.get("PSOC_DEFAULT_PRINTER")
    if printer:
        print_cfg["printer"] = printer

    duplex = os.environ.get("PSOC_DUPLEX")
    if duplex:
        print_cfg["duplex"] = duplex

    paper_size = os.environ.get("PSOC_PAPER_SIZE")
    if paper_size:
        print_cfg["paper_size"] = paper_size

    result: Dict[str, Any] = {}
    if ssh:
        result["ssh"] = ssh
    if print_cfg:
        result["print"] = print_cfg
    return result


def load_config(job_user: str = "", explicit_path: Optional[str] = None, resolve_credentials: bool = True) -> Dict[str, Any]:
    config = json.loads(json.dumps(DEFAULT_CONFIG))

    # Printing preferences may remain local; account identity has one owner.
    saved = _read_json(user_config_path())
    config["print"] = _merge_dict(config["print"], saved.get("print", {}))
    from .account import AccountStore
    store = AccountStore()
    if store.path.exists():
        config["ssh"] = store.ssh() if resolve_credentials else {**config["ssh"], **{k: store.identity()[k] for k in ("host", "port", "username")}}
    if explicit_path:
        config = _merge_dict(config, _read_json(Path(explicit_path).expanduser()))
    config = _merge_dict(config, _env_config())
    return config


def validate_queue_name(queue: str) -> None:
    if not queue or len(queue) > 128:
        raise ValueError(f"Invalid printer queue: {queue!r}")
    allowed = set("-_")
    if not all(ch.isascii() and (ch.isalnum() or ch in allowed) for ch in queue):
        raise ValueError(f"Invalid printer queue: {queue!r}")


def _normalize_duplex(value: str) -> str:
    normalized = (value or "").strip().lower().replace("_", "-")
    aliases = {
        "simplex": "simplex",
        "one-sided": "simplex",
        "none": "simplex",
        "duplex": "duplex-long-edge",
        "double-sided": "duplex-long-edge",
        "long": "duplex-long-edge",
        "long-edge": "duplex-long-edge",
        "two-sided-long-edge": "duplex-long-edge",
        "duplex-long-edge": "duplex-long-edge",
        "duplexnotumble": "duplex-long-edge",
        "short": "duplex-short-edge",
        "short-edge": "duplex-short-edge",
        "two-sided-short-edge": "duplex-short-edge",
        "duplex-short-edge": "duplex-short-edge",
        "duplextumble": "duplex-short-edge",
    }
    return aliases.get(normalized, "duplex-long-edge")


def adjusted_queue_for_duplex(queue: str, duplex: str) -> str:
    validate_queue_name(queue)
    mode = 'simplex' if _normalize_duplex(duplex) == 'simplex' else 'duplex'
    routes = json.loads(Path(__file__).with_name('queue-routing.json').read_text())
    if queue not in routes:
        return queue
    target = routes[queue][mode]
    if target is None:
        raise RuntimeError(f'Queue {queue} has no matching {mode} destination')
    return str(target)


def parse_cups_options(options: str) -> Dict[str, str]:
    parsed: Dict[str, str] = {}
    try:
        tokens = shlex.split(options or "")
    except ValueError:
        tokens = (options or "").split()

    for token in tokens:
        if "=" in token:
            key, value = token.split("=", 1)
            parsed[key.strip()] = value.strip()
    return parsed


def _paper_points(paper_size: str) -> Tuple[int, int]:
    value = (paper_size or "A4").upper()
    if value == "A3":
        return 842, 1191
    return 595, 842


def _coerce_copies(value: Any) -> int:
    try:
        copies = int(value)
    except Exception:
        copies = 1
    return max(1, min(copies, 999))


def _needs_paramiko(ssh_cfg: Dict[str, Any]) -> bool:
    return bool(ssh_cfg.get("password") or ssh_cfg.get("key_passphrase"))


def _load_paramiko():
    try:
        import paramiko  # type: ignore
    except Exception as exc:
        raise RuntimeError(
            "Password-based SSH printing requires the 'paramiko' dependency. "
            "Install this package through pip so dependencies are installed, "
            "or configure key/agent-based SSH."
        ) from exc
    return paramiko


def _connect_paramiko(ssh_cfg: Dict[str, Any]):
    paramiko = _load_paramiko()
    client = paramiko.SSHClient()
    client.load_system_host_keys()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    kwargs: Dict[str, Any] = {
        "hostname": ssh_cfg["host"],
        "port": int(ssh_cfg.get("port") or 22),
        "username": ssh_cfg["username"],
        "timeout": 15,
        "banner_timeout": 15,
        "auth_timeout": 15,
        "look_for_keys": not bool(ssh_cfg.get("password") or ssh_cfg.get("key_path")),
        "allow_agent": not bool(ssh_cfg.get("password")),
    }
    if ssh_cfg.get("password"):
        kwargs["password"] = ssh_cfg["password"]
    if ssh_cfg.get("key_path"):
        kwargs["key_filename"] = str(Path(ssh_cfg["key_path"]).expanduser())
    if ssh_cfg.get("key_passphrase"):
        kwargs["passphrase"] = ssh_cfg["key_passphrase"]
    client.connect(**kwargs)
    return client


def _paramiko_exec(client: Any, command: str, *, get_pty: bool = False) -> str:
    _stdin, stdout, stderr = client.exec_command(command, get_pty=get_pty)
    out = stdout.read().decode("utf-8", errors="replace")
    err = stderr.read().decode("utf-8", errors="replace")
    code = stdout.channel.recv_exit_status()
    if code != 0:
        detail = err.strip() or out.strip() or f"remote command exited with {code}"
        raise RuntimeError(detail)
    return out


def _system_ssh_base(ssh_cfg: Dict[str, Any]) -> List[str]:
    base = [
        "ssh",
        "-p",
        str(int(ssh_cfg.get("port") or 22)),
        "-o",
        "BatchMode=yes",
        "-o",
        "ConnectTimeout=15",
        "-o",
        "StrictHostKeyChecking=accept-new",
    ]
    if ssh_cfg.get("key_path"):
        base.extend(["-i", str(Path(ssh_cfg["key_path"]).expanduser())])
    return base


def _system_target(ssh_cfg: Dict[str, Any]) -> str:
    return f"{ssh_cfg['username']}@{ssh_cfg['host']}"


def _system_upload(ssh_cfg: Dict[str, Any], local_path: str, remote_path: str) -> None:
    scp = [
        "scp",
        "-P",
        str(int(ssh_cfg.get("port") or 22)),
        "-o",
        "BatchMode=yes",
        "-o",
        "ConnectTimeout=15",
        "-o",
        "StrictHostKeyChecking=accept-new",
    ]
    if ssh_cfg.get("key_path"):
        scp.extend(["-i", str(Path(ssh_cfg["key_path"]).expanduser())])
    scp.extend([local_path, f"{_system_target(ssh_cfg)}:{remote_path}"])
    result = subprocess.run(scp, capture_output=True, text=True, check=False)
    if result.returncode != 0:
        raise RuntimeError((result.stderr or result.stdout or "scp failed").strip())


def _system_exec(ssh_cfg: Dict[str, Any], command: str, *, tty: bool = False) -> str:
    cmd = _system_ssh_base(ssh_cfg)
    if tty:
        cmd.append("-tt")
    cmd += [_system_target(ssh_cfg), command]
    result = subprocess.run(cmd, capture_output=True, text=True, check=False)
    if result.returncode != 0:
        raise RuntimeError((result.stderr or result.stdout or "ssh command failed").strip())
    return result.stdout


def _validate_print_config(config: Dict[str, Any]) -> None:
    ssh_cfg = config.get("ssh", {})
    print_cfg = config.get("print", {})
    missing = []
    for section, key in (("ssh", "host"), ("ssh", "username"), ("print", "printer")):
        if not config.get(section, {}).get(key):
            missing.append(f"{section}.{key}")
    if missing:
        raise RuntimeError(
            "Virtual printer is not configured. Missing: "
            + ", ".join(missing)
            + ". Run 'print-soc --configure-virtual-printer --username YOUR_SOC_ID'."
        )
    validate_queue_name(str(print_cfg["printer"]))
    host = str(ssh_cfg.get("host", ""))
    username = str(ssh_cfg.get("username", ""))
    if not host.strip() or host.startswith("-") or any(c.isspace() for c in host):
        raise RuntimeError("Invalid SSH host")
    if not username.strip() or username.startswith("-") or any(c.isspace() for c in username):
        raise RuntimeError("Invalid SSH username")
    if not 1 <= int(ssh_cfg.get("port") or 22) <= 65535:
        raise RuntimeError("SSH port must be between 1 and 65535")


def submit_file_print_job(
    file_path: str,
    *,
    config: Dict[str, Any],
    printer: Optional[str] = None,
    copies: int = 1,
    title: str = "",
    cups_options: str = "",
) -> str:
    _validate_print_config(config)
    source = Path(file_path)
    if not source.exists() or not source.is_file():
        raise RuntimeError(f"Print file not found: {source}")

    ssh_cfg = dict(config["ssh"])
    print_cfg = dict(config["print"])
    options = parse_cups_options(cups_options)

    base_queue = printer or print_cfg.get("printer") or "psts-dx"
    duplex = options.get("sides") or options.get("Duplex") or print_cfg.get("duplex") or "duplex-long-edge"
    actual_queue = adjusted_queue_for_duplex(str(base_queue), duplex)
    paper_size = str(options.get("media") or options.get("PageSize") or options.get("PageRegion") or print_cfg.get("paper_size") or "A4").upper()
    copies = _coerce_copies(copies)
    title = title or source.name

    suffix = source.suffix if source.suffix.lower() in {".pdf", ".ps", ".prn"} else ".pdf"
    job_token = uuid.uuid4().hex
    remote_path = f"/tmp/print-at-soc-{job_token}{suffix}"
    scaled_path = f"/tmp/print-at-soc-{job_token}-scaled.pdf"
    width_pts, height_pts = _paper_points(paper_size)
    scale_to_paper = bool(print_cfg.get("scale_to_paper", True))

    quoted_remote = shlex.quote(remote_path)
    quoted_scaled = shlex.quote(scaled_path)
    if scale_to_paper:
        scale_command = (
            "gs -sDEVICE=pdfwrite -dPDFFitPage -dFIXEDMEDIA "
            f"-dDEVICEWIDTHPOINTS={width_pts} -dDEVICEHEIGHTPOINTS={height_pts} "
            "-dCompatibilityLevel=1.4 -dNOPAUSE -dBATCH -dQUIET "
            f"-sOutputFile={quoted_scaled} {quoted_remote}"
        )
        print_file = scaled_path
    else:
        scale_command = ""
        print_file = remote_path

    sides = {"simplex": "one-sided", "duplex-long-edge": "two-sided-long-edge", "duplex-short-edge": "two-sided-short-edge"}[_normalize_duplex(duplex)]
    lpr_parts = ["lpr", "-P", actual_queue, "-o", "sides=" + sides]
    if copies > 1:
        lpr_parts.extend(["-#", str(copies)])
    if title:
        lpr_parts.extend(["-J", title])
    lpr_parts.append(print_file)
    lpr_command = " ".join(shlex.quote(part) for part in lpr_parts)
    cleanup_command = f"rm -f {quoted_remote} {quoted_scaled}"

    if _needs_paramiko(ssh_cfg):
        client = _connect_paramiko(ssh_cfg)
        try:
            sftp = client.open_sftp()
            try:
                sftp.put(str(source), remote_path)
            finally:
                sftp.close()
            if scale_command:
                _paramiko_exec(client, scale_command)
            output = _paramiko_exec(client, lpr_command)
            return output.strip() or f"Submitted to {actual_queue}"
        finally:
            try:
                _paramiko_exec(client, cleanup_command)
            except Exception:
                pass
            client.close()

    _system_upload(ssh_cfg, str(source), remote_path)
    try:
        if scale_command:
            _system_exec(ssh_cfg, scale_command)
        output = _system_exec(ssh_cfg, lpr_command)
    finally:
        try:
            _system_exec(ssh_cfg, cleanup_command)
        except Exception:
            pass
    return output.strip() or f"Submitted to {actual_queue}"


def find_cups_backend_dir() -> Path:
    cups_config = shutil.which("cups-config")
    if cups_config:
        result = subprocess.run(
            [cups_config, "--serverbin"], capture_output=True, text=True, check=False
        )
        serverbin = result.stdout.strip()
        if result.returncode == 0 and serverbin:
            return Path(serverbin) / "backend"

    if platform.system() == "Darwin":
        return Path("/usr/libexec/cups/backend")

    for candidate in (Path("/usr/lib/cups/backend"), Path("/usr/libexec/cups/backend")):
        if candidate.exists():
            return candidate
    return Path("/usr/lib/cups/backend")


def backend_path(backend_name: str = BACKEND_NAME) -> Path:
    return find_cups_backend_dir() / backend_name


def _authorize_system_changes(*, dry_run: bool = False) -> None:
    if dry_run or not _sudo_prefix():
        return
    # Inherit the terminal: sudo must be able to request administrator credentials.
    result = subprocess.run(["sudo", "-v"], check=False)
    if result.returncode:
        raise RuntimeError("Administrator authentication failed; no printer changes were made")


def _sudo_prefix() -> List[str]:
    if hasattr(os, "geteuid") and os.geteuid() == 0:
        return []
    return ["sudo", "-n"]


def _run_command(cmd: List[str], *, dry_run: bool = False, check: bool = True) -> subprocess.CompletedProcess[str]:
    if dry_run:
        print("$ " + " ".join(shlex.quote(part) for part in cmd))
        return subprocess.CompletedProcess(cmd, 0, "", "")
    result = subprocess.run(cmd, capture_output=True, text=True, check=False, env=dict(os.environ, LC_ALL="C"))
    if check and result.returncode != 0:
        detail = (result.stderr or result.stdout or f"command exited with {result.returncode}").strip()
        raise RuntimeError(detail)
    return result


def _write_config(config: Dict[str, Any], *, dry_run: bool = False) -> Path:
    content = json.dumps({"print": config.get("print", {})}, indent=2) + "\n"
    path = user_config_path()
    if dry_run:
        print(f"# write {path} (0600)")
        return path
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, delete=False) as temporary:
        staged = Path(temporary.name)
        try:
            temporary.write(content)
            temporary.flush()
            staged.chmod(0o600)
            staged.replace(path)
        finally:
            if staged.exists():
                staged.unlink()
    return path


def _build_config_from_args(args: argparse.Namespace) -> Dict[str, Any]:
    explicit_secret = any(getattr(args, name, None) for name in ("password", "ask_password", "password_stdin", "key_path"))
    dry_run = getattr(args, "dry_run", False)
    config = load_config(explicit_path=getattr(args, "config", None), resolve_credentials=not (explicit_secret or dry_run))
    ssh_cfg = dict(config.get("ssh", {}))
    print_cfg = dict(config.get("print", {}))

    server = getattr(args, "server", None)
    host = getattr(args, "host", None)
    if host:
        ssh_cfg["host"] = host
    elif server:
        ssh_cfg["host"] = _server_to_host(server)

    for attr, field in (
        ("username", "username"),
        ("password", "password"),
        ("key_path", "key_path"),
        ("key_passphrase", "key_passphrase"),
    ):
        value = getattr(args, attr, None)
        if value is not None:
            ssh_cfg[field] = value

    if getattr(args, "ask_password", False) and not dry_run:
        ssh_cfg["password"] = getpass.getpass("SoC SSH password: ")

    if getattr(args, "password_stdin", False) and not dry_run:
        ssh_cfg["password"] = sys.stdin.readline().rstrip("\n")

    port = getattr(args, "port", None)
    if port is not None:
        ssh_cfg["port"] = int(port)

    printer = getattr(args, "printer", None)
    if printer:
        print_cfg["printer"] = printer

    duplex = getattr(args, "duplex", None)
    if duplex:
        print_cfg["duplex"] = _normalize_duplex(duplex)

    paper_size = getattr(args, "paper_size", None)
    if paper_size:
        print_cfg["paper_size"] = paper_size.upper()

    if getattr(args, "no_scale", False):
        print_cfg["scale_to_paper"] = False

    return {"ssh": ssh_cfg, "print": print_cfg}


def add_config_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--config", help="Read existing config from this JSON file")
    parser.add_argument("--server", choices=["stu", "stf"], help="SoC SSH server shortcut")
    parser.add_argument("--host", help="SSH host; overrides --server")
    parser.add_argument("--port", type=int, help="SSH port")
    parser.add_argument("--username", help="SoC SSH username")
    parser.add_argument("--password", help="SoC SSH password; prefer --ask-password or --password-stdin")
    parser.add_argument("--ask-password", action="store_true", help="Prompt for the SSH password")
    parser.add_argument("--password-stdin", action="store_true", help="Read one password line from stdin")
    parser.add_argument("--key-path", help="SSH private key path")
    parser.add_argument("--key-passphrase", help="SSH private key passphrase")
    parser.add_argument("--printer", help="Default SoC printer queue, for example psts-dx")
    parser.add_argument(
        "--duplex",
        choices=["simplex", "duplex", "duplex-long-edge", "duplex-short-edge"],
        help="Default duplex mode",
    )
    parser.add_argument("--paper-size", choices=["A4", "A3", "a4", "a3"], help="Default paper size")
    parser.add_argument("--no-scale", action="store_true", help="Skip remote Ghostscript fit-to-paper step")


def configure_virtual_printer(argv: List[str]) -> int:
    parser = argparse.ArgumentParser(prog="print-soc --configure-virtual-printer")
    add_config_args(parser)
    parser.add_argument("--system", action="store_true", help="Write /etc/print-at-soc config")
    parser.add_argument("--dry-run", action="store_true", help="Show actions without changing files")
    args = parser.parse_args(argv)

    from .account import AccountStore
    account = AccountStore()
    account.identity()  # Never migrate legacy CLI credentials.
    config = _build_config_from_args(args)
    _validate_print_config(config)
    explicit_password = args.password is not None or args.ask_password or args.password_stdin
    if args.key_path or args.key_passphrase:
        raise RuntimeError('The shared desktop account uses the OS password store; SSH keys are supported only for individual CLI jobs.')
    if explicit_password and not args.dry_run:
        account.save(config['ssh'], config['ssh']['password'])
    elif any(str(config['ssh'][key]) != str(account.identity()[key]) for key in ('host', 'port', 'username')):
        raise RuntimeError('Changing the shared account requires an explicit password; use --ask-password.')
    if args.system or backend_path().exists():
        from .native_driver import launch
        return launch('--install-system-printer', ['--printer', config['print']['printer'], '--paper-size', config['print']['paper_size'], '--duplex', _normalize_duplex(config['print']['duplex'])] + (['--dry-run'] if args.dry_run else []))
    path = SYSTEM_CONFIG_PATH if args.system else _write_config(config, dry_run=args.dry_run)
    print(f"Virtual printer config written: {path}")
    return 0


def install_virtual_printer(argv: List[str]) -> int:
    from .native_driver import launch
    return launch('--install-system-printer', argv)


def _cups_devices() -> Dict[str, str]:
    executable = shutil.which("lpstat")
    if not executable:
        raise RuntimeError("lpstat was not found. Install/enable CUPS first.")
    result = _run_command([executable, "-v"], check=False)
    # CUPS returns 1 when the scheduler has no destinations.
    if result.returncode and "No destinations added" not in result.stderr:
        raise RuntimeError((result.stderr or result.stdout or "Cannot inspect CUPS queues").strip())
    devices = {}
    for line in result.stdout.splitlines():
        prefix, separator, uri = line.partition(": ")
        if separator:
            devices[prefix.rsplit(" ", 1)[-1]] = uri.strip()
    return devices


def uninstall_virtual_printer(argv: List[str]) -> int:
    from .native_driver import launch
    return launch('--uninstall-system-printer', argv)


def virtual_printer_status(argv: List[str]) -> int:
    from .native_driver import launch
    return launch('--native-printer-status', argv)


def print_file_cli(argv: List[str]) -> int:
    parser = argparse.ArgumentParser(prog="print-soc print")
    parser.add_argument("file", nargs="?", help="File to submit")
    parser.add_argument("--file", dest="file_option", help="File to submit")
    parser.add_argument("--config", help="Config JSON path")
    parser.add_argument("--printer", help="Override SoC printer queue")
    parser.add_argument("--copies", type=int, default=1, help="Number of copies")
    parser.add_argument("--title", default="", help="Print job title")
    parser.add_argument("--cups-options", default="", help="Raw CUPS option string")
    args = parser.parse_args(argv)

    file_path = args.file_option or args.file
    if not file_path:
        parser.error("a file path is required")

    config = load_config(explicit_path=args.config)
    output = submit_file_print_job(
        file_path,
        config=config,
        printer=args.printer,
        copies=args.copies,
        title=args.title,
        cups_options=args.cups_options,
    )
    print(output)
    return 0


def main() -> int:
    args = sys.argv[1:]
    if args and args[0] == "backend":
        raise RuntimeError("The CUPS backend is the embedded Rust executable; repair the system printer from the desktop app.")
    if args and args[0] == "print":
        return print_file_cli(args[1:])
    print("Use print_at_soc.cli entry points for user-facing commands.", file=sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
