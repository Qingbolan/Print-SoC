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
PDF_DRIVER_PATH = Path(__file__).resolve().parent / "resources" / "printatsoc.ppd"

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


def load_config(job_user: str = "", explicit_path: Optional[str] = None) -> Dict[str, Any]:
    config = json.loads(json.dumps(DEFAULT_CONFIG))

    candidates: List[Path] = []
    if SYSTEM_CONFIG_PATH.exists() and os.access(SYSTEM_CONFIG_PATH, os.R_OK):
        candidates.append(SYSTEM_CONFIG_PATH)

    job_home = _home_for_user(job_user)
    if job_home:
        candidates.append(user_config_path(job_home))

    current_user_path = user_config_path()
    if not job_user and current_user_path not in candidates:
        candidates.append(current_user_path)

    if explicit_path:
        explicit = Path(explicit_path).expanduser()
        if explicit not in candidates:
            candidates.append(explicit)

    for path in candidates:
        config = _merge_dict(config, _read_json(path))

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
    legacy_aliases = {
        "pstsb": "pstb",
        "pstsb-dx": "pstb-dx",
        "pstsb-sx": "pstb-sx",
        "pstsc": "pstc",
        "pstsc-dx": "pstc-dx",
        "pstsc-sx": "pstc-sx",
    }
    queue = legacy_aliases.get(queue, queue)
    duplex = _normalize_duplex(duplex)

    def replace_suffix(target: str, suffix: str) -> str:
        if target.endswith("-sx") or target.endswith("-dx"):
            return f"{target[:-3]}-{suffix}"
        return f"{target}-{suffix}"

    if duplex == "simplex":
        if queue.endswith("-nb"):
            return queue
        return replace_suffix(queue, "sx")
    if queue.endswith("-sx") or queue.endswith("-dx"):
        return replace_suffix(queue, "dx")
    if queue in {"psc008", "psc011", "psts", "pstb", "pstc"}:
        return f"{queue}-dx"
    return queue


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


def _validate_backend_config(config: Dict[str, Any]) -> None:
    _validate_print_config(config)
    ssh = config["ssh"]
    if not ssh.get("password") and not ssh.get("key_path"):
        raise RuntimeError("CUPS cannot use your login SSH agent. Supply --ask-password or --key-path")
    if ssh.get("key_path") and not Path(ssh["key_path"]).expanduser().is_file():
        raise RuntimeError("SSH private key does not exist")


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

    lpr_parts = ["lpr", "-P", actual_queue]
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


def _install_runtime(*, dry_run: bool = False) -> str:
    from .cups_runtime import CupsRuntime
    runtime = CupsRuntime()
    destination = RUNTIME_DIR / uuid.uuid4().hex
    if not dry_run:
        with tempfile.TemporaryDirectory(prefix="print-soc-runtime-") as tmp:
            stage = Path(tmp) / "runtime"
            stage.mkdir()
            runtime.stage(stage)
            # Verify the isolated imports before changing the system.
            environment = dict(os.environ, PYTHONPATH=str(stage))
            environment.pop("PYTHONHOME", None)
            subprocess.run([str(runtime.python), "-S", "-c", "import paramiko; import print_at_soc.virtual_printer"],
                           env=environment, cwd=tmp, check=True, capture_output=True)
            _run_command(_sudo_prefix() + ["mkdir", "-p", str(RUNTIME_DIR)])
            _run_command(_sudo_prefix() + ["cp", "-R", str(stage), str(destination)])
            _run_command(_sudo_prefix() + ["chown", "-R", "root", str(destination)])
            _run_command(_sudo_prefix() + ["chmod", "-R", "go-w", str(destination)])
    else:
        print(f"# install isolated CUPS runtime under {RUNTIME_DIR}")
    return runtime.wrapper(destination)


def _write_backend_config(config: Dict[str, Any], *, dry_run: bool = False) -> None:
    _validate_backend_config(config)
    config = _merge_dict({}, config)
    ssh = dict(config["ssh"])
    config["ssh"] = ssh
    key = ssh.get("key_path")
    if key:
        source = Path(key).expanduser()
        content = source.read_text(encoding="utf-8")
        _run_command(_sudo_prefix() + ["mkdir", "-p", str(SYSTEM_CONFIG_DIR)], dry_run=dry_run)
        destination = SYSTEM_CONFIG_DIR / "ssh_key"
        _install_file(content, destination, mode="0600", dry_run=dry_run)
        ssh["key_path"] = str(destination)
    _write_config(config, system=True, dry_run=dry_run)
    _install_file(json.dumps({"configured": True}) + "\n", STATUS_PATH, mode="0644", dry_run=dry_run)


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


def _install_file(
    content: str,
    destination: Path,
    *,
    mode: str,
    owner: str = "root",
    group: Optional[str] = None,
    dry_run: bool = False,
) -> None:
    group = group or ("wheel" if platform.system() == "Darwin" else "root")
    if dry_run:
        print(f"# write {destination} ({mode}, {owner}:{group})")
        return

    with tempfile.NamedTemporaryFile("w", encoding="utf-8", delete=False) as tmp:
        tmp.write(content)
        tmp_path = Path(tmp.name)
    try:
        install_cmd = shutil.which("install") or "/usr/bin/install"
        cmd = _sudo_prefix() + [
            install_cmd,
            "-o",
            owner,
            "-g",
            group,
            "-m",
            mode,
            str(tmp_path),
            str(destination),
        ]
        result = _run_command(cmd, check=False)
        if result.returncode != 0:
            raise RuntimeError((result.stderr or result.stdout).strip())
    finally:
        try:
            tmp_path.unlink()
        except Exception:
            pass


def _write_config(config: Dict[str, Any], *, system: bool = False, dry_run: bool = False) -> Path:
    content = json.dumps(config, indent=2, sort_keys=True) + "\n"
    if system:
        if dry_run:
            print(f"# create {SYSTEM_CONFIG_DIR}")
        else:
            _run_command(_sudo_prefix() + ["mkdir", "-p", str(SYSTEM_CONFIG_DIR)], check=True)
        _install_file(content, SYSTEM_CONFIG_PATH, mode="0600", dry_run=dry_run)
        return SYSTEM_CONFIG_PATH

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
    config = load_config(explicit_path=getattr(args, "config", None))
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

    if getattr(args, "ask_password", False):
        ssh_cfg["password"] = getpass.getpass("SoC SSH password: ")

    if getattr(args, "password_stdin", False):
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

    config = _build_config_from_args(args)
    _validate_print_config(config)
    if args.system or backend_path().exists():
        _authorize_system_changes(dry_run=args.dry_run)
        _write_backend_config(config, dry_run=args.dry_run)
    path = SYSTEM_CONFIG_PATH if args.system else _write_config(config, dry_run=args.dry_run)
    print(f"Virtual printer config written: {path}")
    return 0


def install_virtual_printer(argv: List[str]) -> int:
    from .printer_installation import run_installation
    return run_installation(argv)


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
    parser = argparse.ArgumentParser(prog="print-soc --uninstall-virtual-printer")
    parser.add_argument("--name", default=PRINTER_NAME, help=f"CUPS queue name (default: {PRINTER_NAME})")
    parser.add_argument("--keep-config", action="store_true", help="Keep virtual printer config files")
    parser.add_argument("--dry-run", action="store_true", help="Show actions without changing the system")
    args = parser.parse_args(argv)

    if platform.system() not in {"Darwin", "Linux"}:
        print("Virtual printer auto-uninstall currently supports macOS and Linux CUPS only.", file=sys.stderr)
        return 2

    validate_queue_name(args.name)
    devices = _cups_devices()
    uri = devices.get(args.name)
    if uri and not uri.startswith(BACKEND_NAME + ":"):
        raise RuntimeError(f"Queue {args.name} is not a Print@SoC printer")
    _authorize_system_changes(dry_run=args.dry_run)
    if uri:
        lpadmin = shutil.which("lpadmin")
        if not lpadmin:
            raise RuntimeError("lpadmin was not found")
        _run_command(_sudo_prefix() + [lpadmin, "-x", args.name], dry_run=args.dry_run)
    if any(name != args.name and uri.startswith(BACKEND_NAME + ":") for name, uri in devices.items()):
        print(f"Removed queue {args.name}; shared backend retained for other Print@SoC queues")
        return 0
    _run_command(_sudo_prefix() + ["rm", "-f", str(backend_path())], dry_run=args.dry_run)
    _run_command(_sudo_prefix() + ["rm", "-rf", str(RUNTIME_DIR)], dry_run=args.dry_run)
    if not args.keep_config:
        for path in (SYSTEM_CONFIG_PATH, STATUS_PATH, SYSTEM_CONFIG_DIR / "ssh_key"):
            _run_command(_sudo_prefix() + ["rm", "-f", str(path)], dry_run=args.dry_run)
        _run_command(_sudo_prefix() + ["rmdir", str(SYSTEM_CONFIG_DIR)], dry_run=args.dry_run, check=False)
        path = user_config_path()
        if args.dry_run:
            print(f"# remove {path}")
        elif path.exists():
            path.unlink()

    print(f"Removed virtual printer queue/backend for: {args.name}")
    return 0


def virtual_printer_status(argv: List[str]) -> int:
    parser = argparse.ArgumentParser(prog="print-soc --virtual-printer-status")
    parser.add_argument("--name", default=PRINTER_NAME, help=f"CUPS queue name (default: {PRINTER_NAME})")
    args = parser.parse_args(argv)

    print(f"Platform: {platform.system()}")
    destination = backend_path()
    print(f"Backend path: {destination}")
    print(f"Backend installed: {'yes' if destination.exists() else 'no'}")
    ready = SYSTEM_CONFIG_PATH.exists() and _read_json(STATUS_PATH).get("configured") is True
    print(f"Forwarding configured: {'yes' if ready else 'no (run install or configure)'}")
    print(f"System config: {SYSTEM_CONFIG_PATH} ({'present' if SYSTEM_CONFIG_PATH.exists() else 'missing'})")
    current_config = user_config_path()
    print(f"User config: {current_config} ({'present' if current_config.exists() else 'missing'})")

    lpstat = shutil.which("lpstat")
    if not lpstat:
        print("lpstat: not found")
        return 0

    for cmd in ([lpstat, "-p", args.name], [lpstat, "-v", args.name]):
        result = subprocess.run(cmd, capture_output=True, text=True, check=False)
        output = (result.stdout or result.stderr).strip()
        if output:
            print(output)
    return 0


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


def _copy_stdin_to_temp() -> str:
    tmp = tempfile.NamedTemporaryFile(prefix="print-at-soc-cups-", suffix=".prn", delete=False)
    try:
        with tmp:
            shutil.copyfileobj(sys.stdin.buffer, tmp)
        return tmp.name
    except Exception:
        try:
            Path(tmp.name).unlink()
        except Exception:
            pass
        raise


def backend_main(argv: List[str]) -> int:
    if not argv:
        print(f'direct {BACKEND_URI} "Print@SoC" "{DISPLAY_NAME}"')
        return 0

    if len(argv) < 5:
        print("ERROR: printatsoc backend expects: job user title copies options [file]", file=sys.stderr)
        return 1

    _job_id, job_user, title, copies, options = argv[:5]
    filename = argv[5] if len(argv) > 5 else ""
    temp_file = ""

    try:
        if not filename:
            temp_file = _copy_stdin_to_temp()
            filename = temp_file

        # CUPS runs independently of login sessions and cannot read macOS homes.
        config = _merge_dict(DEFAULT_CONFIG, _read_json(SYSTEM_CONFIG_PATH))
        print(f"INFO: submitting {title or filename} through Print@SoC", file=sys.stderr)
        output = submit_file_print_job(
            filename,
            config=config,
            copies=_coerce_copies(copies),
            title=title,
            cups_options=options,
        )
        print(f"INFO: {output}", file=sys.stderr)
        return 0
    except Exception as exc:
        print(f"ERROR: Print@SoC virtual printer failed: {exc}", file=sys.stderr)
        return 1
    finally:
        if temp_file:
            try:
                Path(temp_file).unlink()
            except Exception:
                pass


def main() -> int:
    args = sys.argv[1:]
    if args and args[0] == "backend":
        return backend_main(args[1:])
    if args and args[0] == "print":
        return print_file_cli(args[1:])
    print("Use print_at_soc.cli entry points for user-facing commands.", file=sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
