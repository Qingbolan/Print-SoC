"""Structured Print@SoC command helpers.

This module keeps the user-facing CLI thin while reusing the same SSH and
configuration code that powers the CUPS virtual printer.
"""

from __future__ import annotations

import argparse
import json
import re
import shlex
import shutil
import sys
from typing import Any, Dict, Iterable, List, Optional

from .virtual_printer import (
    _build_config_from_args,
    _connect_paramiko,
    _needs_paramiko,
    _normalize_duplex,
    _paramiko_exec,
    _system_exec,
    add_config_args,
    adjusted_queue_for_duplex,
    validate_queue_name,
)


PRINTCAP_COMMAND = (
    "awk -F'[:|]' '/^p/ { print $1 }' /etc/printcap | sort -u"
)
PUSAGE_COMMAND = (
    "if command -v pusage >/dev/null 2>&1; then pusage; else /usr/local/bin/pusage; fi"
)


def _validate_ssh_config(config: Dict[str, Any]) -> Dict[str, Any]:
    ssh_cfg = dict(config.get("ssh", {}))
    missing = []
    for key in ("host", "username"):
        if not str(ssh_cfg.get(key, "")).strip():
            missing.append(f"ssh.{key}")
    if missing:
        raise RuntimeError(
            "SSH is not configured. Missing: "
            + ", ".join(missing)
            + ". Run 'print-soc config set --username YOUR_SOC_ID' or pass SSH options."
        )
    if not _needs_paramiko(ssh_cfg) and not shutil.which("ssh"):
        raise RuntimeError("OpenSSH client was not found and no password auth is configured.")
    return ssh_cfg


def _remote_exec(config: Dict[str, Any], command: str, *, pty: bool = False) -> str:
    ssh_cfg = _validate_ssh_config(config)
    if _needs_paramiko(ssh_cfg):
        client = _connect_paramiko(ssh_cfg)
        try:
            return _paramiko_exec(client, command, get_pty=pty)
        finally:
            client.close()
    return _system_exec(ssh_cfg, command, tty=pty)


def _strip_ansi(value: str) -> str:
    return re.sub(r"\x1b\[[0-?]*[ -/]*[@-~]", "", value)


def _is_lpq_rank_token(token: str) -> bool:
    lower = token.lower()
    if lower in {"active", "stalled"}:
        return True
    return bool(re.fullmatch(r"\d+(st|nd|rd|th)", lower))


def _should_skip_lpq_line(line: str) -> bool:
    lower = line.lower()
    return (
        lower.startswith("printer:")
        or lower.startswith("queue:")
        or lower.startswith("rank")
        or "no entries" in lower
        or "no printable jobs" in lower
        or "is ready" in lower
    )


def parse_lpq_jobs(output: str) -> List[Dict[str, Any]]:
    jobs: List[Dict[str, Any]] = []
    for raw in _strip_ansi(output).splitlines():
        line = raw.strip()
        if not line or _should_skip_lpq_line(line):
            continue
        parts = line.split()
        if len(parts) < 4 or not _is_lpq_rank_token(parts[0]):
            continue
        file_parts = parts[3:]
        total_size = None
        if len(file_parts) >= 3:
            amount = file_parts[-2]
            unit = file_parts[-1].lower()
            if unit in {"byte", "bytes", "kb", "kbytes", "mb", "mbytes", "gb", "gbytes"}:
                if any(ch.isdigit() for ch in amount):
                    total_size = f"{file_parts[-2]} {file_parts[-1]}"
                    file_parts = file_parts[:-2]
        jobs.append(
            {
                "rank": parts[0],
                "owner": parts[1],
                "job_id": parts[2],
                "file": " ".join(file_parts),
                "total_size": total_size,
                "raw_line": line,
            }
        )
    return jobs


def normalize_lpq_job_id(job_id: str) -> str:
    value = job_id.strip()
    if "-" in value:
        suffix = value.rsplit("-", 1)[1]
        if suffix.isdigit():
            return suffix
    return value


def parse_print_quota_output(output: str) -> Dict[str, Any]:
    raw_output = _strip_ansi(output).strip()
    lines = [line.strip() for line in raw_output.splitlines() if line.strip()]
    return {
        "raw_output": raw_output,
        "summary": lines[0] if lines else None,
        "balance": _find_quota_line_value(lines, ("balance", "remaining", "left")),
        "used": _find_quota_line_value(lines, ("used", "usage", "printed")),
        "limit": _find_quota_line_value(lines, ("quota", "limit", "allocated")),
    }


def _find_quota_line_value(lines: Iterable[str], keys: Iterable[str]) -> Optional[str]:
    key_list = tuple(keys)
    for line in lines:
        lower = line.lower()
        if any(key in lower for key in key_list):
            if ":" in line:
                value = line.split(":", 1)[1].strip()
                if value:
                    return value
            return line
    return None


def list_print_queues(config: Dict[str, Any]) -> List[str]:
    output = _remote_exec(config, PRINTCAP_COMMAND)
    queues: List[str] = []
    seen = set()
    for line in output.splitlines():
        queue = line.strip()
        if not queue or queue in seen:
            continue
        try:
            validate_queue_name(queue)
        except ValueError:
            continue
        seen.add(queue)
        queues.append(queue)
    return queues


def resolve_printer_queue(
    config: Dict[str, Any],
    printer: Optional[str] = None,
    duplex: Optional[str] = None,
) -> str:
    print_cfg = dict(config.get("print", {}))
    queue = str(printer or print_cfg.get("printer") or "psts-dx")
    if duplex:
        return adjusted_queue_for_duplex(queue, _normalize_duplex(duplex))
    validate_queue_name(queue)
    return queue


def check_printer_queue(
    config: Dict[str, Any],
    printer: Optional[str] = None,
    duplex: Optional[str] = None,
) -> Dict[str, Any]:
    queue = resolve_printer_queue(config, printer, duplex)
    output = _remote_exec(config, f"lpq -P {shlex.quote(queue)}")
    return {"printer": queue, "jobs": parse_lpq_jobs(output), "raw_output": output.strip()}


def get_print_quota(config: Dict[str, Any]) -> Dict[str, Any]:
    output = _remote_exec(config, PUSAGE_COMMAND, pty=True)
    return parse_print_quota_output(output)


def cancel_print_job(config: Dict[str, Any], printer: str, job_id: str) -> str:
    queue = resolve_printer_queue(config, printer)
    normalized = normalize_lpq_job_id(job_id)
    if not normalized or not normalized.isdigit():
        raise RuntimeError(f"Invalid remote print job id: {job_id!r}")
    return _remote_exec(config, f"lprm -P {shlex.quote(queue)} {shlex.quote(normalized)}").strip()


def _json(data: Any) -> None:
    print(json.dumps(data, indent=2, sort_keys=True))


def _table(headers: List[str], rows: List[List[Any]]) -> None:
    text_rows = [[("" if cell is None else str(cell)) for cell in row] for row in rows]
    widths = [len(header) for header in headers]
    for row in text_rows:
        for index, cell in enumerate(row):
            widths[index] = max(widths[index], len(cell))
    print("  ".join(header.upper().ljust(widths[index]) for index, header in enumerate(headers)))
    print("  ".join("-" * width for width in widths))
    for row in text_rows:
        print("  ".join(cell.ljust(widths[index]) for index, cell in enumerate(row)))


def _print_kv(rows: List[tuple[str, Any]]) -> None:
    width = max((len(key) for key, _ in rows), default=0)
    for key, value in rows:
        rendered = "-" if value in (None, "") else str(value)
        print(f"{key.ljust(width)}: {rendered}")


def _add_json_arg(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--json", action="store_true", help="Emit structured JSON")


def printer_cli(argv: List[str]) -> int:
    if not argv:
        argv = ["list"]
    parser = argparse.ArgumentParser(prog="print-soc printer")
    sub = parser.add_subparsers(dest="command", required=True)
    list_parser = sub.add_parser("list", help="List SoC printer queues")
    add_config_args(list_parser)
    _add_json_arg(list_parser)
    args = parser.parse_args(argv)

    if args.command == "list":
        config = _build_config_from_args(args)
        queues = list_print_queues(config)
        if args.json:
            _json({"queues": queues})
        elif queues:
            _table(["queue"], [[queue] for queue in queues])
        else:
            print("No print queues found.")
        return 0
    parser.error("unknown printer command")
    return 2


def job_cli(argv: List[str]) -> int:
    if not argv:
        argv = ["list"]
    parser = argparse.ArgumentParser(prog="print-soc job")
    sub = parser.add_subparsers(dest="command", required=True)

    list_parser = sub.add_parser("list", help="List jobs in a SoC print queue")
    add_config_args(list_parser)
    _add_json_arg(list_parser)

    cancel_parser = sub.add_parser("cancel", help="Cancel a remote queued print job")
    add_config_args(cancel_parser)
    cancel_parser.add_argument("--id", "--job-id", dest="job_id", required=True, help="Remote lpq/lpr job id")
    cancel_parser.add_argument("--yes", "-y", action="store_true", help="Skip confirmation prompt")

    args = parser.parse_args(argv)
    config = _build_config_from_args(args)

    if args.command == "list":
        payload = check_printer_queue(config, args.printer, args.duplex)
        if args.json:
            _json(payload)
        elif payload["jobs"]:
            _table(
                ["rank", "owner", "job_id", "file", "size"],
                [
                    [
                        job["rank"],
                        job["owner"],
                        job["job_id"],
                        job["file"],
                        job["total_size"] or "-",
                    ]
                    for job in payload["jobs"]
                ],
            )
        else:
            print(f"No jobs in queue {payload['printer']}.")
        return 0

    if args.command == "cancel":
        queue = resolve_printer_queue(config, args.printer)
        if not args.yes:
            if not sys.stdin.isatty():
                print("Refusing to cancel without --yes because stdin is not a terminal.", file=sys.stderr)
                return 2
            answer = input(f"Cancel job {args.job_id} on {queue}? [y/N] ").strip().lower()
            if answer not in {"y", "yes"}:
                print("Cancelled.")
                return 0
        message = cancel_print_job(config, queue, args.job_id)
        print(message or f"Cancelled job {normalize_lpq_job_id(args.job_id)} on {queue}.")
        return 0

    parser.error("unknown job command")
    return 2


def quota_cli(argv: List[str]) -> int:
    if not argv or argv[0].startswith("-"):
        argv = ["show"] + argv
    if argv[0] == "list":
        argv = ["show"] + argv[1:]
    parser = argparse.ArgumentParser(prog="print-soc quota")
    sub = parser.add_subparsers(dest="command", required=True)
    show_parser = sub.add_parser("show", help="Show print quota/balance")
    add_config_args(show_parser)
    _add_json_arg(show_parser)
    show_parser.add_argument("--raw", action="store_true", help="Print raw pusage output")
    args = parser.parse_args(argv)

    if args.command == "show":
        config = _build_config_from_args(args)
        quota = get_print_quota(config)
        if args.json:
            _json(quota)
        elif args.raw:
            print(quota["raw_output"])
        else:
            _print_kv(
                [
                    ("summary", quota.get("summary")),
                    ("balance", quota.get("balance")),
                    ("used", quota.get("used")),
                    ("limit", quota.get("limit")),
                ]
            )
        return 0
    parser.error("unknown quota command")
    return 2


def config_cli(argv: List[str]) -> int:
    if not argv:
        argv = ["show"]
    parser = argparse.ArgumentParser(prog="print-soc config")
    sub = parser.add_subparsers(dest="command", required=True)

    show_parser = sub.add_parser("show", help="Show effective Print@SoC CLI config")
    add_config_args(show_parser)
    _add_json_arg(show_parser)
    show_parser.add_argument("--show-secrets", action="store_true", help="Do not redact passwords/passphrases")

    set_parser = sub.add_parser("set", help="Write Print@SoC CLI config")
    add_config_args(set_parser)
    set_parser.add_argument("--system", action="store_true", help="Write /etc/print-at-soc config")
    set_parser.add_argument("--dry-run", action="store_true", help="Show actions without changing files")

    args = parser.parse_args(argv)

    if args.command == "show":
        config = _build_config_from_args(args)
        rendered = _redact_config(config, show_secrets=args.show_secrets)
        if args.json:
            _json(rendered)
        else:
            ssh = rendered.get("ssh", {})
            print_cfg = rendered.get("print", {})
            print("SSH:")
            _print_kv(
                [
                    ("host", ssh.get("host")),
                    ("port", ssh.get("port")),
                    ("username", ssh.get("username")),
                    ("password", ssh.get("password")),
                    ("key_path", ssh.get("key_path")),
                ]
            )
            print("\nPrint:")
            _print_kv(
                [
                    ("printer", print_cfg.get("printer")),
                    ("duplex", print_cfg.get("duplex")),
                    ("paper_size", print_cfg.get("paper_size")),
                    ("scale_to_paper", print_cfg.get("scale_to_paper")),
                ]
            )
        return 0

    if args.command == "set":
        from .virtual_printer import configure_virtual_printer

        forwarded = _argv_after_command_options(argv[1:])
        return configure_virtual_printer(forwarded)

    parser.error("unknown config command")
    return 2


def _argv_after_command_options(argv: List[str]) -> List[str]:
    return list(argv)


def _redact_config(config: Dict[str, Any], *, show_secrets: bool = False) -> Dict[str, Any]:
    rendered = json.loads(json.dumps(config))
    if show_secrets:
        return rendered
    ssh = rendered.get("ssh", {})
    for key in ("password", "key_passphrase"):
        value = ssh.get(key)
        if value:
            ssh[key] = "<redacted>"
    return rendered


def virtual_printer_cli(argv: List[str]) -> int:
    if argv and argv[0] in {"help", "--help", "-h"}:
        print(
            "Usage:\n"
            "  print-soc virtual-printer configure [options]\n"
            "  print-soc virtual-printer install [options]\n"
            "  print-soc virtual-printer status [options]\n"
            "  print-soc virtual-printer uninstall [options]"
        )
        return 0
    if not argv:
        argv = ["status"]
    command = argv[0]
    rest = argv[1:]
    if command == "configure":
        from .virtual_printer import configure_virtual_printer

        return configure_virtual_printer(rest)
    if command == "install":
        from .virtual_printer import install_virtual_printer

        return install_virtual_printer(rest)
    if command == "uninstall":
        from .virtual_printer import uninstall_virtual_printer

        return uninstall_virtual_printer(rest)
    if command == "status":
        from .virtual_printer import virtual_printer_status

        return virtual_printer_status(rest)
    print(
        "Unknown virtual-printer command. Use configure, install, status, or uninstall.",
        file=sys.stderr,
    )
    return 2


def flat_list_cli(argv: List[str]) -> int:
    return printer_cli(["list"] + argv)


def flat_jobs_cli(argv: List[str]) -> int:
    return job_cli(["list"] + argv)
