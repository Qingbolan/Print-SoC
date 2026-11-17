# Print@SoC Python CLI

Print@SoC helps National University of Singapore (NUS) School of Computing users print without configuring each campus printer. Preview documents, choose print settings and keep a job history in the desktop app on Windows, macOS and Linux.

This package is the **Python CLI launcher** for the desktop app and MCP stdio server. On macOS/Linux, `print-soc virtual-printer install` starts guided setup of a system printer for Word and other apps. A SoC account and network access are required; Office conversion needs LibreOffice.

[Download the desktop](https://github.com/Qingbolan/Print-SoC/releases/latest) · [Setup and user guide](https://github.com/Qingbolan/Print-SoC/blob/main/docs/usage.md) · [Agent skill for Codex and Claude Code](https://github.com/Qingbolan/Print-SoC#agent-skill-support) · [Get help or report a bug](https://github.com/Qingbolan/Print-SoC/issues)

An independent community project by [Silan Hu](https://silan.tech), not an official NUS service.

## Installation

```bash
pip install print-at-soc
```

## Commands

All command names launch the same wrapper:

```bash
print-at-soc
print-soc
psoc
```

Useful options:

```bash
print-soc --help
print-soc --version
print-soc --install
print-soc --path
print-soc --doctor
```

Submit a file without opening the desktop UI:

```bash
print-soc print assignment.pdf --printer psts-dx --copies 1
```

Inspect live SoC printing state:

```bash
print-soc printer list --username your-soc-id --ask-password
print-soc job list --printer psts-dx --json
print-soc quota show --json
```

The inspection commands support `--server stu|stf`, `--host`, `--port`,
`--username`, `--password-stdin`, `--ask-password`, `--key-path`, and the
`PSOC_SSH_*` environment variables listed below. Human-readable commands print
tables/key-value output; pass `--json` for scripts.

## Updates and uninstall

```bash
print-soc self update --check
print-soc self update
print-soc self update --auto apply
print-soc self update --rollback
print-soc self uninstall --dry-run
print-soc self uninstall --purge --remove-cli
```

Updates verify downloads before replacing the desktop and retain a previous
version for rollback. Normal CLI desktop launches check daily (notification by
default); automatic installation is opt-in on macOS/Linux. The uninstall wizard
previews owned components and lets you retain data or purge app data and saved
credentials. Use `--plain` for simple text, or `--non-interactive --yes` in scripts.
Python/npm package upgrades and CUPS service refreshes remain separate from
desktop updates. See [maintenance and recovery details](https://github.com/Qingbolan/Print-SoC/blob/main/docs/maintenance.md), including Windows
native-installer limits and the intentionally retained non-secret lock file.

## Virtual Printer

On macOS/Linux, open **Settings → Advanced → Add system printer**. The desktop
contains a standalone Rust CUPS backend and a Rust login-session print service.
Python, Conda, pip, shell scripts, local SSH executables and Homebrew OpenSSL are
not part of the system printing path. Save your shared account in Settings first.
The native wizard offers interactive queue/paper/duplex choices, animated progress,
a preview, administrator authentication and failure guidance.

An optional Python CLI launcher can invoke the same embedded installer:

```sh
print-soc virtual-printer install
print-soc virtual-printer install --dry-run
print-soc virtual-printer install --plain
print-soc virtual-printer status
print-soc virtual-printer uninstall
```

The standalone backend is embedded at build time and installed as a root-owned
executable. Its only connection configuration is a private token in
`/etc/print-at-soc/native.conf`. The Rust login service reads the shared account
and OS keyring, saves the spool PDF, and submits through the desktop's existing
job state machine and remote receipt mechanism. System jobs appear in GUI history
with their source, effective settings, original native options and PDF preview,
including when the GUI was closed when the job arrived.

Page selection, orientation, scaling and n-up already rendered into the CUPS PDF
are not applied twice. Copies, paper, duplex and supported physical colour/collate
options are forwarded explicitly. Unsupported physical settings fail with an
error. Submission acknowledgment is not proof of physical output.

Stay logged in with an unlocked credential store and NUS/VPN connectivity while
printing. Installer previews and registration checks never print a test page.
Repair refuses queues with pending jobs. Uninstall removes native runtime/service
and connection tokens; account/history are retained unless the full uninstall
wizard explicitly purges user data. Original documents are never removed.

The first native repair replaces the former Python backend and removes its
runtime and credential snapshots. Update the desktop before using the native
installer through an older CLI. Windows system-driver support remains separate
from CUPS; desktop printing is available there.

## MCP Environment Variables

`connect_ssh` can read credentials from arguments or these environment variables:

```bash
PSOC_SSH_SERVER=stu
PSOC_SSH_HOST=stu.comp.nus.edu.sg
PSOC_SSH_PORT=22
PSOC_SSH_USERNAME=your-soc-username
PSOC_SSH_PASSWORD=your-password
PSOC_SSH_KEY_PATH=/path/to/private/key
PSOC_SSH_KEY_PASSPHRASE=optional-passphrase
```

## MCP Tools

- `connect_ssh`
- `disconnect_ssh`
- `connection_status`
- `list_print_queues`
- `check_print_quota`
- `check_printer_queue`
- `submit_pdf_print_job`

`submit_pdf_print_job` requires `confirm=true` because it submits a real print job.

## Requirements

- Python 3.8+
- macOS, Linux, or Windows x64/arm64 as supported by the released desktop binaries
- NUS SoC network access or VPN for SSH printing

## 0.1.1

- Fix Windows installer execution and MSI asset selection; report unsuccessful installations.
- Run `--doctor` without downloading or launching the desktop app.
- Support passphrase-protected SSH keys through Paramiko.
- Clean up uploaded print files when a remote print command fails.

The desktop application is downloaded separately from GitHub Releases. This
Python package update does not replace the desktop release or its embedded native driver.

### macOS raw-queue installation error

If an older installation reports `Raw queues are no longer supported on macOS`,
update the desktop application, then open **Settings → Advanced → Add / repair
system printer**. The desktop contains the Rust installer and PDF PPD; no Python
installation is required. Optional CLI users can invoke `print-soc virtual-printer
install` after updating their desktop application.

The installer now registers the packaged PDF PPD on both macOS and Linux. A4/A3
and duplex choices from the print dialog are forwarded to the SoC submission.
No real print job is sent while installing the queue.
